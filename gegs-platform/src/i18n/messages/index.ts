import { ar } from './ar.ts';
import { en, type MessageKey } from './en.ts';
import { LOCALES, type Locale } from '../locales.ts';

/**
 * The catalogue registry.
 *
 * English is complete by construction — it is the source `MessageKey` is
 * derived from. Every other locale is partial, which is what makes the fallback
 * in `translate.ts` a normal path rather than an error path.
 */
export const CATALOGUES: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  ar,
};

export { en, ar };
export type { MessageKey };

/** Every key, in catalogue order, so reports read predictably. */
export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

/** A compile-time guard that every supported locale has a catalogue entry. */
const _everyLocaleHasACatalogue: readonly Locale[] = LOCALES;
void _everyLocaleHasACatalogue;
