import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { resolveEntryLocale, readCookieValue } from '@/i18n/entry-locale';
import { SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Locale resolution for a locale-less entry point, against a REAL PostgreSQL.
 *
 * The recorded decision has two halves, and the second is the one worth
 * testing: the stored preference is CONSULTED at a locale-less entry, and never
 * WRITTEN. A visit must not silently re-record someone's language.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

let db: PrismaClient;
const DOMAIN = 'entry.test';
const unique = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;

async function makeUser(
  email: string,
  options: { locale?: string; status?: string; revoked?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash, status, email_verified_at, locale)
    VALUES (${email}::citext, 'not-a-real-hash', ${options.status ?? 'active'}::user_status,
            now(), ${options.locale ?? 'en'})
    RETURNING id::text AS id`;
  const userId = rows[0]!.id;

  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token, 'utf8').digest();
  await db.$executeRaw`
    INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
    VALUES (${userId}::uuid, ${hash}, now() + interval '1 day',
            ${options.revoked ? new Date() : null})`;

  if (options.deleted) {
    await db.$executeRaw`UPDATE users SET deleted_at = now() WHERE id = ${userId}::uuid`;
  }
  return token;
}

const cookie = (token: string) => `${SESSION_COOKIE}=${token}`;

describeIfDb('resolveEntryLocale', () => {
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

  it('uses the stored preference for a signed-in user', async () => {
    expect(await resolveEntryLocale(cookie(await makeUser(unique('ar'), { locale: 'ar' })))).toBe(
      'ar',
    );
    expect(await resolveEntryLocale(cookie(await makeUser(unique('en'), { locale: 'en' })))).toBe(
      'en',
    );
  });

  it('NEVER writes the stored preference', async () => {
    // The decision is explicit: opening a page must not re-record a language.
    const email = unique('no-write');
    const token = await makeUser(email, { locale: 'ar' });
    await resolveEntryLocale(cookie(token));
    const rows = await db.$queryRaw<Array<{ locale: string }>>`
      SELECT locale FROM users WHERE email = ${email}::citext`;
    expect(rows[0]?.locale).toBe('ar');
  });

  it.each([
    ['no cookie header at all', undefined],
    ['a cookie header with no session', 'other=value'],
    ['an unknown session token', `${SESSION_COOKIE}=not-a-real-token`],
  ])('falls back to the default with %s', async (_label, header) => {
    expect(await resolveEntryLocale(header)).toBe('en');
  });

  it('falls back to the default for a revoked session', async () => {
    const token = await makeUser(unique('revoked'), { locale: 'ar', revoked: true });
    expect(await resolveEntryLocale(cookie(token))).toBe('en');
  });

  it('falls back to the default for a suspended account', async () => {
    const token = await makeUser(unique('suspended'), { locale: 'ar', status: 'suspended' });
    expect(await resolveEntryLocale(cookie(token))).toBe('en');
  });

  it('falls back to the default for a soft-deleted user', async () => {
    const token = await makeUser(unique('deleted'), { locale: 'ar', deleted: true });
    expect(await resolveEntryLocale(cookie(token))).toBe('en');
  });

  it('reads the session cookie out of a crowded header', async () => {
    const token = await makeUser(unique('crowded'), { locale: 'ar' });
    const header = `gegs_csrf=abc; ${SESSION_COOKIE}=${token}; other=1`;
    expect(await resolveEntryLocale(header)).toBe('ar');
  });

  it('does not confuse a cookie whose name merely ends the same way', async () => {
    const token = await makeUser(unique('prefix'), { locale: 'ar' });
    expect(readCookieValue(`not_${SESSION_COOKIE}=${token}`, SESSION_COOKIE)).toBeUndefined();
  });
});
