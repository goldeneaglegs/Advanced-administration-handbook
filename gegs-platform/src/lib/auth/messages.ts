import { PASSWORD_MIN_LENGTH } from '@/lib/auth/params';
import type { PasswordRejection } from '@/lib/auth/password';

/**
 * User-facing copy for password rejections.
 *
 * Phase 1 §6.2 and the design skill's guidance on failure: an error names what
 * happened and what to do next, in the interface's voice, and does not
 * apologise or stay vague. "Choose a different password" with no reason is the
 * kind of error that makes a form unusable.
 */
export function passwordFieldError(rejection: PasswordRejection): string {
  switch (rejection) {
    case 'too_short':
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    case 'too_long':
      return 'That password is too long.';
    case 'breached':
      return 'That password has appeared in a known data breach. Choose another.';
  }
}

/**
 * The single message used for every token failure, so that "no such token",
 * "already used" and "expired" cannot be told apart.
 */
export const GENERIC_TOKEN_FAILURE =
  'That link is no longer valid. Request a new one and try again.';
