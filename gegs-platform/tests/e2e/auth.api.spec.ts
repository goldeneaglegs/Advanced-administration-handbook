import { expect, test, type APIRequestContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

/**
 * Milestone 2 authentication endpoints, exercised over real HTTP against the
 * custom Node server, with a real PostgreSQL behind it.
 *
 * Protocol-level, so this runs once in the `api` project rather than four times
 * across viewports.
 *
 * Tokens are read straight out of `email_tokens` — Milestone 2 enqueues
 * notifications but sends nothing, so the database is the only place a token
 * can be obtained, exactly as the approved scope anticipated.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

/** Non-optional base URL, so `exactOptionalPropertyTypes` stays satisfied. */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

const STRONG = 'correct-horse-battery-staple-42';
const DOMAIN = 'authapi.test';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@${DOMAIN}`;
}

/** Fetches a CSRF cookie from any GET, then returns the matching header value. */
async function csrf(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/health');
  const cookie = response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === 'set-cookie')
    .map((h) => h.value)
    .find((v) => v.startsWith('gegs_csrf='));
  const token = cookie?.split(';')[0]?.split('=')[1];
  // Only the first GET issues the cookie; later ones reuse the stored one.
  if (token) return token;
  const stored = (await request.storageState()).cookies.find((c) => c.name === 'gegs_csrf');
  return stored!.value;
}

async function post(
  request: APIRequestContext,
  path: string,
  body: Record<string, unknown>,
  token: string,
) {
  return request.post(path, {
    data: body,
    headers: { 'x-csrf-token': token, origin: process.env.APP_ORIGIN! },
  });
}

async function tokenFor(userEmail: string, purpose: string): Promise<string> {
  // The plaintext is never stored, so tests mint their own and overwrite the
  // hash — the same single-use/expiry machinery is still what gets exercised.
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT t.id::text AS id FROM email_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE u.email = ${userEmail}::citext AND t.purpose = ${purpose}::email_token_purpose
      AND t.consumed_at IS NULL
    ORDER BY t.created_at DESC LIMIT 1`;
  expect(rows, `no unconsumed ${purpose} token for ${userEmail}`).toHaveLength(1);

  const plaintext = `test-token-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const hash = await db.$queryRaw<Array<{ h: Buffer }>>`SELECT digest(${plaintext}, 'sha256') AS h`;
  await db.$executeRaw`
    UPDATE email_tokens SET token_hash = ${hash[0]!.h} WHERE id = ${rows[0]!.id}::uuid`;
  return plaintext;
}

async function registerAndVerify(request: APIRequestContext, email: string): Promise<void> {
  const token = await csrf(request);
  const registered = await post(
    request,
    '/api/auth/register',
    {
      email,
      password: STRONG,
      full_name: 'API Test',
    },
    token,
  );
  expect(registered.status()).toBe(202);
  const verifyToken = await tokenFor(email, 'verify_email');
  const verified = await post(request, '/api/auth/verify-email', { token: verifyToken }, token);
  expect(verified.status()).toBe(200);
}

/**
 * Clears accumulated throttle state between tests.
 *
 * Every test in this file arrives from 127.0.0.1, so they share one per-IP
 * budget. With the approved limits — forgot-password 5/hour, register 10/hour —
 * a handful of independent tests exhausts it and later ones receive 429 instead
 * of the behaviour under test. That is the throttle working correctly, not a
 * defect, so the state is reset rather than the thresholds relaxed.
 *
 * This file tests ENDPOINT SEMANTICS. Throttle behaviour itself is covered
 * exhaustively, and against the approved numbers, in
 * tests/integration/throttle.test.ts.
 */
test.beforeEach(async () => {
  await db.$executeRaw`DELETE FROM auth_attempts`;
});

test.afterAll(async () => {
  // Only auth_attempts is cleaned up. Test users are deliberately LEFT BEHIND,
  // and that is the Milestone 1 design asserting itself rather than an
  // oversight: audit_log.actor_user_id is ON DELETE RESTRICT and audit_log is
  // append-only, so once a user has an audit row they cannot be hard-deleted by
  // anyone, including a test. candidate_profiles is RESTRICT for the same
  // reason. Erasing a person is therefore gated on their audit records ageing
  // out, which is the open retention decision (#9/#9a).
  //
  // Harmless here: every address is unique per run, so rows accumulate without
  // affecting idempotency, and CI starts from a fresh database each time.
  await db.$executeRaw`DELETE FROM auth_attempts`;
  await db.$disconnect();
});

test.describe('register', () => {
  test('accepts a new candidate and creates profile, token, notification and audit', async ({
    request,
  }) => {
    const email = uniqueEmail('new');
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/register',
      {
        email,
        password: STRONG,
        full_name: 'Jane Candidate',
      },
      token,
    );

    expect(response.status()).toBe(202);
    const body = await response.json();
    expect(body.data.accepted).toBe(true);

    const rows = await db.$queryRaw<Array<{ status: string; verified: Date | null }>>`
      SELECT status::text AS status, email_verified_at AS verified
      FROM users WHERE email = ${email}::citext`;
    expect(rows[0]!.status).toBe('invited');
    expect(rows[0]!.verified).toBeNull();

    const counts = await db.$queryRaw<
      Array<{ profiles: bigint; tokens: bigint; notes: bigint; audits: bigint }>
    >`
      SELECT (SELECT count(*) FROM candidate_profiles p JOIN users u ON u.id = p.user_id WHERE u.email = ${email}::citext) AS profiles,
             (SELECT count(*) FROM email_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = ${email}::citext AND t.purpose = 'verify_email') AS tokens,
             (SELECT count(*) FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = ${email}::citext AND n.template_key = 'auth.verify_email') AS notes,
             (SELECT count(*) FROM audit_log a JOIN users u ON u.id = a.actor_user_id WHERE u.email = ${email}::citext AND a.action = 'auth.register') AS audits`;
    expect(Number(counts[0]!.profiles)).toBe(1);
    expect(Number(counts[0]!.tokens)).toBe(1);
    expect(Number(counts[0]!.notes)).toBe(1);
    expect(Number(counts[0]!.audits)).toBe(1);
  });

  test('queued notification carries no token, so none rests in the database', async ({
    request,
  }) => {
    const email = uniqueEmail('nopayload');
    const token = await csrf(request);
    await post(request, '/api/auth/register', { email, password: STRONG, full_name: 'N' }, token);
    const rows = await db.$queryRaw<Array<{ payload: unknown }>>`
      SELECT payload_json AS payload FROM notifications n
      JOIN users u ON u.id = n.user_id WHERE u.email = ${email}::citext`;
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/token/i);
  });

  test('gives an existing address the SAME 202 and creates no second account', async ({
    request,
  }) => {
    const email = uniqueEmail('dup');
    const token = await csrf(request);
    const first = await post(
      request,
      '/api/auth/register',
      { email, password: STRONG, full_name: 'A' },
      token,
    );
    const second = await post(
      request,
      '/api/auth/register',
      { email, password: STRONG, full_name: 'B' },
      token,
    );

    // Identical status and identical payload. Only request_id differs, which is
    // per-request by design, so the comparison is on `data` alone.
    expect(second.status()).toBe(first.status());
    expect((await second.json()).data).toEqual((await first.json()).data);
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM users WHERE email = ${email}::citext`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test('rejects a password under the 12-character minimum', async ({ request }) => {
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/register',
      {
        email: uniqueEmail('short'),
        password: 'short1',
        full_name: 'S',
      },
      token,
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  test('rejects a password from the breached corpus', async ({ request }) => {
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/register',
      {
        email: uniqueEmail('breached'),
        // secret-scan-allow: a throwaway fixture from the breached-password corpus, chosen BECAUSE it must be rejected. Never a real credential.
        password: 'passwordpassword',
        full_name: 'B',
      },
      token,
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error.fields.password).toMatch(/data breach/i);
  });
});

