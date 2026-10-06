import { hash, verify } from '@node-rs/argon2';
import { ARGON2, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/params';
import { isBreached } from '@/lib/auth/breached';

/** Hashes a password with Argon2id at the recorded cost (Phase 1 §4.1). */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or unrecognised hash: a
 * corrupt row must read as "wrong password", never as a 500 that tells an
 * attacker something about the stored value.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2);
  } catch {
    return false;
  }
}

export type PasswordRejection = 'too_short' | 'too_long' | 'breached';

/**
 * Checks a password against the approved policy: a 12-character minimum and an
 * offline breached-corpus lookup. No composition rules — Phase 1 §4.1 omits
 * them deliberately, because they push people toward `Password1!` and
 * measurably weaken outcomes.
 */
export function checkPasswordPolicy(password: string): PasswordRejection | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (isBreached(password)) return 'breached';
  return null;
}
