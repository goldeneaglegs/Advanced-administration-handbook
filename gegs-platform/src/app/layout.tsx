import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_HEADER, dirFor, isLocale } from '@/i18n/locales';
import './globals.css';

// Phase 1 §1.2: the application must never be indexed. This is belt-and-braces
// alongside the X-Robots-Tag header set in middleware.
export const metadata: Metadata = {
  title: 'Operations platform',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * The root layout, and the only place `<html>` exists.
 *
 * Phase 1 §12 requires `lang` and `dir` to be set FROM THE URL SEGMENT ON THE
 * SERVER — "no flash of wrong direction". A root layout receives no route
 * params, so middleware reads the segment and forwards it on an internal
 * header, which is read here. The value is validated again rather than trusted:
 * a header is a header.
 *
 * CONSEQUENCE, recorded rather than hidden: `headers()` opts this layout into
 * dynamic rendering, so pages that previously prerendered as static are now
 * server-rendered per request. That is the cost of meeting the no-flash
 * requirement for a path-driven locale, and it changes nothing operationally
 * here — §1.2 rule 1 means every one of these pages sits behind a session and
 * serves no indexed URL.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const forwarded = (await headers()).get(LOCALE_HEADER);
  const locale = isLocale(forwarded) ? forwarded : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