test.describe('verify-email', () => {
  test('activates the account, and the token cannot be replayed', async ({ request }) => {
    const email = uniqueEmail('verify');
    const token = await csrf(request);
    await post(request, '/api/auth/register', { email, password: STRONG, full_name: 'V' }, token);
    const verifyToken = await tokenFor(email, 'verify_email');

    const first = await post(request, '/api/auth/verify-email', { token: verifyToken }, token);
    expect(first.status()).toBe(200);

    const rows = await db.$queryRaw<Array<{ status: string; verified: Date | null }>>`
      SELECT status::text AS status, email_verified_at AS verified FROM users WHERE email = ${email}::citext`;
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.verified).not.toBeNull();

    const replay = await post(request, '/api/auth/verify-email', { token: verifyToken }, token);
    expect(replay.status()).toBe(401);
  });

  test('refuses an unknown token with the same message as a used one', async ({ request }) => {
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/verify-email',
      { token: 'x'.repeat(43) },
      token,
    );
    expect(response.status()).toBe(401);
    expect((await response.json()).error.message).toMatch(/no longer valid/i);
  });

  test('refuses an expired token', async ({ request }) => {
    const email = uniqueEmail('expired');
    const token = await csrf(request);
    await post(request, '/api/auth/register', { email, password: STRONG, full_name: 'E' }, token);
    const verifyToken = await tokenFor(email, 'verify_email');
    await db.$executeRaw`
      UPDATE email_tokens SET expires_at = now() - interval '1 minute'
      WHERE user_id = (SELECT id FROM users WHERE email = ${email}::citext)`;
    const response = await post(request, '/api/auth/verify-email', { token: verifyToken }, token);
    expect(response.status()).toBe(401);
  });
});

