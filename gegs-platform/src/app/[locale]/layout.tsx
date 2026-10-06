import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isLocale } from '@/i18n/locales';

/**
 * The locale segment's gate (Phase 1 §12).
 *
 * This layout renders NO markup. Next.js permits exactly one `<html>`/`<body>`
 * pair per route, and that belongs to the root layout, which is also the only
 * place `lang` and `dir` can be set. So this layout does the one thing the root
 * cannot: it validates the segment.
 *
 * An unsupported locale is a 404, which is the M4 batch 2a decision as
 * recorded. §12 names `en` and `ar` and no third locale, Milestone 1 enforces
 * that same set as a CHECK constraint, and an unknown path in this application
 * already returns 404 — so `/fr/sign-in` not existing is consistent with what
 * the repository already does, rather than a new public redirect rule nobody
 * approved.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return children;
}
