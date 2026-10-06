import { redirectToEntryLocale } from '@/i18n/entry-redirect';

/** Locale-less legacy entry for /forgot-password. See entry-redirect.ts. */
export default async function Entry({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectToEntryLocale('/forgot-password', await searchParams);
}
