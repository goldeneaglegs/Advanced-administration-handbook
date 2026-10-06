'use client';

/**
 * Shared client helpers for the auth screens.
 *
 * The Login screen keeps its own inline copy of the cookie read: it is already
 * committed and tested, and leaving it alone means these five screens cannot
 * regress it. A later tidy-up can fold it in here.
 */
export interface AuthResult {
  ok: boolean;
  /** Server message, already localised and safe to show (Phase 1 §3.2). */
  message: string;
  /** Per-field errors, keyed by input name, for aria-describedby wiring. */
  fields: Record<string, string>;
}

function readCsrfCookie(): string {
  const match = /(?:^|;\s*)gegs_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

/** Reads a token from the query string, as an emailed link supplies it. */
export function tokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

/**
 * Posts to an auth endpoint and normalises the response.
 *
 * Sends the double-submit CSRF token; the browser supplies Origin on a
 * same-origin POST for the server's independent check. The server's own message
 * is surfaced verbatim rather than replaced, so enumeration-resistant wording
 * stays exactly as the backend decided it.
 */
export async function postAuth(path: string, body: Record<string, unknown>): Promise<AuthResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfCookie() },
      body: JSON.stringify(body),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (response.ok) {
      const data =
        payload && typeof payload === 'object' && 'data' in payload
          ? (payload as { data: { message?: string } }).data
          : null;
      return { ok: true, message: data?.message ?? '', fields: {} };
    }

    const error =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { message?: string; fields?: Record<string, string> } }).error
        : null;

    return {
      ok: false,
      message: error?.message ?? 'Something went wrong. Try again.',
      fields: error?.fields ?? {},
    };
  } catch {
    return {
      ok: false,
      message: 'Could not reach the server. Check your connection and try again.',
      fields: {},
    };
  }
}
