import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveEntryLocale } from '@/i18n/entry-locale';

/**
 * The locale-less root (Phase 1 §12).
 *
 * `/` carries no locale, so this is one of the entry points where the stored
 * preference applies: a signed-in user goes to their `users.locale`, everyone
 * else to the default. Per the recorded decision this NEVER writes the
 * preference, and it never overrides an explicit `/en/...` or `/ar/...`.
 *
 * A server component rather than a middleware redirect, because reading
 * `users.locale` means Prisma, which cannot run on the Edge.
 */
export default async function LocaleLessRoot() {
  const locale = await resolveEntryLocale((await headers()).get('cookie') ?? undefined);
  redirect(`/${locale}`);
}