test.describe('login and session', () => {
  test('refuses an unverified account, accepts it once verified', async ({ request }) => {
    const email = uniqueEmail('login');
    const token = await csrf(request);
    await post(request, '/api/auth/register', { email, password: STRONG, full_name: 'L' }, token);

    const before = await post(request, '/api/auth/login', { email, password: STRONG }, token);
    expect(before.status()).toBe(401);

    const verifyToken = await tokenFor(email, 'verify_email');
    await post(request, '/api/auth/verify-email', { token: verifyToken }, token);

    const after = await post(request, '/api/auth/login', { email, password: STRONG }, token);
    expect(after.status()).toBe(200);
  });

  test('/api/me returns the user with roles, and 401 without a session', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL });
    expect((await anonymous.get('/api/me')).status()).toBe(401);
    await anonymous.dispose();

    const signedIn = await playwright.request.newContext({ baseURL: BASE_URL });
    const email = uniqueEmail('me');
    await registerAndVerify(signedIn, email);
    const token = await csrf(signedIn);
    expect(
      (await post(signedIn, '/api/auth/login', { email, password: STRONG }, token)).status(),
    ).toBe(200);

    const me = await signedIn.get('/api/me');
    expect(me.status()).toBe(200);
    const body = await me.json();
    expect(body.data.email).toBe(email);
    expect(body.data.email_verified).toBe(true);
    // Roles are returned but nothing acts on them: authorisation is M3.
    expect(Array.isArray(body.data.roles)).toBe(true);
    await signedIn.dispose();
  });
});

