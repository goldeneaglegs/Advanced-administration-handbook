import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALE_HEADER, dirFor, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/translate';
import './globals.css';

/**
 * The locale for this request, from the header middleware forwarded.
 *
 * Shared by the layout and its metadata so there is one resolution rather than
 * two that could disagree. The value is validated rather than trusted: a header
 * is a header, even an internal one.
 */
async function localeFromHeaders() {
  const forwarded = (await headers()).get(LOCALE_HEADER);
  return isLocale(forwarded) ? forwarded : DEFAULT_LOCALE;
}

/**
 * Phase 1 §1.2: the application must never be indexed. This is belt-and-braces
 * alongside the X-Robots-Tag header set in middleware.
 *
 * `generateMetadata` rather than a static object because the title is now a
 * catalogue key and the locale lives on the forwarded header. The value is
 * unchanged — `app.name` holds the existing placeholder, and DECISION REQUIRED
 * #4 stays open — but a title that could never follow the locale would be a
 * dead end the moment Arabic copy arrives.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t(await localeFromHeaders(), 'app.name'),
    robots: { index: false, follow: false },
  };
}

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
  const locale = await localeFromHeaders();

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <a className="skip-link" href="#main">
          {t(locale, 'app.skipToContent')}
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
