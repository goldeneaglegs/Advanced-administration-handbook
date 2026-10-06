import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import next from 'next';
import { INTERNAL_CLIENT_IP_HEADER, normaliseIp } from './src/lib/auth/client-ip.ts';

/**
 * Custom Node HTTP server.
 *
 * It exists for exactly one reason: to capture the TCP peer address and hand it
 * to the application in a way a client cannot forge.
 *
 * Next.js 15 removed `NextRequest.ip` and gives route handlers and middleware
 * no access to the socket, so `next start` cannot support per-IP throttling at
 * all. Phase 1 §4.1 requires throttling on both the per-account and the per-IP
 * axis, and the Milestone 2 sign-off chose to have it effective from the start
 * rather than deferred. This thin wrapper is the price of that, and it is the
 * only deviation from the Phase 1 §1.1 topology.
 *
 * Run with `node server.ts` — Node 22 strips the types natively, so there is no
 * build step and no extra dependency, and `tsc --noEmit` still type-checks it.
 */

/**
 * Every header a client could use to claim a different address.
 *
 * All of them are DELETED from the inbound request before the socket address is
 * injected. Nothing in the application reads any of them; they are removed so
 * that no future code can be misled by one, and so that a request arriving with
 * a pre-set internal header cannot impersonate the server's own injection.
 *
 * The internal header is listed FIRST to make the ordering dependency explicit:
 * it must be deleted before it is set.
 */
const SPOOFABLE_IP_HEADERS = [
  INTERNAL_CLIENT_IP_HEADER,
  'x-forwarded-for',
  'x-real-ip',
  'x-client-ip',
  'x-cluster-client-ip',
  'x-forwarded',
  'forwarded',
  'forwarded-for',
  'true-client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'x-appengine-user-ip',
  'x-original-forwarded-for',
] as const;

/**
 * Replaces any client-supplied addressing headers with the socket address.
 *
 * Exported for test: the ordering here (delete, then set) is the whole security
 * property, so it is asserted directly rather than inferred from behaviour.
 */
export function sanitiseAndStampClientIp(req: IncomingMessage): string | null {
  for (const header of SPOOFABLE_IP_HEADERS) {
    delete req.headers[header];
  }

  const ip = normaliseIp(req.socket.remoteAddress);
  if (ip !== null) {
    req.headers[INTERNAL_CLIENT_IP_HEADER] = ip;
  }
  return ip;
}

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOSTNAME ?? '0.0.0.0';
const dev = process.env.NODE_ENV !== 'production';

async function main(): Promise<void> {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    sanitiseAndStampClientIp(req);
    handle(req, res).catch((error: unknown) => {
      // Never leak the error to the client (Phase 1 §6.2); the request id in the
      // application's own logs is the thread to follow.
      console.error('Unhandled request error', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.listen(port, hostname, () => {
    console.error(`ready on http://${hostname}:${port} (dev=${dev})`);
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

// Only start when executed directly, so a test can import the sanitiser without
// binding a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
