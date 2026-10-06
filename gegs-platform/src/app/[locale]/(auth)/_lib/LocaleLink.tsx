'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';

/**
 * A link to another page in the app, inside the current locale (Phase 1 §12).
 *
 * The screens carried locale-less hrefs such as `/sign-in` from Milestone 2.
 * Those still resolve — the locale-less entry routes redirect them — but the
 * redirect resolves the locale from the STORED preference, so an anonymous
 * Arabic reader on `/ar/reset-password` would be sent to `/en/sign-in`. That
 * would quietly contradict the recorded decision that an explicit locale is
 * authoritative, so an in-app link keeps the locale it was clicked in.
 *
 * `next/link` rather than a bare anchor is also what `no-html-link-for-pages`
 * asks for, and it gives client-side navigation between screens.
 */
export function LocaleLink({ to, children }: { to: string; children: ReactNode }) {
  const params = useParams<{ locale: string }>();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return <Link href={`/${locale}${to}`}>{children}</Link>;
}
