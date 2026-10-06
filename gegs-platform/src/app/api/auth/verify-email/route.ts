import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { guard } from '@/lib/auth/guard';
import { GENERIC_TOKEN_FAILURE } from '@/lib/auth/messages';
import { verifyEmailSchema } from '@/lib/auth/schemas';
import { recordAttempt } from '@/lib/auth/throttle';
import { consumeToken } from '@/lib/auth/token-lookup';
import { getRequestContext } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * Consumes a verification token and activates the account.
 *
 * Phase 1 §4.1 requires email verification before any document upload, so this
 * is the step that moves a user from 'invited' to 'active'.
 *
 * No session is created. Verifying an address proves control of the mailbox,
 * not possession of the password, so the user signs in afterwards — a link
 * forwarded to the wrong person must not become a session.
 */
export async function POST(request: Request): Promise<Response> {
  const fallbackContext = getRequestContext(request);

  try {
    const { context, body } = await guard(request, 'verify_email');

    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('UNAUTHENTICATED', GENERIC_TOKEN_FAILURE);
    }

    await getDb().$transaction(async (tx) => {
      const { userId } = await consumeToken(tx, parsed.data.token, 'verify_email');

      await tx.$executeRaw`
        UPDATE users
        SET email_verified_at = COALESCE(email_verified_at, now()),
            status = CASE WHEN status = 'invited' THEN 'active'::user_status ELSE status END
        WHERE id = ${userId}::uuid AND deleted_at IS NULL`;

      await writeAudit(tx, {
        action: 'auth.email_verified',
        subjectType: 'user',
        subjectId: userId,
        actorUserId: userId,
        actorIp: context.ip,
        requestId: context.requestId,
        after: { status: 'active' },
      });
    });

    await recordAttempt(context.ip, 'verify_email', true);
    return ok({ verified: true }, context.requestId);
  } catch (error) {
    return fail(error, fallbackContext.requestId);
  }
}
