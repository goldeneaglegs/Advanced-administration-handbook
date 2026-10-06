'use client';

import type { MessageKey } from '@/i18n/messages';

/**
 * Shared client helpers for the auth screens.
 *
 * The Login screen keeps its own inline copy of the cookie read: it is already
 * committed and tested, and leaving it alone means these five screens cannot
 * regress it. A later tidy-up can fold it in here.
 *
 * This module is not a component, so it cannot use `useTranslation`. Its own
 * two failure messages are therefore translated by the caller, which is passed
 * in as `translate` — the locale stays the route segment's job and no second
 * source of truth appears here.
 */
export interface AuthResult {
  ok: boolean;
  /**
   * The message to show the user.
   *
   * KNOWN v1 LIMITATION, recorded rather than implied: when this came from the
   * server it is ENGLISH IN BOTH LOCALES. Milestone 4 does not localise the API
   * `message` field (Phase 1 §3.2 envelope unchanged), so an Arabic reader sees
   * English server text. An earlier version of this comment claimed the server
   * message was "already localised", which was never true.
   *
   * It is still shown verbatim and never mapped to a key: `GENERIC_TOKEN_FAILURE`
   * is deliberately one string so "no such token", "already used" and "expired"
   * cannot be told apart, and a client-side lookup table would be exactly the
   * place that distinction crept back in.
   */
  message: string;
  /** Per-field errors, keyed by input name, for aria-describedby wiring. */
  fields: Record<string, string>;
}

/** The caller's bound translator, so this module holds no copy of its own. */
export type Translate = (key: MessageKey) => string;

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
export async function postAuth(
  path: string,
  body: Record<string, unknown>,
  translate: Translate,
): Promise<AuthResult> {
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
      message: error?.message ?? translate('error.unexpected'),
      fields: error?.fields ?? {},
    };
  } catch {
    return {
      ok: false,
      message: translate('error.network'),
      fields: {},
    };
  }
}
