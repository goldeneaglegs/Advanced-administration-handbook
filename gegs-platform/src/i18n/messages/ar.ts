import type { MessageKey } from './en.ts';

/**
 * The Arabic message catalogue — DELIBERATELY EMPTY (Phase 1 §12).
 *
 * §12 is explicit: "No machine-translated copy ships. Untranslated keys render
 * the English and are listed in a build report." So this file contains no
 * Arabic string, no transliteration, no placeholder text and no machine
 * translation. Inventing copy for a product that files government paperwork on
 * people's behalf would be worse than shipping English.
 *
 * Every key is therefore untranslated today, `t()` falls back to English, and
 * `npm run i18n:report` lists each one. Real copy drops in here key by key with
 * no structural change anywhere else, and the report empties as it arrives.
 *
 * The `Partial<Record<MessageKey, string>>` type does two jobs: a key English
 * does not have is a typecheck failure, and every key is optional so a partial
 * catalogue is a legal state rather than a special case.
 */
export const ar: Partial<Record<MessageKey, string>> = {};