test.describe('logout', () => {
  test('revokes the session and is idempotent', async ({ playwright }) => {
    const context = await playwright.request.newContext({ baseURL: BASE_URL });
    const email = uniqueEmail('logout');
    await registerAndVerify(context, email);
    const token = await csrf(context);
    await post(context, '/api/auth/login', { email, password: STRONG }, token);
    expect((await context.get('/api/me')).status()).toBe(200);

    const first = await post(context, '/api/auth/logout', {}, token);
    expect(first.status()).toBe(200);
    expect((await context.get('/api/me')).status()).toBe(401);

    // Idempotent: signing out twice is not an error.
    const second = await post(context, '/api/auth/logout', {}, token);
    expect(second.status()).toBe(200);

    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM audit_log a JOIN users u ON u.id = a.actor_user_id
      WHERE u.email = ${email}::citext AND a.action = 'auth.logout'`;
    expect(Number(rows[0]!.n)).toBe(1);
    await context.dispose();
  });
});

test.describe('forgot-password', () => {
  test('returns 202 for an unknown address and issues no token', async ({ request }) => {
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/forgot-password',
      { email: uniqueEmail('ghost') },
      token,
    );
    expect(response.status()).toBe(202);
  });

  test('returns the SAME 202 for a known address and issues a token', async ({ request }) => {
    const email = uniqueEmail('forgot');
    await registerAndVerify(request, email);
    const token = await csrf(request);
    const response = await post(request, '/api/auth/forgot-password', { email }, token);
    expect(response.status()).toBe(202);

    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM email_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.email = ${email}::citext AND t.purpose = 'reset_password'`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test('stops at the approved 3 per hour per account, still returning 202', async ({ request }) => {
    const email = uniqueEmail('flood');
    await registerAndVerify(request, email);
    const token = await csrf(request);
    for (let i = 0; i < 4; i += 1) {
      const response = await post(request, '/api/auth/forgot-password', { email }, token);
      expect(response.status()).toBe(202);
    }
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM email_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.email = ${email}::citext AND t.purpose = 'reset_password'`;
    // The fourth request is accepted but issues nothing — the caller is never
    // told, because telling them would confirm the address exists.
    expect(Number(rows[0]!.n)).toBe(3);
  });

  test('returns 202 even for a malformed address', async ({ request }) => {
    const token = await csrf(request);
    expect(
      (await post(request, '/api/auth/forgot-password', { email: 'not-an-email' }, token)).status(),
    ).toBe(202);
  });
});

test.describe('reset-password', () => {
  test('resets, revokes every session, and the token cannot be replayed', async ({
    playwright,
  }) => {
    const context = await playwright.request.newContext({ baseURL: BASE_URL });
    const email = uniqueEmail('reset');
    await registerAndVerify(context, email);
    const token = await csrf(context);
    await post(context, '/api/auth/login', { email, password: STRONG }, token);
    expect((await context.get('/api/me')).status()).toBe(200);

    await post(context, '/api/auth/forgot-password', { email }, token);
    const resetToken = await tokenFor(email, 'reset_password');
    const newPassword = 'a-different-long-passphrase-77';

    const response = await post(
      context,
      '/api/auth/reset-password',
      { token: resetToken, password: newPassword },
      token,
    );
    expect(response.status()).toBe(200);
    expect((await response.json()).data.sessions_revoked).toBeGreaterThanOrEqual(1);

    // The session held before the reset is dead.
    expect((await context.get('/api/me')).status()).toBe(401);

    const replay = await post(
      context,
      '/api/auth/reset-password',
      { token: resetToken, password: newPassword },
      token,
    );
    expect(replay.status()).toBe(401);

    // Old password no longer works; new one does.
    expect(
      (await post(context, '/api/auth/login', { email, password: STRONG }, token)).status(),
    ).toBe(401);
    expect(
      (await post(context, '/api/auth/login', { email, password: newPassword }, token)).status(),
    ).toBe(200);
    await context.dispose();
  });

  test('rejects a breached new password', async ({ request }) => {
    const email = uniqueEmail('resetweak');
    await registerAndVerify(request, email);
    const token = await csrf(request);
    await post(request, '/api/auth/forgot-password', { email }, token);
    const resetToken = await tokenFor(email, 'reset_password');
    const response = await post(
      request,
      '/api/auth/reset-password',
      // secret-scan-allow: throwaway fixture password for a test user created and discarded in this spec.
      { token: resetToken, password: 'passwordpassword' },
      token,
    );
    expect(response.status()).toBe(400);
  });
});

test.describe('accept-invite', () => {
  /**
   * Invite ISSUANCE is Milestone 8 (an admin screen), so the invited user and
   * the token are created directly here. That is the approved shape of this
   * milestone: consumption only.
   */
  async function inviteUser(email: string): Promise<string> {
    const plaintext = `invite-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    await db.$executeRaw`
      INSERT INTO users (email, password_hash, status)
      VALUES (${email}::citext, 'awaiting-invite-acceptance', 'invited')`;
    await db.$executeRaw`
      INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
      SELECT id, 'accept_invite'::email_token_purpose, digest(${plaintext}, 'sha256'),
             now() + interval '7 days'
      FROM users WHERE email = ${email}::citext`;
    return plaintext;
  }

  test('sets the initial password, activates the account, and enables sign-in', async ({
    playwright,
  }) => {
    const context = await playwright.request.newContext({ baseURL: BASE_URL });
    const email = uniqueEmail('invite');
    const inviteToken = await inviteUser(email);
    const token = await csrf(context);

    const accepted = await post(
      context,
      '/api/auth/accept-invite',
      { token: inviteToken, password: STRONG },
      token,
    );
    expect(accepted.status()).toBe(200);

    const rows = await db.$queryRaw<
      Array<{ status: string; verified: Date | null; changed: Date | null }>
    >`
      SELECT status::text AS status, email_verified_at AS verified, password_changed_at AS changed
      FROM users WHERE email = ${email}::citext`;
    expect(rows[0]!.status).toBe('active');
    expect(rows[0]!.verified).not.toBeNull();
    expect(rows[0]!.changed).not.toBeNull();

    // No session is issued by accept-invite, so /api/me is still anonymous.
    expect((await context.get('/api/me')).status()).toBe(401);
    // The new password works.
    expect(
      (await post(context, '/api/auth/login', { email, password: STRONG }, token)).status(),
    ).toBe(200);

    const audits = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM audit_log a JOIN users u ON u.id = a.actor_user_id
      WHERE u.email = ${email}::citext AND a.action = 'auth.invite_accepted'`;
    expect(Number(audits[0]!.n)).toBe(1);
    await context.dispose();
  });

  test('cannot be replayed', async ({ request }) => {
    const email = uniqueEmail('invite-replay');
    const inviteToken = await inviteUser(email);
    const token = await csrf(request);
    expect(
      (
        await post(
          request,
          '/api/auth/accept-invite',
          { token: inviteToken, password: STRONG },
          token,
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await post(
          request,
          '/api/auth/accept-invite',
          { token: inviteToken, password: STRONG },
          token,
        )
      ).status(),
    ).toBe(401);
  });

  test('rejects a breached password and leaves the token unconsumed', async ({ request }) => {
    const email = uniqueEmail('invite-weak');
    const inviteToken = await inviteUser(email);
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/accept-invite',
      // secret-scan-allow: throwaway fixture password for a test user created and discarded in this spec.
      { token: inviteToken, password: 'passwordpassword' },
      token,
    );
    expect(response.status()).toBe(400);

    // The token must survive a rejected password, or a typo would burn the
    // invitation and need an admin to reissue it.
    const rows = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*) AS n FROM email_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.email = ${email}::citext AND t.purpose = 'accept_invite' AND t.consumed_at IS NULL`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  test('refuses a verify_email token presented as an invite', async ({ request }) => {
    // Purpose is part of the lookup, so a token cannot be used across flows.
    const email = uniqueEmail('cross-purpose');
    await registerAndVerify(request, email);
    const token = await csrf(request);
    const response = await post(
      request,
      '/api/auth/accept-invite',
      { token: 'y'.repeat(43), password: STRONG },
      token,
    );
    expect(response.status()).toBe(401);
  });
});

test.describe('CSRF is enforced on every state-changing endpoint', () => {
  const endpoints = [
    '/api/auth/register',
    '/api/auth/verify-email',
    '/api/auth/accept-invite',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
  ];

  for (const path of endpoints) {
    test(`${path} refuses a request with no CSRF token`, async ({ request }) => {
      const response = await request.post(path, {
        data: {},
        headers: { origin: process.env.APP_ORIGIN! },
      });
      expect(response.status()).toBe(403);
    });

    test(`${path} refuses a foreign Origin`, async ({ request }) => {
      const token = await csrf(request);
      const response = await request.post(path, {
        data: {},
        headers: { 'x-csrf-token': token, origin: 'https://evil.example' },
      });
      expect(response.status()).toBe(403);
    });
  }

  test('/api/me needs no CSRF token, being read-only', async ({ request }) => {
    expect([200, 401]).toContain((await request.get('/api/me')).status());
  });
});

test.describe('no endpoint leaks internals', () => {
  test('error bodies contain no driver, path or schema detail', async ({ request }) => {
    const token = await csrf(request);
    const responses = await Promise.all([
      // secret-scan-allow: a deliberately WRONG password, sent to prove login throttling refuses it.
      post(request, '/api/auth/login', { email: 'x@y.test', password: 'wrongwrongwrong' }, token),
      post(request, '/api/auth/verify-email', { token: 'z'.repeat(40) }, token),
      post(request, '/api/auth/reset-password', { token: 'z'.repeat(40), password: STRONG }, token),
    ]);
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toMatch(
        /postgres|password_hash|email_tokens|node_modules|\/home\/|at Object/i,
      );
      expect(JSON.parse(text).error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
