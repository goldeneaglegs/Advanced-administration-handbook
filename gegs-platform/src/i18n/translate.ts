import { CATALOGUES, MESSAGE_KEYS, en, type MessageKey } from './messages/index.ts';
import { DEFAULT_LOCALE, type Locale } from './locales.ts';

/**
 * Message lookup with English fallback (Phase 1 §12).
 *
 * The fallback is the whole point. §12 says untranslated keys "render the
 * English", so a missing Arabic string is an ordinary, expected state — not an
 * error, not a blank, and never the key name. A user who sees `signIn.title`
 * on a page has been failed twice: once by the missing translation and once by
 * the code that decided to show them an identifier.
 */
export type MessageParams = Record<string, string | number>;

/** A placeholder as the catalogue writes it: `{min}`. */
const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Resolves a key for a locale, falling back to English, then interpolates.
 *
 * Never returns the key, never returns an empty string: English is always
 * present because `MessageKey` is derived from the English catalogue, so the
 * final `??` is unreachable by construction rather than by hope.
 */
export function t(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const template = CATALOGUES[locale]?.[key] ?? en[key];
  if (!params) return template;

  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    // An unknown placeholder is left verbatim rather than blanked: a visible
    // `{min}` in a review is a bug report, an empty gap is a mystery.
    return value === undefined ? match : String(value);
  });
}

/** Whether this locale has its own string for the key, rather than falling back. */
export function hasTranslation(locale: Locale, key: MessageKey): boolean {
  return CATALOGUES[locale]?.[key] !== undefined;
}

/**
 * Keys this locale does not translate, in catalogue order.
 *
 * Pure and synchronous, computed from the catalogues alone — there is no
 * runtime instrumentation, so nothing is collected from a request path and
 * nothing about a user ends up in a log (Phase 1 §6.2).
 */
export function untranslatedKeys(locale: Locale): MessageKey[] {
  if (locale === DEFAULT_LOCALE) return [];
  return MESSAGE_KEYS.filter((key) => !hasTranslation(locale, key));
}

/** Per-locale counts and lists, for the build report. */
export interface CoverageRow {
  locale: Locale;
  total: number;
  translated: number;
  missing: MessageKey[];
}

export function coverage(locales: readonly Locale[]): CoverageRow[] {
  return locales.map((locale) => {
    const missing = untranslatedKeys(locale);
    return {
      locale,
      total: MESSAGE_KEYS.length,
      translated: MESSAGE_KEYS.length - missing.length,
      missing,
    };
  });
}
