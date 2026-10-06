/**
 * Authentication parameters.
 *
 * Every value here is either approved in Phase 1 §4.1 or approved explicitly in
 * the Milestone 2 scope sign-off. Nothing in this file is a free choice, and
 * changing any of it is a reviewed change rather than a tuning exercise.
 */

/**
 * Argon2id cost. Phase 1 §4.1: "tuned to ~250 ms on the production container.
 * Parameters recorded in the repository so a future cost increase is a
 * deliberate, reviewed change."
 *
 * These were measured on the development container (see
 * tests/unit/auth-password.test.ts, which asserts they are in a sane band
 * rather than asserting a wall-clock time — a timing assertion would be flaky
 * on shared CI hardware).
 *
 * KNOWN LIMITATION: production hardware differs. Re-measuring on the real
 * runtime is a Milestone 10 task.
 */
export const ARGON2 = {
  memoryCost: 19456, // KiB (19 MiB) — OWASP's current minimum for Argon2id
  timeCost: 2,
  parallelism: 1,
} as const;

/** Phase 1 §4.1: minimum 12 characters, no composition rules. */
export const PASSWORD_MIN_LENGTH = 12;
/**
 * An upper bound exists only to stop a multi-megabyte body becoming a CPU
 * denial-of-service through the hash function.
 */
export const PASSWORD_MAX_LENGTH = 1024;

/** Phase 1 §4.1: idle 8 hours, absolute 30 days. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

/** Single-use token lifetimes. */
export const TOKEN_TTL_MS = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
  accept_invite: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * Throttle thresholds — APPROVED EXACTLY AS WRITTEN in the Milestone 2 scope
 * sign-off. These are not defaults to be adjusted in passing.
 *
 * All windows slide. No block is ever permanent. Every rejection carries
 * Retry-After.
 */
export const THROTTLE = {
  /** 5 consecutive account failures -> 15-minute lock. */
  account: {
    maxConsecutiveFailures: 5,
    firstLockMs: 15 * 60 * 1000,
    /** A second lock extends to 60 minutes. */
    repeatLockMs: 60 * 60 * 1000,
    /** Failures at or above this count mean the account has locked before. */
    repeatThreshold: 10,
  },
  /**
   * Per-IP. The volume limit is deliberately generous: Gulf mobile carriers and
   * corporate offices are heavily NATed, so many legitimate users share one
   * public address. The burst limit does the anti-automation work instead.
   */
  login: {
    burst: { windowMs: 60 * 1000, max: 10 },
    volume: { windowMs: 15 * 60 * 1000, max: 30 },
  },
  forgotPasswordIp: { windowMs: 60 * 60 * 1000, max: 5 },
  forgotPasswordAccount: { windowMs: 60 * 60 * 1000, max: 3 },
  register: { windowMs: 60 * 60 * 1000, max: 10 },
  /** verify-email, reset-password and accept-invite each get their own budget. */
  tokenSubmit: { windowMs: 60 * 60 * 1000, max: 10 },
} as const;

/** How long an auth_attempts row is kept before opportunistic pruning. */
export const AUTH_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Supported locales (mirrors the users_locale_supported CHECK constraint). */
export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
