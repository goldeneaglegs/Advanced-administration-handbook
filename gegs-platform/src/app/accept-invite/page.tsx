import { redirectToEntryLocale } from '@/i18n/entry-redirect';

/** Locale-less legacy entry for /accept-invite. See entry-redirect.ts. */
export default async function Entry({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return redirectToEntryLocale('/accept-invite', await searchParams);
}
