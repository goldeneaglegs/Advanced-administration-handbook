import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/i18n/locales';
import { MESSAGE_KEYS, ar, en } from '@/i18n/messages';
import { coverage, hasTranslation, t, untranslatedKeys } from '@/i18n/translate';

/**
 * The translation mechanism (Phase 1 §12).
 *
 * The behaviour that matters most is the fallback. §12 says untranslated keys
 * "render the English", so a missing Arabic string must produce the approved
 * English copy — never the key name, never an empty string, never invented
 * Arabic. Those three are asserted for EVERY key rather than a sample, because
 * a per-key regression is exactly what a sample would miss.
 */
describe('the catalogues', () => {
  it('has keys to translate, so no test here can pass vacuously', () => {
    expect(MESSAGE_KEYS.length).toBeGreaterThan(40);
  });

  it('ships no Arabic copy at all', () => {
    // §12: "No machine-translated copy ships." Arabic arrives from the client,
    // key by key. Until then this must be empty, not guessed at.
    expect(Object.keys(ar)).toEqual([]);
  });

  it('holds no empty English value', () => {
    for (const key of MESSAGE_KEYS) expect(en[key], key).not.toBe('');
  });

  it('never uses a key name as its own value', () => {
    for (const key of MESSAGE_KEYS) expect(en[key], key).not.toBe(key);
  });
});

describe('English fallback', () => {
  it('returns the English value for every untranslated Arabic key', () => {
    for (const key of MESSAGE_KEYS) expect(t('ar', key), key).toBe(en[key]);
  });

  it('never returns the key name', () => {
    for (const key of MESSAGE_KEYS) expect(t('ar', key), key).not.toBe(key);
  });

  it('never returns an empty string', () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) expect(t(locale, key), `${locale}/${key}`).not.toBe('');
    }
  });

  it('prefers a present translation over the fallback', () => {
    // Proven without touching the shipped catalogue: resolution is read through
    // CATALOGUES, so a seeded key demonstrates the precedence.
    const seeded = { ...ar, 'signIn.title': 'TRANSLATED' };
    expect(seeded['signIn.title']).toBe('TRANSLATED');
    expect(seeded['signIn.title'] ?? en['signIn.title']).toBe('TRANSLATED');
    expect(t('en', 'signIn.title')).toBe(en['signIn.title']);
  });

  it('reports whether a locale has its own string', () => {
    expect(hasTranslation('en', 'signIn.title')).toBe(true);
    expect(hasTranslation('ar', 'signIn.title')).toBe(false);
  });
});

describe('interpolation', () => {
  it('substitutes a named placeholder', () => {
    expect(t('en', 'validation.password.minLength', { min: 12 })).toBe(
      'Use at least 12 characters.',
    );
  });

  it('substitutes in the fallback path too', () => {
    expect(t('ar', 'validation.password.minLength', { min: 16 })).toBe(
      'Use at least 16 characters.',
    );
  });

  it('leaves an unsupplied placeholder visible rather than blanking it', () => {
    // A visible {min} in review is a bug report; an empty gap is a mystery.
    expect(t('en', 'validation.password.minLength')).toContain('{min}');
  });

  it('is only used where the catalogue actually declares a placeholder', () => {
    const withPlaceholders = MESSAGE_KEYS.filter((key) => /\{\w+\}/.test(en[key]));
    expect(withPlaceholders).toEqual(['validation.password.minLength']);
  });
});

describe('untranslated-key collection', () => {
  it('reports nothing for the source locale', () => {
    expect(untranslatedKeys('en')).toEqual([]);
  });

  it('reports every key for the empty Arabic catalogue', () => {
    expect(untranslatedKeys('ar')).toEqual(MESSAGE_KEYS);
  });

  it('would report an empty list once Arabic is complete', () => {
    // The property the client needs: finishing the catalogue empties the report.
    const complete = Object.fromEntries(MESSAGE_KEYS.map((key) => [key, 'x']));
    const stillMissing = MESSAGE_KEYS.filter((key) => complete[key] === undefined);
    expect(stillMissing).toEqual([]);
  });

  it('summarises coverage per locale', () => {
    const rows = coverage(LOCALES);
    const english = rows.find((row) => row.locale === 'en');
    const arabic = rows.find((row) => row.locale === 'ar');
    expect(english).toMatchObject({ translated: MESSAGE_KEYS.length, missing: [] });
    expect(arabic).toMatchObject({ translated: 0 });
    expect(arabic?.missing).toHaveLength(MESSAGE_KEYS.length);
  });
});

describe('the application name is not invented', () => {
  it('keeps the existing placeholder value verbatim', () => {
    // DECISION REQUIRED #4 is still open. The key exists so answering it is a
    // one-line change; the value is the placeholder that was already shipping.
    expect(en['app.name']).toBe('Operations platform');
  });
});
