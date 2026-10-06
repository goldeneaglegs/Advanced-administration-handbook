import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Single-use, expiring, hashed tokens for email verification, password reset
 * and invite acceptance (Phase 1 §4.1).
 *
 * The plaintext token is returned once, to be placed in an email. Only its
 * SHA-256 is stored, so a database leak does not yield usable tokens — the same
 * reasoning that applies to session tokens.
 *
 * SHA-256 rather than Argon2id is correct here: these are 256 bits of
 * cryptographic randomness, not low-entropy human secrets, so there is nothing
 * for a slow hash to defend against and token lookup stays a single indexed
 * read.
 */
const TOKEN_BYTES = 32;

export interface MintedToken {
  /** Give to the user exactly once. Never logged, never stored. */
  plaintext: string;
  /** Store this. */
  hash: Buffer;
}

export function mintToken(): MintedToken {
  const raw = randomBytes(TOKEN_BYTES);
  return { plaintext: raw.toString('base64url'), hash: hashToken(raw.toString('base64url')) };
}

export function hashToken(plaintext: string): Buffer {
  return createHash('sha256').update(plaintext, 'utf8').digest();
}

/** Constant-time comparison, so a timing signal cannot be used to guess a token. */
export function tokenMatches(candidatePlaintext: string, storedHash: Buffer): boolean {
  const candidate = hashToken(candidatePlaintext);
  if (candidate.length !== storedHash.length) return false;
  return timingSafeEqual(candidate, storedHash);
}

/** A token is usable only while unconsumed and unexpired. */
export function isTokenUsable(
  row: { expiresAt: Date; consumedAt: Date | null },
  now = new Date(),
): boolean {
  if (row.consumedAt !== null) return false;
  return row.expiresAt.getTime() > now.getTime();
}
