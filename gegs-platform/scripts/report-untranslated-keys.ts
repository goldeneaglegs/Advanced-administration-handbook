/**
 * The untranslated-key build report (Phase 1 §12).
 *
 * §12: "No machine-translated copy ships. Untranslated keys render the English
 * and are listed in a build report."
 *
 * REPORT-AND-PASS, by recorded decision. This EXITS 0 even with every Arabic
 * key missing, and that is deliberate rather than lenient: the Arabic catalogue
 * ships empty on purpose, so a failing gate would make the approved
 * English-fallback behaviour unshippable and the only way to go green would be
 * to invent copy — exactly what §12 forbids. The report's job is to make the
 * gap impossible to forget, not to block on it.
 *
 * It fails for one reason only: a locale with no catalogue at all, which would
 * mean the fallback has nothing to fall back through.
 *
 * Node runs this file directly — Node 22 strips the types, so there is no build
 * step, the same arrangement server.ts and generate-css-tokens.ts use.
 */
import { pathToFileURL } from 'node:url';
import { LOCALES } from '../src/i18n/locales.ts';
import { CATALOGUES, MESSAGE_KEYS } from '../src/i18n/messages/index.ts';
import { coverage } from '../src/i18n/translate.ts';

export function renderReport(): { text: string; ok: boolean } {
  const lines: string[] = [];
  let ok = true;

  lines.push(`Translation coverage — ${MESSAGE_KEYS.length} keys.`);

  for (const row of coverage(LOCALES)) {
    if (CATALOGUES[row.locale] === undefined) {
      lines.push(`  ${row.locale}: NO CATALOGUE — the English fallback has nothing to resolve.`);
      ok = false;
      continue;
    }

    const percent = row.total === 0 ? 100 : Math.round((row.translated / row.total) * 100);
    lines.push(`  ${row.locale}: ${row.translated}/${row.total} translated (${percent}%)`);

    if (row.missing.length > 0) {
      lines.push(`    ${row.missing.length} key(s) render the English fallback:`);
      for (const key of row.missing) lines.push(`      ${key}`);
    }
  }

  lines.push('');
  lines.push('Untranslated keys render the approved English value (Phase 1 §12).');
  lines.push('No copy is machine-translated, and none is invented to empty this list.');
  return { text: lines.join('\n'), ok };
}

function main(): void {
  const { text, ok } = renderReport();
  console.error(text);
  if (!ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
