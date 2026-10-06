import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveEntryLocale } from '@/i18n/entry-locale';

/**
 * The shared body of every locale-less legacy page route (Phase 1 §12, §1.2 r3).
 *
 * WordPress links into this application, and those links point at paths that
 * predate the locale segment — `/sign-in`, `/verify-email?token=...`. Each of
 * those paths keeps a route of its own, three lines long, calling this.
 *
 * WHY A ROUTE PER PATH RATHER THAN A CATCH-ALL: a catch-all would swallow every
 * unknown URL and redirect it, and `/this-route-does-not-exist` must keep
 * returning 404 — an existing test asserts exactly that, and a redirect in its
 * place would also hand a prober a way to tell "not a page" from "not a
 * locale". The set of routes on disk IS the allow-list, so nothing outside it
 * can be reached.
 *
 * The query string is carried across, because for three of these paths it holds
 * the one-time token the page needs.
 */
export async function redirectToEntryLocale(
  path: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<never> {
  const locale = await resolveEntryLocale((await headers()).get('cookie') ?? undefined);

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') query.append(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  redirect(`/${locale}${path}${suffix}`);
}
