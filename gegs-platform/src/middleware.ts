import { type NextRequest, NextResponse } from 'next/server';
import { REQUEST_ID_HEADER, resolveRequestId } from '@/lib/request-id';
import { CSRF_COOKIE, csrfCookieOptions, mintCsrfToken } from '@/lib/auth/csrf';

/**
 * Security headers and the WordPress boundary, applied to every response.
 *
 * Phase 1 §1.2 rule 2 is the load-bearing one here: this application must be
 * invisible to crawlers, so that nothing it does can affect the existing
 * WordPress site's SEO, schema or breadcrumbs. `X-Robots-Tag` is set on every
 * response rather than per-page, because a single missed page would break the
 * guarantee.
 */
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is required for Next.js's bootstrap script in this
  // configuration. Milestone 10 replaces it with a per-request nonce; it is
  // recorded as a known limitation until then.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // Documents are fetched from the storage origin via signed URLs (M5).
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

export function middleware(request: NextRequest): NextResponse {
  const requestId = resolveRequestId(request.headers);

  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers: forwarded } });

  // Phase 1 §1.2 — the app owns no indexed URL.
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');

  response.headers.set('Content-Security-Policy', CSP);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set(REQUEST_ID_HEADER, requestId);

  // Issue a CSRF token if the visitor has none. It must be minted here rather
  // than in a page, because a React server component cannot set a cookie. The
  // cookie is deliberately NOT HttpOnly: the page reads it to echo into the
  // form, which is the double-submit mechanism. An attacker's page cannot read
  // it, because it belongs to this origin.
  if (!request.cookies.has(CSRF_COOKIE)) {
    response.cookies.set(
      CSRF_COOKIE,
      mintCsrfToken(),
      csrfCookieOptions(request.nextUrl.protocol === 'https:'),
    );
  }

  // HSTS is only meaningful over TLS, and setting it in local development would
  // pin a developer's browser to https://localhost.
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
