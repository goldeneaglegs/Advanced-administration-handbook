import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { SESSION_COOKIE, resolveSession } from '@/lib/auth/session';

/**
 * The locale for a LOCALE-LESS entry point (Phase 1 §12, M4 batch 2a decision).
 *
 * The recorded decision: the URL locale is authoritative for an explicitly
 * localised page, and the stored preference is consulted ONLY when the URL
 * carries no locale — `/`, or a legacy path such as `/sign-in` that WordPress
 * may still link to (§1.2 rule 3).
 *
 * THERE IS NO SECOND SOURCE OF TRUTH. The preference is read through the
 * existing `resolveSession`, which already returns `locale` from the same query
 * that validates the session. No new query, no new column, no cookie, no cache.
 *
 * NODE RUNTIME ONLY. `resolveSession` reaches PostgreSQL through Prisma, which
 * cannot run on the Edge, so middleware can never call this — middleware can
 * see that a session cookie exists but not whether it is valid or what locale
 * it holds. That is why the locale-less redirects are server components rather
 * than a middleware rewrite.
 *
 * READ-ONLY: visiting a locale URL must not rewrite the stored preference, so
 * nothing here writes to `users`.
 */
export async function resolveEntryLocale(cookieHeader: string | undefined): Promise<Locale> {
  const token = readCookieValue(cookieHeader, SESSION_COOKIE);
  const session = await resolveSession(token);
  if (!session) return DEFAULT_LOCALE;

  // `users.locale` is `text` with a CHECK constraint rather than an enum, so a
  // row written outside that constraint cannot widen behaviour here.
  return isLocale(session.locale) ? session.locale : DEFAULT_LOCALE;
}

/**
 * Reads one cookie from a raw `Cookie` header.
 *
 * `readCookie` in request-context.ts takes a `Request`, which a server
 * component does not have; this takes the header string Next.js hands it. The
 * parsing rule is identical, deliberately.
 */
export function readCookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
