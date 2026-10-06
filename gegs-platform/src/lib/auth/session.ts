import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/db';
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from '@/lib/auth/params';

/**
 * Opaque server-side sessions (Phase 1 §4.1).
 *
 * Not JWT, deliberately: a workflow product must be able to revoke a session
 * NOW — when a consultant leaves, when a device is lost. A stateless token
 * cannot be revoked, only waited out. The cost is one indexed read per
 * request, which is the right trade for a product holding identity documents.
 *
 * Only the SHA-256 of the token is stored, so a database leak does not hand
 * over live sessions.
 */
export const SESSION_COOKIE = 'gegs_session';
const TOKEN_BYTES = 32;

function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface CreatedSession {
  /** Set as the cookie value. Returned once; never stored, never logged. */
  token: string;
  expiresAt: Date;
}

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}

/** Creates a session and returns its plaintext token exactly once. */
export async function createSession(
  userId: string,
  context: SessionContext,
): Promise<CreatedSession> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);

  await getDb().$executeRaw`
    INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
    VALUES (${userId}::uuid, ${hashSessionToken(token)}, ${context.ip}::inet,
            ${context.userAgent}, ${expiresAt})`;

  return { token, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  userId: string;
  locale: string;
}

/**
 * Resolves a session token to its user, enforcing both the absolute and the
 * idle timeout, and refuses a session whose user is suspended or soft-deleted.
 *
 * The idle check is done here rather than by a scheduled job so that a stale
 * session is rejected on the next request, not merely at some later sweep.
 */
export async function resolveSession(token: string | undefined): Promise<ResolvedSession | null> {
  if (!token) return null;

  const rows = await getDb().$queryRaw<
    Array<{
      session_id: string;
      user_id: string;
      locale: string;
      last_seen_at: Date;
      token_hash: Buffer;
    }>
  >`
    SELECT s.id::text  AS session_id,
           s.user_id::text AS user_id,
           u.locale,
           s.last_seen_at,
           s.token_hash
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashSessionToken(token)}
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.status = 'active'
      AND u.deleted_at IS NULL`;

  const row = rows[0];
  if (!row) return null;

  // Defence in depth: the lookup above is already by hash, but comparing in
  // constant time keeps the code honest if the query is ever widened.
  const expected = hashSessionToken(token);
  if (row.token_hash.length !== expected.length || !timingSafeEqual(row.token_hash, expected)) {
    return null;
  }

  if (Date.now() - row.last_seen_at.getTime() > SESSION_IDLE_MS) {
    await revokeSession(row.session_id);
    return null;
  }

  return { sessionId: row.session_id, userId: row.user_id, locale: row.locale };
}

/** Refreshes the idle clock. Called after a successful resolve. */
export async function touchSession(sessionId: string): Promise<void> {
  await getDb().$executeRaw`
    UPDATE sessions SET last_seen_at = now() WHERE id = ${sessionId}::uuid`;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await getDb().$executeRaw`
    UPDATE sessions SET revoked_at = now()
    WHERE id = ${sessionId}::uuid AND revoked_at IS NULL`;
}

/**
 * Revokes every session belonging to a user.
 *
 * Called on password reset. Without this, a stolen session would survive the
 * very recovery intended to end it.
 */
export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  return getDb().$executeRaw`
    UPDATE sessions SET revoked_at = now()
    WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;
}

/** Cookie attributes. Secure is omitted over plain HTTP so local dev works. */
export function sessionCookieOptions(expiresAt: Date, isHttps: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isHttps,
    path: '/',
    expires: expiresAt,
  };
}
