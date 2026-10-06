import { type NextRequest, NextResponse } from 'next/server';
import { LOCALE_HEADER, firstSegment, isLocale } from '@/i18n/locales';
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

  // Locale for the root layout, taken from the URL and nowhere else (§12).
  //
  // The delete is unconditional and comes FIRST, so a client-supplied
  // `x-gegs-locale` is always discarded rather than trusted — the same ordering
  // server.ts uses for `x-gegs-client-ip`, where the internal header heads the
  // strip list for exactly this reason. The header is then set only when the
  // first path segment is a supported locale, so `/sign-in` carries none and
  // the layout falls back to the default.
  //
  // NO REDIRECT HAPPENS HERE. The stored-preference redirect for a locale-less
  // entry needs `users.locale`, which means Prisma, which cannot run on the
  // Edge. It is a server component instead. Keeping this function
  // single-exit also means the security block below cannot be skipped: Phase 1
  // §1.2 rule 2 wants `X-Robots-Tag` on EVERY response, and an early return is
  // how that guarantee gets lost.
  forwarded.delete(LOCALE_HEADER);
  const segment = firstSegment(request.nextUrl.pathname);
  if (isLocale(segment)) forwarded.set(LOCALE_HEADER, segment);

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
