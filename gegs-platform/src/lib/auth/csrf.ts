import { getEnv } from '@/env';

/**
 * CSRF protection: a double-submit cookie plus an Origin check (Phase 1 §10).
 *
 * The cookie is readable by the page (not HttpOnly) so a server-rendered form
 * can echo it in a hidden field. An attacker's page cannot read it, because it
 * belongs to this origin — that is the whole mechanism.
 *
 * The Origin check is the second, independent layer: a cross-site form post
 * carries the attacker's Origin, which never matches APP_ORIGIN. Neither layer
 * needs a server-side secret, which is why Milestone 2 adds no environment
 * variable.
 *
 * RUNTIME NOTE: this module is imported by middleware, which Next.js runs in
 * the Edge runtime where `node:` builtins are unavailable. It therefore uses
 * only Web Crypto and standard globals, so the same code runs in middleware and
 * in Node route handlers.
 */
export const CSRF_COOKIE = 'gegs_csrf';
export const CSRF_FIELD = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function mintCsrfToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * Length-independent, content-constant-time string comparison.
 *
 * `timingSafeEqual` is a node:crypto API and unavailable in the Edge runtime,
 * so the comparison is written out. The length of a CSRF token is not secret,
 * so returning early on a length mismatch leaks nothing; the byte comparison
 * itself accumulates rather than short-circuiting.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

export type CsrfFailure = 'missing_cookie' | 'missing_token' | 'mismatch' | 'bad_origin';

/**
 * Validates a state-changing request.
 *
 * Both layers must pass. The Origin header is required: a modern browser always
 * sends it on a cross-origin POST, so a missing Origin on a state-changing
 * request is treated as a failure rather than waved through.
 */
export function validateCsrf(input: {
  cookieToken: string | undefined;
  submittedToken: string | undefined;
  origin: string | null;
}): CsrfFailure | null {
  if (input.origin === null) return 'bad_origin';

  // Compare parsed origins so a trailing slash or a default port cannot cause a
  // spurious rejection.
  try {
    const actual = new URL(input.origin);
    const expected = new URL(getEnv().APP_ORIGIN);
    if (actual.protocol !== expected.protocol || actual.host !== expected.host) {
      return 'bad_origin';
    }
  } catch {
    return 'bad_origin';
  }

  if (!input.cookieToken) return 'missing_cookie';
  if (!input.submittedToken) return 'missing_token';
  if (!constantTimeEquals(input.cookieToken, input.submittedToken)) return 'mismatch';
  return null;
}

/** Cookie attributes. Not HttpOnly: the page must echo it into the form. */
export function csrfCookieOptions(isHttps: boolean) {
  return {
    httpOnly: false,
    sameSite: 'lax' as const,
    secure: isHttps,
    path: '/',
  };
}
