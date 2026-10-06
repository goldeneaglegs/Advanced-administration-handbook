import { describe, expect, it } from 'vitest';
import { MESSAGE_KEYS } from '@/i18n/messages';
import { renderReport } from '../../scripts/report-untranslated-keys.ts';

/**
 * The untranslated-key build report (Phase 1 §12).
 *
 * The recorded decision is REPORT-AND-PASS, so the test that matters is the
 * one proving the report stays non-blocking: the Arabic catalogue ships empty
 * on purpose, and a failing gate would leave inventing copy as the only way to
 * go green — which §12 forbids outright.
 */
describe('renderReport', () => {
  const { text, ok } = renderReport();

  it('passes even with every Arabic key untranslated', () => {
    expect(ok).toBe(true);
  });

  it('states the total key count', () => {
    expect(text).toContain(`${MESSAGE_KEYS.length} keys`);
  });

  it('reports English as complete', () => {
    expect(text).toContain(`en: ${MESSAGE_KEYS.length}/${MESSAGE_KEYS.length} translated (100%)`);
  });

  it('reports Arabic as untranslated rather than hiding it', () => {
    expect(text).toContain(`ar: 0/${MESSAGE_KEYS.length} translated (0%)`);
    expect(text).toContain(`${MESSAGE_KEYS.length} key(s) render the English fallback`);
  });

  it('lists every missing key by name, so none is merely counted', () => {
    for (const key of MESSAGE_KEYS) expect(text, key).toContain(key);
  });

  it('records why the list is not emptied by translating', () => {
    expect(text).toContain('No copy is machine-translated');
  });

  it('fails only when a locale has no catalogue at all', () => {
    // The one genuine error: the fallback would have nothing to resolve through.
    expect(text).not.toContain('NO CATALOGUE');
    expect(ok).toBe(true);
  });
});
