import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { guard } from '@/lib/auth/guard';
import { GENERIC_TOKEN_FAILURE, passwordFieldError } from '@/lib/auth/messages';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { acceptInviteSchema } from '@/lib/auth/schemas';
import { recordAttempt } from '@/lib/auth/throttle';
import { consumeToken } from '@/lib/auth/token-lookup';
import { getRequestContext } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * Accepts an invitation: sets the initial password and activates the account.
 *
 * This endpoint exists in Milestone 2 because staff — consultant, case_officer,
 * manager, admin — can never be self-registered under any reading of decision
 * #5, so an invited path is required regardless of how #5 is settled.
 *
 * Invite ISSUANCE is deliberately NOT here. Creating a staff account is an
 * admin action and belongs to Milestone 8; this milestone implements
 * consumption only, and tests create the token directly.
 *
 * No session is created, for the same reason as verify-email: holding an invite
 * link is not the same as being the intended recipient.
 */
export async function POST(request: Request): Promise<Response> {
  const fallbackContext = getRequestContext(request);

  try {
    const { context, body } = await guard(request, 'accept_invite');

    const parsed = acceptInviteSchema.safeParse(body);
    if (!parsed.success) {
      // A malformed token and a weak password are reported differently only
      // when the token is well-formed, so a probe cannot use the password rules
      // to discover whether a token exists.
      throw new ApiError('UNAUTHENTICATED', GENERIC_TOKEN_FAILURE);
    }

    const rejection = checkPasswordPolicy(parsed.data.password);
    if (rejection) {
      throw new ApiError('VALIDATION_FAILED', 'Choose a different password.', {
        password: passwordFieldError(rejection),
      });
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await getDb().$transaction(async (tx) => {
      const { userId } = await consumeToken(tx, parsed.data.token, 'accept_invite');

      await tx.$executeRaw`
        UPDATE users
        SET password_hash = ${passwordHash},
            password_changed_at = now(),
            email_verified_at = COALESCE(email_verified_at, now()),
            status = 'active'::user_status,
            failed_login_count = 0,
            locked_until = NULL
        WHERE id = ${userId}::uuid AND deleted_at IS NULL`;

      await writeAudit(tx, {
        action: 'auth.invite_accepted',
        subjectType: 'user',
        subjectId: userId,
        actorUserId: userId,
        actorIp: context.ip,
        requestId: context.requestId,
        after: { status: 'active' },
      });
    });

    await recordAttempt(context.ip, 'accept_invite', true);
    return ok({ accepted: true }, context.requestId);
  } catch (error) {
    return fail(error, fallbackContext.requestId);
  }
}
