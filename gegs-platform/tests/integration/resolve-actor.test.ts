import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { ApiError } from '@/lib/api/errors';
import { resolveActor } from '@/lib/auth/guard';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Actor resolution against a REAL PostgreSQL.
 *
 * The point is that roles and employer membership are read from the database on
 * every request, never from the cookie. A role cached in a token would keep
 * working after it was revoked; this proves a revoked grant takes effect on the
 * next call.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

let db: PrismaClient;
const DOMAIN = 'actor.test';
const unique = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;

/** Creates a user and a live session, returning the plaintext session token. */
async function makeSignedInUser(
  email: string,
  options: {
    status?: string;
    roles?: string[];
    employerName?: string;
    employerNames?: string[];
  } = {},
): Promise<string> {
  const status = options.status ?? 'active';
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash, status, email_verified_at)
    VALUES (${email}::citext, 'not-a-real-hash', ${status}::user_status, now())
    RETURNING id::text AS id`;
  const userId = rows[0]!.id;

  for (const key of options.roles ?? []) {
    await db.$executeRaw`
      INSERT INTO user_roles (user_id, role_id)
      SELECT ${userId}::uuid, id FROM roles WHERE key = ${key}`;
  }

  // `employerNames` exists only so the ambiguous-membership case can be set up;
  // `employerName` keeps working unchanged for every single-employer test.
  const employerNames =
    options.employerNames ?? (options.employerName ? [options.employerName] : []);
  for (const employerName of employerNames) {
    await db.$executeRaw`
      INSERT INTO employers (name) VALUES (${employerName})
      ON CONFLICT DO NOTHING`;
    await db.$executeRaw`
      INSERT INTO employer_contacts (employer_id, user_id, is_primary)
      SELECT id, ${userId}::uuid, false FROM employers WHERE name = ${employerName} LIMIT 1`;
  }

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await db.$executeRaw`
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (${userId}::uuid, ${hash}, now() + interval '1 day')`;
  return token;
}

function requestWithSession(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set('cookie', `${SESSION_COOKIE}=${token}`);
  return new Request('http://127.0.0.1:3000/api/anything', { headers });
}

describeIfDb('resolveActor', () => {
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await db.$connect();
  });

  afterEach(async () => {
    await db.$executeRaw`
      DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${'%@' + DOMAIN})`;
  });

  afterAll(async () => {
    // Users are not deleted: audit and profile FKs are RESTRICT by design
    // (Milestone 1). Addresses are unique per run, so rows accumulate harmlessly.
    await db?.$disconnect();
  });

  it('returns an anonymous actor with no cookie, so the policy refuses step 1', async () => {
    const actor = await resolveActor(requestWithSession());
    expect(actor.sessionValid).toBe(false);
    expect(actor.roles).toEqual([]);
  });

  it('returns an anonymous actor for an unknown token', async () => {
    const actor = await resolveActor(requestWithSession(randomBytes(32).toString('base64url')));
    expect(actor.sessionValid).toBe(false);
  });

  it('loads roles from the database, not the cookie', async () => {
    const token = await makeSignedInUser(unique('consultant'), { roles: ['consultant'] });
    const actor = await resolveActor(requestWithSession(token));
    expect(actor.sessionValid).toBe(true);
    expect(actor.status).toBe('active');
    expect(actor.roles).toEqual(['consultant']);
  });

  it('loads multiple roles', async () => {
    const token = await makeSignedInUser(unique('multi'), {
      roles: ['consultant', 'case_officer'],
    });
    const actor = await resolveActor(requestWithSession(token));
    expect([...actor.roles].sort()).toEqual(['case_officer', 'consultant']);
  });

  it('reflects a revoked role on the very next request', async () => {
    const email = unique('revoke');
    const token = await makeSignedInUser(email, { roles: ['manager'] });
    expect((await resolveActor(requestWithSession(token))).roles).toEqual(['manager']);

    await db.$executeRaw`
      DELETE FROM user_roles
      WHERE user_id = (SELECT id FROM users WHERE email = ${email}::citext)`;

    // No cache, no token claim: the grant is gone immediately.
    expect((await resolveActor(requestWithSession(token))).roles).toEqual([]);
  });

  it('carries the employer for an employer contact', async () => {
    const token = await makeSignedInUser(unique('employer'), {
      roles: ['employer'],
      employerName: `Employer ${Date.now()}`,
    });
    const actor = await resolveActor(requestWithSession(token));
    expect(actor.roles).toEqual(['employer']);
    expect(actor.employerId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses outright when a user is a contact for more than one employer', async () => {
    // Whether this may happen in v1 is an OPEN DECISION. The approved schema
    // permits the rows; `Actor.employerId` holds one value. resolveActor must
    // therefore choose nothing: no arbitrary employer, no silent loss of reach.
    const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const token = await makeSignedInUser(unique('multi-employer'), {
      roles: ['employer'],
      employerNames: [`Employer A ${run}`, `Employer B ${run}`],
    });

    await expect(resolveActor(requestWithSession(token))).rejects.toBeInstanceOf(ApiError);

    const error = await resolveActor(requestWithSession(token)).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    // Fails closed as INTERNAL, and tells the client nothing about employers,
    // memberships, or how many there were.
    expect((error as ApiError).code).toBe('INTERNAL');
    expect((error as ApiError).message).toBe(
      'Something went wrong. Quote this reference if you contact us.',
    );
  });

  it('leaves employerId null for a non-employer, so employer reach matches nothing', async () => {
    const token = await makeSignedInUser(unique('noemployer'), { roles: ['consultant'] });
    const actor = await resolveActor(requestWithSession(token));
    expect(actor.employerId).toBeNull();
  });

  it('refuses a suspended account at the session layer', async () => {
    // resolveSession already requires status = 'active', so a suspended user
    // never even reaches the role lookup.
    const token = await makeSignedInUser(unique('suspended'), {
      status: 'suspended',
      roles: ['admin'],
    });
    const actor = await resolveActor(requestWithSession(token));
    expect(actor.sessionValid).toBe(false);
  });

  it('refuses a revoked session', async () => {
    const email = unique('revoked-session');
    const token = await makeSignedInUser(email, { roles: ['manager'] });
    await db.$executeRaw`
      UPDATE sessions SET revoked_at = now()
      WHERE user_id = (SELECT id FROM users WHERE email = ${email}::citext)`;
    expect((await resolveActor(requestWithSession(token))).sessionValid).toBe(false);
  });

  it('discards an unrecognised role key rather than passing it through', async () => {
    const email = unique('badrole');
    const token = await makeSignedInUser(email, { roles: ['consultant'] });
    // A typo in a future seed must not widen anyone's reach.
    await db.$executeRaw`
      INSERT INTO roles (key, name_en) VALUES ('not_a_real_role', 'Bogus')
      ON CONFLICT (key) DO NOTHING`;
    await db.$executeRaw`
      INSERT INTO user_roles (user_id, role_id)
      SELECT (SELECT id FROM users WHERE email = ${email}::citext),
             (SELECT id FROM roles WHERE key = 'not_a_real_role')`;

    const actor = await resolveActor(requestWithSession(token));
    expect(actor.roles).toEqual(['consultant']);

    await db.$executeRaw`
      DELETE FROM user_roles WHERE role_id = (SELECT id FROM roles WHERE key = 'not_a_real_role')`;
    await db.$executeRaw`DELETE FROM roles WHERE key = 'not_a_real_role'`;
  });
});
