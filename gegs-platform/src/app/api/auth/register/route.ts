import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { guard } from '@/lib/auth/guard';
import { enqueueNotification } from '@/lib/auth/notify';
import { TOKEN_TTL_MS } from '@/lib/auth/params';
import { checkPasswordPolicy, hashPassword } from '@/lib/auth/password';
import { registerSchema } from '@/lib/auth/schemas';
import { mintToken } from '@/lib/auth/tokens';
import { recordAttempt } from '@/lib/auth/throttle';
import { getRequestContext } from '@/lib/auth/request-context';
import { passwordFieldError } from '@/lib/auth/messages';

export const dynamic = 'force-dynamic';

/**
 * Candidate self-registration.
 *
 * Phase 1 §3.3 restricts this endpoint to candidates. Staff and (pending
 * decision #5) employers are invited instead, through /api/auth/accept-invite.
 *
 * ENUMERATION: the response is identical whether or not the address is already
 * registered. A distinct "that email is taken" reply would turn this endpoint
 * into an oracle for testing whether someone is on the platform — which, for a
 * recruitment product, discloses that a named person is job-seeking. So an
 * already-registered address produces the same 202 and no new row.
 */
const ACCEPTED =
  'Check your email. If the address can be registered, a verification link is on its way.';

export async function POST(request: Request): Promise<Response> {
  const fallbackContext = getRequestContext(request);

  try {
    const { context, body } = await guard(request, 'register');

    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_FAILED', 'Check the highlighted fields.', {
        email: 'Enter a valid email address.',
        full_name: 'Enter your full name.',
      });
    }

    // Policy is checked before the existence lookup, so a weak password is
    // rejected the same way for a new and an existing address.
    const rejection = checkPasswordPolicy(parsed.data.password);
    if (rejection) {
      throw new ApiError('VALIDATION_FAILED', 'Choose a different password.', {
        password: passwordFieldError(rejection),
      });
    }

    const existing = await getDb().$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM users
      WHERE email = ${parsed.data.email}::citext AND deleted_at IS NULL`;

    if (existing.length === 0) {
      const passwordHash = await hashPassword(parsed.data.password);
      const token = mintToken();
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS.verify_email);

      await getDb().$transaction(async (tx) => {
        const created = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO users (email, password_hash, locale, status, password_changed_at)
          VALUES (${parsed.data.email}::citext, ${passwordHash}, ${parsed.data.locale},
                  'invited', now())
          RETURNING id::text AS id`;
        const userId = created[0]?.id;
        // An INSERT ... RETURNING always yields a row, so this cannot happen —
        // but asserting it keeps the guarantee local instead of assumed.
        if (!userId) throw new Error('user insert returned no id');

        await tx.$executeRaw`
          INSERT INTO candidate_profiles (user_id, full_name)
          VALUES (${userId}::uuid, ${parsed.data.full_name})`;

        await tx.$executeRaw`
          INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
          VALUES (${userId}::uuid, 'verify_email'::email_token_purpose,
                  ${token.hash}, ${expiresAt})`;

        await enqueueNotification(tx, userId, 'auth.verify_email');

        await writeAudit(tx, {
          action: 'auth.register',
          subjectType: 'user',
          subjectId: userId,
          actorUserId: userId,
          actorIp: context.ip,
          requestId: context.requestId,
          after: { status: 'invited', locale: parsed.data.locale },
        });
      });
    }

    await recordAttempt(context.ip, 'register', true);
    return ok({ accepted: true, message: ACCEPTED }, context.requestId, { status: 202 });
  } catch (error) {
    return fail(error, fallbackContext.requestId);
  }
}
