import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { guard } from '@/lib/auth/guard';
import { GENERIC_TOKEN_FAILURE, passwordFieldError } from '@/lib/auth/messages';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { resetPasswordSchema } from '@/lib/auth/schemas';
import { recordAttempt } from '@/lib/auth/throttle';
import { consumeToken } from '@/lib/auth/token-lookup';
import { getRequestContext } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * Completes a password reset.
 *
 * EVERY SESSION BELONGING TO THE USER IS REVOKED. Without this, a stolen
 * session would survive the very recovery intended to end it — which is the
 * usual reason someone resets a password in the first place. The account's
 * failure counter and lock are cleared too, so a user who was locked out can
 * sign in immediately with the new password.
 */
export async function POST(request: Request): Promise<Response> {
  const fallbackContext = getRequestContext(request);

  try {
    const { context, body } = await guard(request, 'reset_password');

    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      // Report the password rule only when the token itself is well-formed, so
      // the rules cannot be used to probe for valid tokens.
      const tokenLooksValid = typeof body['token'] === 'string' && body['token'].length >= 16;
      if (!tokenLooksValid) throw new ApiError('UNAUTHENTICATED', GENERIC_TOKEN_FAILURE);
      throw new ApiError('VALIDATION_FAILED', 'Choose a different password.', {
        password: passwordFieldError('too_short'),
      });
    }

    const rejection = checkPasswordPolicy(parsed.data.password);
    if (rejection) {
      throw new ApiError('VALIDATION_FAILED', 'Choose a different password.', {
        password: passwordFieldError(rejection),
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);
    let revokedSessions = 0;

    await getDb().$transaction(async (tx) => {
      const { userId } = await consumeToken(tx, parsed.data.token, 'reset_password');

      await tx.$executeRaw`
        UPDATE users
        SET password_hash = ${passwordHash},
            password_changed_at = now(),
            failed_login_count = 0,
            locked_until = NULL
        WHERE id = ${userId}::uuid AND deleted_at IS NULL`;

      revokedSessions = await tx.$executeRaw`
        UPDATE sessions SET revoked_at = now()
        WHERE user_id = ${userId}::uuid AND revoked_at IS NULL`;

      await writeAudit(tx, {
        action: 'auth.password_reset',
        subjectType: 'user',
        subjectId: userId,
        actorUserId: userId,
        actorIp: context.ip,
        requestId: context.requestId,
        after: { sessions_revoked: revokedSessions },
      });
    });

    await recordAttempt(context.ip, 'reset_password', true);
    return ok({ reset: true, sessions_revoked: revokedSessions }, context.requestId);
  } catch (error) {
    return fail(error, fallbackContext.requestId);
  }
}
