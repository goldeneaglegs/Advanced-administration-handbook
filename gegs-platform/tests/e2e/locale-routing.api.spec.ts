import { expect, test, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

/**
 * Locale routing at the protocol level (Phase 1 §12, §1.2, M4 batch 2a).
 *
 * Named `.api.spec.ts` so it runs once in the existing `api` project rather
 * than four times across viewport projects: every assertion here is about
 * status codes, headers and cookies, none about layout.
 *
 * The decisive assertions are the parity ones. Phase 1 §1.2 rule 2 requires
 * `X-Robots-Tag` on EVERY response "because a single missed page would break
 * the guarantee", and a redirect is the response most likely to miss it. The
 * locale redirects are produced by server components downstream of middleware,
 * so these tests are what establish that the security block still reaches them.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

const DOMAIN = 'routing.test';
const SECURITY_HEADERS = [
  'x-robots-tag',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-request-id',
] as const;

/** A signed-in user with a stored locale. Returns the session token. */
async function signedInUser(locale: string): Promise<string> {
  const email = `entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash, status, email_verified_at, locale)
    VALUES (${email}::citext, 'not-a-real-hash', 'active'::user_status, now(), ${locale})
    RETURNING id::text AS id`;
  const token = randomBytes(32).toString('base64url');
  await db.$executeRaw`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${rows[0]!.id}::uuid, ${createHash('sha256').update(token, 'utf8').digest()},
            now() + interval '1 day')`;
  return token;
}

/** One request, redirects never followed, so the redirect itself can be read. */
function raw(request: APIRequestContext, path: string, headers: Record<string, string> = {}) {
  return request.get(path, { maxRedirects: 0, headers });
}

test.afterAll(async () => {
  await db.$executeRaw`
    DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${'%@' + DOMAIN})`;
  await db.$disconnect();
});

test.describe('localised routes resolve', () => {
  for (const path of ['/en', '/ar', '/en/sign-in', '/ar/sign-in', '/en/register', '/ar/register']) {
    test(`${path} returns 200`, async ({ request }) => {
      expect((await raw(request, path)).status()).toBe(200);
    });
  }
});

test.describe('server-rendered lang and dir', () => {
  test('/en carries lang="en" dir="ltr" in the HTML itself', async ({ request }) => {
    // In the markup, not applied later by script: §12 requires no flash of the
    // wrong direction.
    const html = await (await raw(request, '/en')).text();
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toMatch(/<html[^>]*dir="ltr"/);
  });

  test('/ar carries lang="ar" dir="rtl" in the HTML itself', async ({ request }) => {
    const html = await (await raw(request, '/ar')).text();
    expect(html).toMatch(/<html[^>]*lang="ar"/);
    expect(html).toMatch(/<html[^>]*dir="rtl"/);
  });

  test('a client-supplied locale header cannot change the direction', async ({ request }) => {
    // Middleware deletes the internal header before setting it from the URL,
    // the same ordering server.ts uses for the client-IP header.
    const html = await (await raw(request, '/en', { 'x-gegs-locale': 'ar' })).text();
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toMatch(/<html[^>]*dir="ltr"/);
  });
});

test.describe('locale-less entry redirects', () => {
  test('/ redirects to the default locale when anonymous', async ({ request }) => {
    const response = await raw(request, '/');
    expect([307, 308]).toContain(response.status());
    expect(response.headers()['location']).toBe('/en');
  });

  for (const path of ['/sign-in', '/register', '/forgot-password']) {
    test(`${path} redirects to /en${path} when anonymous`, async ({ request }) => {
      const response = await raw(request, path);
      expect([307, 308]).toContain(response.status());
      expect(response.headers()['location']).toBe(`/en${path}`);
    });
  }

  for (const path of ['/verify-email', '/accept-invite', '/reset-password']) {
    test(`${path} preserves the token in the query string`, async ({ request }) => {
      // These three carry a one-time token; losing it would break the flow.
      const response = await raw(request, `${path}?token=abc123`);
      expect(response.headers()['location']).toBe(`/en${path}?token=abc123`);
    });
  }

  test('a signed-in user goes to their stored locale', async ({ request }) => {
    const token = await signedInUser('ar');
    const response = await raw(request, '/sign-in', { cookie: `gegs_session=${token}` });
    expect(response.headers()['location']).toBe('/ar/sign-in');
  });
});

test.describe('an explicit locale wins over the stored preference', () => {
  test('a user whose locale is ar still gets English on /en, and the row is untouched', async ({
    request,
  }) => {
    // The recorded M4 batch 2a decision, both halves.
    const token = await signedInUser('ar');
    const response = await raw(request, '/en/sign-in', { cookie: `gegs_session=${token}` });
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/<html[^>]*lang="en"/);

    const rows = await db.$queryRaw<Array<{ locale: string }>>`
      SELECT u.locale FROM users u
      JOIN sessions s ON s.user_id = u.id
      WHERE s.token_hash = ${createHash('sha256').update(token, 'utf8').digest()}`;
    expect(rows[0]?.locale).toBe('ar');
  });
});

