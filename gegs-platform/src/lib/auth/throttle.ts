import { getDb } from '@/lib/db';
import { AUTH_ATTEMPT_RETENTION_MS, THROTTLE } from '@/lib/auth/params';

/**
 * Authentication throttling on both approved axes (Phase 1 §4.1).
 *
 * Neither axis alone is sufficient: a per-IP limit is defeated by a botnet, and
 * a per-account limit lets one host spray many accounts. Both are therefore
 * enforced, with the thresholds approved in the Milestone 2 sign-off.
 *
 * Backed by PostgreSQL rather than Redis (Phase 1 §1.3 excluded Redis from v1).
 * At this scale an indexed count over a 15-minute window is cheap.
 *
 * CLIENT IP: the SOCKET address only. A client-supplied X-Forwarded-For is
 * trivially spoofable and would make this look like protection while providing
 * none. Trusted-proxy handling is a Milestone 10 deployment task.
 */
export type ThrottledAction =
  'login' | 'forgot_password' | 'register' | 'verify_email' | 'reset_password' | 'accept_invite';

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds to put in Retry-After. Only meaningful when allowed is false. */
  retryAfterSeconds: number;
}

const ALLOWED: ThrottleDecision = { allowed: true, retryAfterSeconds: 0 };

/** Records an attempt. Always called, for both successes and failures. */
export async function recordAttempt(
  ip: string | null,
  action: ThrottledAction,
  succeeded: boolean,
): Promise<void> {
  await getDb().$executeRaw`
    INSERT INTO auth_attempts (ip, action, succeeded)
    VALUES (${ip}::inet, ${action}, ${succeeded})`;
}

async function countFailures(ip: string | null, action: ThrottledAction, windowMs: number) {
  if (ip === null) return 0;
  const since = new Date(Date.now() - windowMs);
  const rows = await getDb().$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM auth_attempts
    WHERE ip = ${ip}::inet AND action = ${action}
      AND succeeded = false AND created_at >= ${since}`;
  return Number(rows[0]?.n ?? 0);
}

async function countAll(ip: string | null, action: ThrottledAction, windowMs: number) {
  if (ip === null) return 0;
  const since = new Date(Date.now() - windowMs);
  const rows = await getDb().$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM auth_attempts
    WHERE ip = ${ip}::inet AND action = ${action} AND created_at >= ${since}`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Per-IP login throttle: a burst cap and a volume cap.
 *
 * The volume cap counts FAILURES and is deliberately generous, because Gulf
 * mobile carriers and corporate offices are heavily NATed and many legitimate
 * users share one public address. The burst cap counts ALL attempts and does
 * the anti-automation work, since it is speed rather than volume that
 * distinguishes a script from an office.
 */
export async function checkLoginIpThrottle(ip: string | null): Promise<ThrottleDecision> {
  const { burst, volume } = THROTTLE.login;

  if ((await countAll(ip, 'login', burst.windowMs)) >= burst.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil(burst.windowMs / 1000) };
  }
  if ((await countFailures(ip, 'login', volume.windowMs)) >= volume.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil(volume.windowMs / 1000) };
  }
  return ALLOWED;
}

/** Per-IP budget for an action with a single window/max pair. */
export async function checkIpBudget(
  ip: string | null,
  action: ThrottledAction,
  budget: { windowMs: number; max: number },
): Promise<ThrottleDecision> {
  if ((await countAll(ip, action, budget.windowMs)) >= budget.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil(budget.windowMs / 1000) };
  }
  return ALLOWED;
}

export interface AccountLockState {
  locked: boolean;
  lockedUntil: Date | null;
}

/** Whether this account is currently locked. */
export function accountLockState(user: { locked_until: Date | null }): AccountLockState {
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    return { locked: true, lockedUntil: user.locked_until };
  }
  return { locked: false, lockedUntil: null };
}

/**
 * Registers a failed login against the account and locks it when the approved
 * threshold is reached.
 *
 * 5 consecutive failures lock for 15 minutes. A second lock extends to 60
 * minutes, which punishes sustained attack on one account without punishing a
 * user having one bad day.
 */
export async function registerAccountFailure(userId: string): Promise<void> {
  const { maxConsecutiveFailures, firstLockMs, repeatLockMs, repeatThreshold } = THROTTLE.account;

  await getDb().$executeRaw`
    UPDATE users
    SET failed_login_count = failed_login_count + 1,
        locked_until = CASE
          WHEN (failed_login_count + 1) >= ${repeatThreshold}
            THEN now() + ${`${repeatLockMs} milliseconds`}::interval
          WHEN (failed_login_count + 1) >= ${maxConsecutiveFailures}
            THEN now() + ${`${firstLockMs} milliseconds`}::interval
          ELSE locked_until
        END
    WHERE id = ${userId}::uuid`;
}

/** Clears the failure counter and any lock. Called after a successful login. */
export async function clearAccountFailures(userId: string): Promise<void> {
  await getDb().$executeRaw`
    UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
    WHERE id = ${userId}::uuid`;
}

/**
 * Removes attempt rows older than the retention window.
 *
 * Opportunistic: auth_attempts grows monotonically, and a scheduled sweep
 * belongs to the Milestone 9 job runner. Called on a small fraction of writes
 * so it costs nothing per request.
 */
export async function pruneAttemptsOpportunistically(probability = 0.01): Promise<void> {
  if (Math.random() >= probability) return;
  const cutoff = new Date(Date.now() - AUTH_ATTEMPT_RETENTION_MS);
  await getDb().$executeRaw`DELETE FROM auth_attempts WHERE created_at < ${cutoff}`;
}
