import { getDb } from '@/lib/db';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { guard } from '@/lib/auth/guard';
import { enqueueNotification } from '@/lib/auth/notify';
import { THROTTLE, TOKEN_TTL_MS } from '@/lib/auth/params';
import { forgotPasswordSchema } from '@/lib/auth/schemas';
import { recordAttempt } from '@/lib/auth/throttle';
import { mintToken } from '@/lib/auth/tokens';
import { getRequestContext } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * Requests a password reset.
 *
 * ALWAYS returns 202, whatever happens (Phase 1 §4.1). An unknown address, a
 * malformed address, a suspended account and a per-account rate limit all
 * produce the identical response, so enumeration of the candidate base through
 * this endpoint is not available.
 *
 * That also means the caller is never told they have been rate-limited, which
 * is deliberate: telling them would itself confirm the address exists.
 */
const ACCEPTED = 'If that address has an account, a reset link is on its way.';

export async function POST(request: Request): Promise<Response> {
  const fallbackContext = getRequestContext(request);

  try {
    const { context, body } = await guard(request, 'forgot_password');
    await recordAttempt(context.ip, 'forgot_password', true);

    const parsed = forgotPasswordSchema.safeParse(body);
    // A malformed address gets the same 202 as a valid one.
    if (!parsed.success) {
      return ok({ accepted: true, message: ACCEPTED }, context.requestId, { status: 202 });
    }

    const users = await getDb().$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM users
      WHERE email = ${parsed.data.email}::citext
        AND deleted_at IS NULL AND status <> 'suspended'`;
    const user = users[0];

    if (user) {
      /**
       * Per-account limit: 3 per hour (approved).
       *
       * Counted from email_tokens rather than auth_attempts, because
       * auth_attempts is keyed by IP and this limit is per account — and
       * because counting the tokens we actually issued needs no new table.
       * Prevents flooding one victim's mailbox from many addresses.
       */
      const since = new Date(Date.now() - THROTTLE.forgotPasswordAccount.windowMs);
      const recent = await getDb().$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM email_tokens
        WHERE user_id = ${user.id}::uuid
          AND purpose = 'reset_password'::email_token_purpose
          AND created_at >= ${since}`;

      if (Number(recent[0]?.n ?? 0) < THROTTLE.forgotPasswordAccount.max) {
        const token = mintToken();
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS.reset_password);

        await getDb().$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
            VALUES (${user.id}::uuid, 'reset_password'::email_token_purpose,
                    ${token.hash}, ${expiresAt})`;

          await enqueueNotification(tx, user.id, 'auth.password_reset');

          await writeAudit(tx, {
            action: 'auth.password_reset_requested',
            subjectType: 'user',
            subjectId: user.id,
            actorUserId: user.id,
            actorIp: context.ip,
            requestId: context.requestId,
          });
        });
      }
    }

    return ok({ accepted: true, message: ACCEPTED }, context.requestId, { status: 202 });
  } catch (error) {
    return fail(error, fallbackContext.requestId);
  }
}
