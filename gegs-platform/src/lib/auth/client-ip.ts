import { isIP } from 'node:net';

/**
 * Client IP resolution.
 *
 * APPROVED DECISION (Milestone 2, option A): the client IP comes from the
 * TCP socket — `req.socket.remoteAddress` — captured by the custom Node server
 * in `server.ts`, never from a request header the client controls.
 *
 * HOW IT REACHES HERE. Next.js 15 removed `NextRequest.ip` and exposes no
 * socket to route handlers or middleware, so `server.ts` injects the socket
 * address as the internal header below. Before injecting it, `server.ts`
 * DELETES that header and every client-supplied forwarding header from the
 * inbound request, so a client cannot pre-set it. See
 * `SPOOFABLE_IP_HEADERS` in server.ts.
 *
 * WHY NOT X-Forwarded-For. A client-supplied `X-Forwarded-For` can say
 * anything. Reading it would let one host present a different IP on every
 * request and defeat per-IP throttling entirely, while the table filled up and
 * the tests passed. There is deliberately NO trusted-proxy logic here:
 * terminating that header correctly behind the approved regional load balancer
 * is a Milestone 10 deployment task, and until it exists the socket address is
 * the only trustworthy source.
 */
export const INTERNAL_CLIENT_IP_HEADER = 'x-gegs-client-ip';

/**
 * Normalises a socket address for storage in a PostgreSQL `inet` column.
 *
 * Node reports an IPv4 client on a dual-stack listener as an IPv4-mapped IPv6
 * address (`::ffff:127.0.0.1`). Storing both forms for the same client would
 * split its throttle counters in two and halve the effectiveness of the limit,
 * so the mapped form is reduced to plain IPv4. An IPv6 zone index
 * (`fe80::1%eth0`) is also dropped, since `inet` will not accept it.
 */
export function normaliseIp(raw: string | undefined | null): string | null {
  if (!raw) return null;

  let value = raw.trim();
  if (value.length === 0) return null;

  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped?.[1]) value = mapped[1];

  return isIP(value) === 0 ? null : value;
}

/**
 * Reads the socket address that `server.ts` injected.
 *
 * Validated again here rather than trusted: if the internal header is ever
 * absent or malformed — a misconfiguration, or the app run without the custom
 * server — this returns null. Per-IP throttling then skips rather than
 * throttling on a bogus value, and `auth_attempts.ip` records NULL so the gap
 * is visible in the data instead of silent.
 *
 * This function reads ONE header and no other. It must never be changed to
 * consult `X-Forwarded-For` or any sibling without an explicit decision.
 */
export function resolveClientIp(headers: Headers): string | null {
  return normaliseIp(headers.get(INTERNAL_CLIENT_IP_HEADER));
}
