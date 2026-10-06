import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { SESSION_COOKIE, resolveSession, touchSession } from '@/lib/auth/session';
import { getRequestContext, readCookie } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * The signed-in user, their locale and their roles.
 *
 * ROLES ARE RETURNED BUT NOTHING ACTS ON THEM. Milestone 2 implements no
 * authorisation: there is no policy layer, no permission check, and no endpoint
 * that branches on a role. That is Milestone 3, deliberately built before the
 * features that depend on it (Phase 1 §16), so that no feature can ship ahead
 * of the rules protecting it.
 *
 * The client may use these to decide what to DISPLAY. Phase 1 §4.2 is explicit
 * that such client-side checks are presentation only and are never trusted.
 *
 * Read-only, so no CSRF token is required and no throttle budget is consumed.
 */
interface Row {
  id: string;
  email: string;
  locale: string;
  timezone: string;
  email_verified_at: Date | null;
  role_keys: string[] | null;
}

export async function GET(request: Request): Promise<Response> {
  const context = getRequestContext(request);

  try {
    const session = await resolveSession(readCookie(request, SESSION_COOKIE));
    if (!session) {
      throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
    }

    const rows = await getDb().$queryRaw<Row[]>`
      SELECT u.id::text AS id,
             u.email::text AS email,
             u.locale,
             u.timezone,
             u.email_verified_at,
             array_remove(array_agg(r.key), NULL) AS role_keys
      FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.id = ${session.userId}::uuid AND u.deleted_at IS NULL
      GROUP BY u.id, u.email, u.locale, u.timezone, u.email_verified_at`;

    const row = rows[0];
    if (!row) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');

    // Refresh the idle clock only once the session is known good.
    await touchSession(session.sessionId);

    return ok(
      {
        id: row.id,
        email: row.email,
        locale: row.locale,
        timezone: row.timezone,
        email_verified: row.email_verified_at !== null,
        roles: row.role_keys ?? [],
      },
      context.requestId,
    );
  } catch (error) {
    return fail(error, context.requestId);
  }
}
