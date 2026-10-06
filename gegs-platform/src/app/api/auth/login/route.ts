import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { ApiError } from '@/lib/api/errors';
import { fail, ok } from '@/lib/api/respond';
import { writeAudit } from '@/lib/auth/audit';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { loginSchema } from '@/lib/auth/schemas';
import { SESSION_COOKIE, createSession, sessionCookieOptions } from '@/lib/auth/session';
import {
  checkLoginIpThrottle,
  accountLockState,
  clearAccountFailures,
  pruneAttemptsOpportunistically,
  recordAttempt,
  registerAccountFailure,
} from '@/lib/auth/throttle';
import { getRequestContext, readJsonBody, requireCsrf } from '@/lib/auth/request-context';

export const dynamic = 'force-dynamic';

/**
 * A hash of a value nobody knows, used to spend comparable CPU when the email
 * does not exist. Without it, "unknown address" would return measurably faster
 * than "wrong password" and the response time alone would enumerate accounts —
 * defeating the whole point of the identical error message.
 */
let decoyHash: string | null = null;
async function spendComparableTime(password: string): Promise<void> {
  decoyHash ??= await hashPassword(`decoy:${crypto.randomUUID()}`);
  await verifyPassword(decoyHash, password);
}

/**
 * The SAME message for every authentication failure.
 *
 * Unknown address, wrong password, locked account, unverified account and
 * suspended account are all indistinguishable to the caller. Any difference
 * would tell an attacker whether an address is registered, which leaks the
 * size and membership of the candidate base (Phase 1 §4.1).
 *
 * The hint about waiting is driven by what THIS CLIENT has done, never by the
 * account's state, so it helps a locked-out user without confirming that the
 * account exists.
 */
const GENERIC_FAILURE = 'Email or password is incorrect.';

interface UserRow {
  id: string;
  password_hash: string;
  status: string;
  locked_until: Date | null;
  email_verified_at: Date | null;
}

export async function POST(request: Request): Promise<Response> {
  const context = getRequestContext(request);

  try {
    const body = await readJsonBody(request);
    requireCsrf(request, context, body);

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_FAILED', 'Enter your email address and password.', {
        email: 'Enter a valid email address.',
      });
    }

    // Per-IP throttle runs BEFORE any database lookup of the account, so a
    // spraying client is rejected without being told anything at all.
    const ipDecision = await checkLoginIpThrottle(context.ip);
    if (!ipDecision.allowed) {
      await recordAttempt(context.ip, 'login', false);
      return fail(
        new ApiError('RATE_LIMITED', 'Too many attempts. Try again shortly.'),
        context.requestId,
      );
    }

    const rows = await getDb().$queryRaw<UserRow[]>`
      SELECT id::text AS id, password_hash, status::text AS status, locked_until, email_verified_at
      FROM users
      WHERE email = ${parsed.data.email}::citext AND deleted_at IS NULL`;
    const user = rows[0];

    if (!user) {
      await spendComparableTime(parsed.data.password);
      await recordAttempt(context.ip, 'login', false);
      // No audit actor exists, but the attempt is still recorded against the IP.
      throw new ApiError('UNAUTHENTICATED', GENERIC_FAILURE);
    }

    if (accountLockState(user).locked) {
      await spendComparableTime(parsed.data.password);
      await recordAttempt(context.ip, 'login', false);
      throw new ApiError('UNAUTHENTICATED', GENERIC_FAILURE);
    }

    const passwordOk = await verifyPassword(user.password_hash, parsed.data.password);

    if (!passwordOk) {
      await registerAccountFailure(user.id);
      await recordAttempt(context.ip, 'login', false);
      await getDb().$transaction(async (tx) => {
        await writeAudit(tx, {
          action: 'auth.login_failed',
          subjectType: 'user',
          subjectId: user.id,
          actorUserId: user.id,
          actorIp: context.ip,
          requestId: context.requestId,
        });
      });
      throw new ApiError('UNAUTHENTICATED', GENERIC_FAILURE);
    }

    // Only a fully active account may sign in. An 'invited' account has not set
    // a password through accept-invite, and a 'suspended' one has been stopped
    // deliberately. Both are indistinguishable from a wrong password.
    if (user.status !== 'active' || user.email_verified_at === null) {
      await recordAttempt(context.ip, 'login', false);
      throw new ApiError('UNAUTHENTICATED', GENERIC_FAILURE);
    }

    const session = await createSession(user.id, { ip: context.ip, userAgent: context.userAgent });
    await clearAccountFailures(user.id);
    await recordAttempt(context.ip, 'login', true);

    await getDb().$transaction(async (tx) => {
      await writeAudit(tx, {
        action: 'auth.login',
        subjectType: 'user',
        subjectId: user.id,
        actorUserId: user.id,
        actorIp: context.ip,
        requestId: context.requestId,
      });
    });

    (await cookies()).set(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions(session.expiresAt, context.isHttps),
    );

    await pruneAttemptsOpportunistically();

    return ok({ signed_in: true }, context.requestId);
  } catch (error) {
    return fail(error, context.requestId);
  }
}