test.describe('unsupported locales are not found', () => {
  for (const path of ['/fr/sign-in', '/fr', '/EN/sign-in', '/en-GB/sign-in']) {
    test(`${path} returns 404`, async ({ request }) => {
      expect((await raw(request, path)).status()).toBe(404);
    });
  }

  test('an unknown route still returns 404 rather than redirecting', async ({ request }) => {
    // The reason the locale-less entries are a fixed set of routes rather than
    // a catch-all: a catch-all would redirect this instead.
    expect((await raw(request, '/this-route-does-not-exist')).status()).toBe(404);
  });
});

test.describe('exclusions', () => {
  test('/api/health is neither prefixed nor redirected', async ({ request }) => {
    const response = await raw(request, '/api/health');
    expect([200, 503]).toContain(response.status());
    expect(response.headers()['location']).toBeUndefined();
  });

  test('/api/me still answers 401 unauthenticated', async ({ request }) => {
    expect((await raw(request, '/api/me')).status()).toBe(401);
  });

  test('/robots.txt stays at the root and disallows everything', async ({ request }) => {
    const response = await raw(request, '/robots.txt');
    expect(response.status()).toBe(200);
    expect(await response.text()).toMatch(/Disallow:\s*\//);
  });
});

test.describe('security guarantees survive localisation and redirects', () => {
  for (const path of ['/en', '/ar', '/en/sign-in']) {
    test(`${path} carries the full security header set`, async ({ request }) => {
      const headers = (await raw(request, path)).headers();
      for (const name of SECURITY_HEADERS) expect(headers, name).toHaveProperty(name);
      expect(headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    });
  }

  for (const path of ['/', '/sign-in']) {
    test(`the ${path} redirect carries the full security header set`, async ({ request }) => {
      // Fetched with redirects disabled, so this is the 307 itself and not the
      // page it points at. §1.2 rule 2 applies to it like any other response.
      const response = await raw(request, path);
      expect([307, 308]).toContain(response.status());
      const headers = response.headers();
      for (const name of SECURITY_HEADERS) expect(headers, name).toHaveProperty(name);
      expect(headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    });
  }

  test('the 404 for an unsupported locale carries them too', async ({ request }) => {
    const headers = (await raw(request, '/fr/sign-in')).headers();
    for (const name of SECURITY_HEADERS) expect(headers, name).toHaveProperty(name);
  });

  test('the CSP policy is identical across locales and on the redirect', async ({ request }) => {
    // The SET and the policy must match; only per-request values may differ.
    const en = (await raw(request, '/en')).headers()['content-security-policy'];
    const ar = (await raw(request, '/ar')).headers()['content-security-policy'];
    const redirect = (await raw(request, '/sign-in')).headers()['content-security-policy'];
    expect(ar).toBe(en);
    expect(redirect).toBe(en);
  });

  test('request-id is present and well-formed on each response, values differing freely', async ({
    request,
  }) => {
    const first = (await raw(request, '/en')).headers()['x-request-id'];
    const second = (await raw(request, '/sign-in')).headers()['x-request-id'];
    for (const id of [first, second]) expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('a cookie-less request receives a CSRF token even on a redirect', async ({ request }) => {
    // Without this the double-submit mechanism would silently start failing for
    // anyone arriving through a WordPress link (§1.2 rule 3).
    const response = await raw(request, '/sign-in');
    const setCookie = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const csrf = setCookie.find((v) => v.startsWith('gegs_csrf='));
    expect(csrf, 'no gegs_csrf cookie on the locale redirect').toBeDefined();
    // Attribute names and values are case-insensitive (RFC 6265), and Next
    // emits `SameSite=lax`, so the comparison is lowered rather than exact.
    expect(csrf?.toLowerCase()).toContain('path=/');
    expect(csrf?.toLowerCase()).toContain('samesite=lax');
    // Deliberately NOT HttpOnly: the page reads it to echo into the form, which
    // is the double-submit mechanism.
    expect(csrf?.toLowerCase()).not.toContain('httponly');
  });

  test('a localised page issues the same CSRF cookie shape', async ({ request }) => {
    const csrf = (await raw(request, '/ar/sign-in'))
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .find((v) => v.startsWith('gegs_csrf='));
    expect(csrf).toBeDefined();
    expect(csrf?.toLowerCase()).toContain('path=/');
    expect(csrf?.toLowerCase()).toContain('samesite=lax');
  });
});
