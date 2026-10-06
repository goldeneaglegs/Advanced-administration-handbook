/**
 * Locale primitives (Phase 1 §12).
 *
 * §12 fixes the set at `en` and `ar`, and Milestone 1 already enforces it in
 * the database: `users.locale text NOT NULL DEFAULT 'en'` with
 * `CONSTRAINT users_locale_supported CHECK (locale IN ('en', 'ar'))`. This
 * module is the code-side half of that single fact, and a unit test reads the
 * constraint out of the migration and compares the two, so they cannot drift.
 * Adding a third language is therefore a migration plus a catalogue, never a
 * change to a constant here.
 *
 * RUNTIME NOTE: imported by `src/middleware.ts`, which Next.js runs in the Edge
 * runtime. Nothing here may use a `node:` builtin. That constraint has already
 * broken the build twice in this project — `request-id.ts` and `csrf.ts` both
 * carry the same warning.
 */
export const LOCALES = ['en', 'ar'] as const;

export type Locale = (typeof LOCALES)[number];

/** Matches the `users.locale` column default, not merely the first entry. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The internal header carrying the locale from middleware to the root layout.
 *
 * It is INTERNAL: middleware deletes any client-supplied value before setting
 * its own, so a request cannot inject one. Same discipline as
 * `x-gegs-client-ip` in server.ts, where the internal header is stripped first
 * precisely so it cannot be forged.
 */
export const LOCALE_HEADER = 'x-gegs-locale';

/**
 * Whether a value is a supported locale.
 *
 * Case-sensitive and exact. `EN`, `en-GB` and `en/` are all rejected rather
 * than coerced, because a coerced locale is a locale nobody chose.
 */
export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** §12: `dir="rtl"` for Arabic. Set server-side, never corrected on the client. */
export function dirFor(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** The first path segment, or null for the root. Used to read the URL locale. */
export function firstSegment(pathname: string): string | null {
  const [, segment] = pathname.split('/');
  return segment === undefined || segment === '' ? null : segment;
}
