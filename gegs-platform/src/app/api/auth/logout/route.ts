import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { SESSION_COOKIE, resolveSession, revokeSession } from '@/lib/auth/session';
import {
  getRequestContext,
  readCookie,
  readJsonBody,
  requireCsrf,
} from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * Signs the current session out.
 *
 * IDEMPOTENT: always 200, whether a session existed or not. Reporting "you were
 * not signed in" would be a small information leak and, more practically, would
 * make a double-submitted sign-out look like a failure to the user.
 *
 * CSRF still applies — sign-out is state-changing, and letting a third-party
 * page sign a user out is a real (if minor) nuisance attack.
 *
 * NOT throttled: it revokes only the caller's own session, so there is nothing
 * to brute-force, and throttling it would risk stranding a user who is trying
 * to leave.
 */
export async function POST(request: Request): Promise<Response> {
  const context = getRequestContext(request);

  try {
    const body = await readJsonBody(request);
    requireCsrf(request, context, body);

    const token = readCookie(request, SESSION_COOKIE);
    const session = await resolveSession(token);

    if (session) {
      await revokeSession(session.sessionId);
      await getDb().$transaction(async (tx) => {
        await writeAudit(tx, {
          action: 'auth.logout',
          subjectType: 'session',
          subjectId: session.sessionId,
          actorUserId: session.userId,
          actorIp: context.ip,
          requestId: context.requestId,
        });
      });
    }

    // Clear the cookie regardless, so a stale or already-revoked token does not
    // linger in the browser.
    (await cookies()).set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: context.isHttps,
      path: '/',
      maxAge: 0,
    });

    return ok({ signed_out: true }, context.requestId);
  } catch (error) {
    return fail(error, context.requestId);
  }
}
