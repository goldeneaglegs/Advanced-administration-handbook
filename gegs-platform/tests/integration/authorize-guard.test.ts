import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ApiError, statusForCode } from '@/lib/api/errors';
import { authorize, guardAuthorized } from '@/lib/auth/guard';
import { CSRF_COOKIE, CSRF_HEADER } from '@/lib/auth/csrf';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * The two guard entry points an endpoint will actually call, against a REAL
 * PostgreSQL and the real CSRF layer.
 *
 * `resolveActor` and `requirePolicy` are covered separately. What is proven
 * here is the COMPOSITION: that the authenticated guards resolve the actor from
 * the database rather than trusting the request, that a refusal from the
 * committed policy survives the guard with its status intact, and — the
 * ordering that matters most — that CSRF is validated BEFORE anything touches
 * the policy or the database on a state-changing request.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const APP_ORIGIN = process.env.APP_ORIGIN;
const describeIfDb = DATABASE_URL && APP_ORIGIN ? describe : describe.skip;

let db: PrismaClient;
const DOMAIN = 'guard.test';
const unique = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;

/** A second user id, used as the owner of a record the actor does not reach. */
const SOMEBODY_ELSE = '00000000-0000-7000-8000-00000000beef';

async function makeSignedInUser(
  email: string,
  options: { roles?: string[]; employerNames?: string[] } = {},
): Promise<{ token: string; userId: string }> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash, status, email_verified_at)
    VALUES (${email}::citext, 'not-a-real-hash', 'active'::user_status, now())
    RETURNING id::text AS id`;
  const userId = rows[0]!.id;

  for (const key of options.roles ?? []) {
    await db.$executeRaw`
      INSERT INTO user_roles (user_id, role_id)
      SELECT ${userId}::uuid, id FROM roles WHERE key = ${key}`;
  }

  for (const employerName of options.employerNames ?? []) {
    await db.$executeRaw`INSERT INTO employers (name) VALUES (${employerName})`;
    await db.$executeRaw`
      INSERT INTO employer_contacts (employer_id, user_id, is_primary)
      SELECT id, ${userId}::uuid, false FROM employers WHERE name = ${employerName} LIMIT 1`;
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await db.$executeRaw`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}::uuid, ${hash}, now() + interval '1 day')`;
  return { token, userId };
}

/** A GET-shaped request: session cookie only, no CSRF material needed. */
function readRequest(session?: string): Request {
  const headers = new Headers();
  if (session) headers.set('cookie', `${SESSION_COOKIE}=${session}`);
  return new Request(`${APP_ORIGIN!}/api/anything`, { headers });
}

type Csrf = 'valid' | 'no-token' | 'no-cookie' | 'mismatch' | 'bad-origin' | 'no-origin';

/** A state-changing request, with CSRF material in whatever state is wanted. */
function writeRequest(options: { session?: string; csrf: Csrf }): Request {
  const cookieToken = randomBytes(32).toString('base64url');
  const cookies: string[] = [];
  if (options.session) cookies.push(`${SESSION_COOKIE}=${options.session}`);
  if (options.csrf !== 'no-cookie') cookies.push(`${CSRF_COOKIE}=${cookieToken}`);

  const headers = new Headers({ 'content-type': 'application/json' });
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '));

  if (options.csrf === 'bad-origin') headers.set('origin', 'https://attacker.example');
  else if (options.csrf !== 'no-origin') headers.set('origin', APP_ORIGIN!);

  if (options.csrf === 'valid' || options.csrf === 'no-cookie') {
    headers.set(CSRF_HEADER, cookieToken);
  } else if (options.csrf === 'mismatch') {
    headers.set(CSRF_HEADER, randomBytes(32).toString('base64url'));
  }

  return new Request(`${APP_ORIGIN!}/api/anything`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ any: 'payload' }),
  });
}

/** Returns whatever the call threw, so the error itself can be asserted on. */
async function thrownBy(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

const CSRF_EXPIRED = 'Your session has expired. Reload the page and try again.';
const CSRF_ORIGIN = 'This request did not come from an allowed origin.';

describeIfDb('authorize / guardAuthorized', () => {
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await db.$connect();
  });

  afterEach(async () => {
    await db.$executeRaw`
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${'%@' + DOMAIN})`;
  });

  afterAll(async () => {
    // Users are not deleted: audit and profile FKs are RESTRICT by design (M1).
    await db?.$disconnect();
  });

  describe('authorize — the read guard', () => {
    it('resolves the actor from the database and returns it on the allow path', async () => {
      const { token, userId } = await makeSignedInUser(unique('consultant'), {
        roles: ['consultant'],
      });
      // Granted and GLOBAL, so no subject is passed: the §4.2 search/detail
      // split is preserved, not bypassed.
      const actor = await authorize(readRequest(token), 'candidate_profile.search');
      expect(actor.userId).toBe(userId);
      expect(actor.roles).toEqual(['consultant']);
      expect(actor.sessionValid).toBe(true);
    });

    it('does not trust the request for roles — the grant comes from the database', async () => {
      // The role is granted in the database AFTER the session exists, and the
      // request never carries it. The same request flips from refused to
      // allowed, which is only possible if the guard reads the database.
      const email = unique('late-grant');
      const { token } = await makeSignedInUser(email, { roles: ['candidate'] });
      const request = () => authorize(readRequest(token), 'candidate_profile.search');

      expect(((await thrownBy(request())) as ApiError).code).toBe('FORBIDDEN');

      await db.$executeRaw`
        INSERT INTO user_roles (user_id, role_id)
        SELECT (SELECT id FROM users WHERE email = ${email}::citext),
               (SELECT id FROM roles WHERE key = 'consultant')`;

      await expect(request()).resolves.toMatchObject({ sessionValid: true });
    });

    it('enforces a policy denial — an ungranted action is FORBIDDEN, status 403', async () => {
      const { token } = await makeSignedInUser(unique('candidate'), { roles: ['candidate'] });
      const error = await thrownBy(authorize(readRequest(token), 'candidate_profile.search'));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('FORBIDDEN');
      expect(statusForCode((error as ApiError).code)).toBe(403);
    });

    it('refuses an anonymous request as UNAUTHENTICATED, status 401', async () => {
      const error = await thrownBy(authorize(readRequest(), 'candidate_profile.search'));
      expect((error as ApiError).code).toBe('UNAUTHENTICATED');
      expect(statusForCode((error as ApiError).code)).toBe(401);
    });

    it('keeps an unreachable record NOT_FOUND with status 404, never 403', async () => {
      const { token } = await makeSignedInUser(unique('unreachable'), { roles: ['consultant'] });
      // Granted the action, but the record belongs to somebody else. A 403 here
      // would confirm the record exists (Phase 1 §4.2).
      const error = await thrownBy(
        authorize(readRequest(token), 'candidate_profile.read_detail', {
          ownerUserId: SOMEBODY_ELSE,
        }),
      );
      expect((error as ApiError).code).toBe('NOT_FOUND');
      expect(statusForCode((error as ApiError).code)).toBe(404);
      expect((error as ApiError).message).toBe('Not found.');
    });

    it('allows the same actor the same action on a record they own', async () => {
      const { token, userId } = await makeSignedInUser(unique('owner'), { roles: ['consultant'] });
      const actor = await authorize(readRequest(token), 'candidate_profile.read_detail', {
        ownerUserId: userId,
      });
      expect(actor.userId).toBe(userId);
    });
  });

  describe('guardAuthorized — the write guard', () => {
    it('returns actor, context and body on the allow path', async () => {
      const { token, userId } = await makeSignedInUser(unique('transition'), {
        roles: ['consultant'],
      });
      const result = await guardAuthorized(
        writeRequest({ session: token, csrf: 'valid' }),
        'application.transition',
        { ownerUserId: userId },
      );
      expect(result.actor.userId).toBe(userId);
      expect(result.body).toEqual({ any: 'payload' });
      expect(result.context.requestId).toMatch(/\S/);
    });

    it('enforces the policy on a write once CSRF has passed', async () => {
      const { token } = await makeSignedInUser(unique('write-forbidden'), { roles: ['candidate'] });
      const error = await thrownBy(
        guardAuthorized(writeRequest({ session: token, csrf: 'valid' }), 'application.transition', {
          ownerUserId: SOMEBODY_ELSE,
        }),
      );
      expect((error as ApiError).code).toBe('FORBIDDEN');
    });

    it('keeps an unreachable record NOT_FOUND on a write too', async () => {
      const { token } = await makeSignedInUser(unique('write-unreachable'), {
        roles: ['consultant'],
      });
      const error = await thrownBy(
        guardAuthorized(writeRequest({ session: token, csrf: 'valid' }), 'application.transition', {
          ownerUserId: SOMEBODY_ELSE,
        }),
      );
      expect((error as ApiError).code).toBe('NOT_FOUND');
      expect(statusForCode((error as ApiError).code)).toBe(404);
    });

    it('validates CSRF BEFORE the policy — an anonymous request with no CSRF fails on CSRF', async () => {
      // The decisive ordering test. This request fails BOTH layers. If the
      // policy ran first it would return UNAUTHENTICATED; the CSRF wording
      // proves CSRF ran first.
      const error = await thrownBy(
        guardAuthorized(writeRequest({ csrf: 'no-cookie' }), 'application.transition'),
      );
      expect((error as ApiError).code).toBe('FORBIDDEN');
      expect((error as ApiError).message).toBe(CSRF_EXPIRED);
    });

    it('reaches the policy only once CSRF passes — same actor, valid CSRF, now UNAUTHENTICATED', async () => {
      // The other half of the ordering proof: with CSRF satisfied, the very
      // same anonymous request is refused by the policy instead.
      const error = await thrownBy(
        guardAuthorized(writeRequest({ csrf: 'valid' }), 'application.transition'),
      );
      expect((error as ApiError).code).toBe('UNAUTHENTICATED');
    });

    it('never touches actor resolution without CSRF — an ambiguous-membership user fails on CSRF', async () => {
      // This user would make `resolveActor` itself throw INTERNAL (more than
      // one employer membership). Getting the CSRF error instead proves no
      // database lookup and no policy call happened at all.
      const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { token } = await makeSignedInUser(unique('ambiguous'), {
        roles: ['employer'],
        employerNames: [`Guard A ${run}`, `Guard B ${run}`],
      });

      const refusedWithoutCsrf = await thrownBy(
        guardAuthorized(writeRequest({ session: token, csrf: 'mismatch' }), 'requirement.update'),
      );
      expect((refusedWithoutCsrf as ApiError).code).toBe('FORBIDDEN');
      expect((refusedWithoutCsrf as ApiError).message).toBe(CSRF_EXPIRED);

      // With CSRF valid, the same request now does reach resolveActor, which
      // fails closed on the ambiguity. Confirms the first refusal was CSRF's.
      const refusedWithCsrf = await thrownBy(
        guardAuthorized(writeRequest({ session: token, csrf: 'valid' }), 'requirement.update'),
      );
      expect((refusedWithCsrf as ApiError).code).toBe('INTERNAL');
    });

    it.each([
      ['a missing CSRF cookie', 'no-cookie' as Csrf, CSRF_EXPIRED],
      ['a missing submitted token', 'no-token' as Csrf, CSRF_EXPIRED],
      ['a mismatched token', 'mismatch' as Csrf, CSRF_EXPIRED],
      ['a foreign Origin', 'bad-origin' as Csrf, CSRF_ORIGIN],
      ['no Origin at all', 'no-origin' as Csrf, CSRF_ORIGIN],
    ])(
      'refuses a state-changing request with %s before any policy call',
      async (_label, csrf, message) => {
        // Each case uses a genuinely granted actor and a record they own, so the
        // ONLY possible reason for refusal is CSRF.
        const { token, userId } = await makeSignedInUser(unique('csrf'), {
          roles: ['consultant'],
        });
        const error = await thrownBy(
          guardAuthorized(writeRequest({ session: token, csrf }), 'application.transition', {
            ownerUserId: userId,
          }),
        );
        expect((error as ApiError).code).toBe('FORBIDDEN');
        expect((error as ApiError).message).toBe(message);
      },
    );
  });

  describe('deny-by-default survives both guards', () => {
    it('admin reaches no record-scoped action through either guard', async () => {
      // Phase 1 §4.2 admin exception: admin holds no record-scoped grant, so it
      // cannot reach a document even with valid CSRF and a live session.
      const { token, userId } = await makeSignedInUser(unique('admin'), { roles: ['admin'] });
      const read = await thrownBy(
        authorize(readRequest(token), 'document.read', { candidateUserId: userId }),
      );
      expect((read as ApiError).code).toBe('FORBIDDEN');

      const write = await thrownBy(
        guardAuthorized(writeRequest({ session: token, csrf: 'valid' }), 'application.transition', {
          ownerUserId: userId,
        }),
      );
      expect((write as ApiError).code).toBe('FORBIDDEN');
    });

    it('an employer with no employer membership reaches nothing, rather than everything', async () => {
      const { token } = await makeSignedInUser(unique('no-employer'), { roles: ['employer'] });
      const error = await thrownBy(
        authorize(readRequest(token), 'requirement.read', { employerId: SOMEBODY_ELSE }),
      );
      expect((error as ApiError).code).toBe('NOT_FOUND');
    });

    it('a role with no grant for an action is refused even on its own record', async () => {
      const { token, userId } = await makeSignedInUser(unique('deny-default'), {
        roles: ['candidate'],
      });
      // `application.transition` is granted to consultant only.
      const error = await thrownBy(
        authorize(readRequest(token), 'application.transition', { ownerUserId: userId }),
      );
      expect((error as ApiError).code).toBe('FORBIDDEN');
    });
  });
});
