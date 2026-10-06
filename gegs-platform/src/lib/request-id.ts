export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * One identifier per request, echoed to the client, written to the audit log,
 * and printed in the server log (Phase 1 §3.1). When a user reports a problem,
 * this single string finds everything — which is why it is generated at the
 * edge and never regenerated downstream.
 *
 * Uses the Web Crypto global rather than `node:crypto` because this module is
 * imported by middleware, which runs in the Edge runtime where node: builtins
 * are unavailable. The global is present in both runtimes.
 */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Whether an upstream-supplied id may be reused.
 *
 * The character allow-list prevents log forging: a value containing a newline
 * would let a caller write a fabricated line into the server log. The `Headers`
 * implementation already rejects newlines, so this is defence in depth for any
 * caller that reaches the validator by another route — which is also why it is
 * exported and tested directly rather than only through a `Headers` object.
 */
export function isWellFormedRequestId(value: string): boolean {
  return /^[A-Za-z0-9-]{8,64}$/.test(value);
}

/** Reuses an upstream id when the proxy supplied a sound one; otherwise mints one. */
export function resolveRequestId(headers: Headers): string {
  const existing = headers.get(REQUEST_ID_HEADER);
  if (existing !== null && isWellFormedRequestId(existing)) return existing;
  return newRequestId();
}
