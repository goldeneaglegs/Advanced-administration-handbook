'use client';

import { useParams } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import type { MessageKey } from '@/i18n/messages';
import { type MessageParams, t } from '@/i18n/translate';

/**
 * The client-side accessor for screen copy (Phase 1 §12).
 *
 * The locale comes from the route segment and nowhere else — the same single
 * source of truth batch 2a established, read the same way `LocaleLink` reads
 * it. No context provider holding a second copy, no cookie, no
 * `navigator.language`: a second source is how a page ends up rendering one
 * language with the direction of another.
 *
 * UNUSED UNTIL BATCH 2b-ii, which is when the screens are keyed. It is built
 * here so that batch is a mechanical substitution with nothing left to design.
 */
export function useTranslation(): {
  locale: ReturnType<typeof resolveLocale>;
  t: (key: MessageKey, params?: MessageParams) => string;
} {
  const params = useParams<{ locale: string }>();
  const locale = resolveLocale(params.locale);
  return { locale, t: (key, messageParams) => t(locale, key, messageParams) };
}

function resolveLocale(value: string | undefined) {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
