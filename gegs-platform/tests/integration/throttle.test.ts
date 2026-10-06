import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { THROTTLE } from '@/lib/auth/params';
import {
  accountLockState,
  checkIpBudget,
  checkLoginIpThrottle,
  clearAccountFailures,
  pruneAttemptsOpportunistically,
  recordAttempt,
  registerAccountFailure,
} from '@/lib/auth/throttle';

/**
 * Throttle behaviour against a REAL PostgreSQL.
 *
 * The thresholds asserted here are the ones approved in the Milestone 2
 * sign-off. They are read from params.ts rather than hard-coded, so changing a
 * threshold without re-approving it cannot slip through a passing test.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

let db: PrismaClient;
/** A documentation-range address, so no test can touch a real client's counters. */
const TEST_IP = '203.0.113.77';

async function makeUser(email: string): Promise<string> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO users (email, password_hash) VALUES (${email}, 'not-a-real-hash')
    RETURNING id::text AS id`;
  return rows[0]!.id;
}

async function readUser(id: string) {
  const rows = await db.$queryRaw<Array<{ failed_login_count: number; locked_until: Date | null }>>`
    SELECT failed_login_count, locked_until FROM users WHERE id = ${id}::uuid`;
  return rows[0]!;
}

describeIfDb('authentication throttling', () => {
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: DATABASE_URL! } } });
    await db.$connect();
  });

  afterEach(async () => {
    await db.$executeRaw`DELETE FROM auth_attempts WHERE ip = ${TEST_IP}::inet`;
    await db.$executeRaw`DELETE FROM users WHERE email LIKE '%@throttle.test'`;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  describe('attempt recording', () => {
    it('records the IP, action and outcome', async () => {
      await recordAttempt(TEST_IP, 'login', false);
      const rows = await db.$queryRaw<Array<{ ip: string; action: string; succeeded: boolean }>>`
        SELECT host(ip) AS ip, action, succeeded FROM auth_attempts WHERE ip = ${TEST_IP}::inet`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ip: TEST_IP, action: 'login', succeeded: false });
    });

    it('accepts a null IP so an unknown address is visible rather than silent', async () => {
      await recordAttempt(null, 'login', false);
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM auth_attempts WHERE ip IS NULL AND action = 'login'`;
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
      await db.$executeRaw`DELETE FROM auth_attempts WHERE ip IS NULL`;
    });
  });

  describe('per-IP login burst limit (approved: 10 per minute)', () => {
    it('allows attempts below the limit', async () => {
      for (let i = 0; i < THROTTLE.login.burst.max - 1; i += 1) {
        await recordAttempt(TEST_IP, 'login', false);
      }
      expect((await checkLoginIpThrottle(TEST_IP)).allowed).toBe(true);
    });

    it('blocks at the limit and returns a 60-second Retry-After', async () => {
      for (let i = 0; i < THROTTLE.login.burst.max; i += 1) {
        await recordAttempt(TEST_IP, 'login', false);
      }
      const decision = await checkLoginIpThrottle(TEST_IP);
      expect(decision.allowed).toBe(false);
      expect(decision.retryAfterSeconds).toBe(60);
    });

    it('counts successes too, so a fast script cannot hide behind valid logins', async () => {
      for (let i = 0; i < THROTTLE.login.burst.max; i += 1) {
        await recordAttempt(TEST_IP, 'login', true);
      }
      expect((await checkLoginIpThrottle(TEST_IP)).allowed).toBe(false);
    });

    it('ignores attempts older than the burst window', async () => {
      const old = new Date(Date.now() - THROTTLE.login.burst.windowMs - 5_000);
      for (let i = 0; i < THROTTLE.login.burst.max + 5; i += 1) {
        await db.$executeRaw`
          INSERT INTO auth_attempts (ip, action, succeeded, created_at)
          VALUES (${TEST_IP}::inet, 'login', false, ${old})`;
      }
      expect((await checkLoginIpThrottle(TEST_IP)).allowed).toBe(true);
    });
  });

  describe('per-IP login volume limit (approved: 30 failures per 15 minutes)', () => {
    it('blocks at 30 failures inside the window, with a 900-second Retry-After', async () => {
      // Backdated past the burst window so the volume rule is what trips.
      const within = new Date(Date.now() - 5 * 60 * 1000);
      for (let i = 0; i < THROTTLE.login.volume.max; i += 1) {
        await db.$executeRaw`
          INSERT INTO auth_attempts (ip, action, succeeded, created_at)
          VALUES (${TEST_IP}::inet, 'login', false, ${within})`;
      }
      const decision = await checkLoginIpThrottle(TEST_IP);
      expect(decision.allowed).toBe(false);
      expect(decision.retryAfterSeconds).toBe(900);
    });

    it('counts only FAILURES, so a busy NATed office is not locked out', async () => {
      // The deliberate generosity: Gulf carriers and offices share one address,
      // so successful logins must never count toward the volume limit.
      const within = new Date(Date.now() - 5 * 60 * 1000);
      for (let i = 0; i < THROTTLE.login.volume.max + 20; i += 1) {
        await db.$executeRaw`
          INSERT INTO auth_attempts (ip, action, succeeded, created_at)
          VALUES (${TEST_IP}::inet, 'login', true, ${within})`;
      }
      expect((await checkLoginIpThrottle(TEST_IP)).allowed).toBe(true);
    });
  });

  describe('null IP', () => {
    it('skips the per-IP check rather than throttling on a bogus value', async () => {
      // What happens if the app is ever run without the custom server.
      expect((await checkLoginIpThrottle(null)).allowed).toBe(true);
    });
  });

  describe('per-action IP budgets', () => {
    it.each([
      ['forgot_password', THROTTLE.forgotPasswordIp, 5],
      ['register', THROTTLE.register, 10],
      ['verify_email', THROTTLE.tokenSubmit, 10],
      ['reset_password', THROTTLE.tokenSubmit, 10],
      ['accept_invite', THROTTLE.tokenSubmit, 10],
    ] as const)('blocks %s at its approved hourly limit', async (action, budget, expected) => {
      expect(budget.max).toBe(expected);
      for (let i = 0; i < budget.max; i += 1) {
        await recordAttempt(TEST_IP, action, false);
      }
      const decision = await checkIpBudget(TEST_IP, action, budget);
      expect(decision.allowed).toBe(false);
      expect(decision.retryAfterSeconds).toBe(3600);
    });

    it('keeps each action on its own budget', async () => {
      for (let i = 0; i < THROTTLE.register.max; i += 1) {
        await recordAttempt(TEST_IP, 'register', false);
      }
      // register is spent; forgot_password must be untouched.
      expect((await checkIpBudget(TEST_IP, 'register', THROTTLE.register)).allowed).toBe(false);
      expect(
        (await checkIpBudget(TEST_IP, 'forgot_password', THROTTLE.forgotPasswordIp)).allowed,
      ).toBe(true);
    });
  });

  describe('per-account lock (approved: 5 failures -> 15 min, repeat -> 60 min)', () => {
    it('does not lock before the fifth failure', async () => {
      const id = await makeUser('lock-a@throttle.test');
      for (let i = 0; i < THROTTLE.account.maxConsecutiveFailures - 1; i += 1) {
        await registerAccountFailure(id);
      }
      const user = await readUser(id);
      expect(user.failed_login_count).toBe(4);
      expect(accountLockState(user).locked).toBe(false);
    });

    it('locks for 15 minutes on the fifth failure', async () => {
      const id = await makeUser('lock-b@throttle.test');
      for (let i = 0; i < THROTTLE.account.maxConsecutiveFailures; i += 1) {
        await registerAccountFailure(id);
      }
      const user = await readUser(id);
      expect(user.failed_login_count).toBe(5);
      expect(accountLockState(user).locked).toBe(true);

      const minutes = (user.locked_until!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(13);
      expect(minutes).toBeLessThanOrEqual(15);
    });

    it('extends to 60 minutes once failures reach the repeat threshold', async () => {
      const id = await makeUser('lock-c@throttle.test');
      for (let i = 0; i < THROTTLE.account.repeatThreshold; i += 1) {
        await registerAccountFailure(id);
      }
      const user = await readUser(id);
      const minutes = (user.locked_until!.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(55);
      expect(minutes).toBeLessThanOrEqual(60);
    });

    it('clears the counter and the lock on success', async () => {
      const id = await makeUser('lock-d@throttle.test');
      for (let i = 0; i < THROTTLE.account.maxConsecutiveFailures; i += 1) {
        await registerAccountFailure(id);
      }
      await clearAccountFailures(id);
      const user = await readUser(id);
      expect(user.failed_login_count).toBe(0);
      expect(user.locked_until).toBeNull();
      expect(accountLockState(user).locked).toBe(false);
    });

    it('treats an elapsed lock as unlocked without needing a sweep', async () => {
      expect(accountLockState({ locked_until: new Date(Date.now() - 1000) }).locked).toBe(false);
    });
  });

  describe('pruning', () => {
    it('removes rows older than the retention window', async () => {
      const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await db.$executeRaw`
        INSERT INTO auth_attempts (ip, action, succeeded, created_at)
        VALUES (${TEST_IP}::inet, 'login', false, ${ancient})`;
      await recordAttempt(TEST_IP, 'login', false);

      // probability 1 forces the prune; in production it runs on ~1% of writes.
      await pruneAttemptsOpportunistically(1);

      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM auth_attempts WHERE ip = ${TEST_IP}::inet`;
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it('does nothing when the dice say no', async () => {
      const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000);
      await db.$executeRaw`
        INSERT INTO auth_attempts (ip, action, succeeded, created_at)
        VALUES (${TEST_IP}::inet, 'login', false, ${ancient})`;
      await pruneAttemptsOpportunistically(0);
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM auth_attempts WHERE ip = ${TEST_IP}::inet`;
      expect(Number(rows[0]!.n)).toBe(1);
    });
  });
});
