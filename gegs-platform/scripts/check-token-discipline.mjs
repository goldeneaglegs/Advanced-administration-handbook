#!/usr/bin/env node
/**
 * Token discipline gate (Phase 1 §10.1).
 *
 * §10.1 promises that substituting Golden Eagle's real brand values is a
 * one-file change: "every colour is a token, used nowhere literally". That
 * promise is only true if something enforces it. It was not enforced, and it
 * had already stopped being true — six literal colours had accumulated in
 * globals.css, so answering DECISION REQUIRED #14 would have missed them.
 *
 * This fails the build when a colour-shaped hex literal appears in application
 * code instead of a token.
 *
 * SCOPE, deliberately narrow in both directions:
 *   - Two files are exempt BY EXACT PATH: the canonical token source, which is
 *     where the values are supposed to live, and the stylesheet generated from
 *     it, which is derived rather than authored.
 *   - `docs/` is exempt because the approved Phase 1 plan quotes the palette as
 *     a specification, and `tests/` because fixtures must be able to contain a
 *     literal to test a rule about literals.
 *   - `scripts/` is NOT exempt. The gates parse hex with character classes
 *     rather than literals, so they pass on their own merits.
 * A single line may be exempted with a `token-colour-allow` comment, on that
 * line or the one above, which is the same idiom the secret scan uses.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOW_MARKER = 'token-colour-allow';

/** Where design values are allowed to exist as literals. */
const EXEMPT_FILES = new Set(['src/design/tokens.ts', 'src/design/tokens.generated.css']);

/** Specification text and test fixtures, which must be able to quote a colour. */
const EXEMPT_DIRECTORIES = ['docs/', 'tests/'];

/** The surfaces a literal colour could actually reach a user from. */
const SCANNED_EXTENSIONS = /\.(?:css|scss|ts|tsx|js|jsx|mjs|cjs)$/i;

/**
 * A colour-shaped hex literal: #RGB, #RRGGBB or #RRGGBBAA.
 *
 * The lookbehind rejects a `#` that follows a word character or another `#`,
 * and the lookahead rejects a longer token, so `#section`, `#!/usr/bin/env`,
 * `#faq` and a 40-character commit SHA are all left alone. An 8-character SHA
 * fragment is indistinguishable from a colour and will be reported; the allow
 * marker is the answer in that case, and the next line is the proof — the
 * example below is this gate flagging its own documentation.
 *
 * token-colour-allow
 * Example of the limitation: #deadbeef.
 */
const COLOUR_RE = /(?<![\w#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/;

export function isExempt(file) {
  if (EXEMPT_FILES.has(file)) return true;
  return EXEMPT_DIRECTORIES.some((directory) => file.startsWith(directory));
}

function isAllowed(lines, index) {
  const current = lines[index] ?? '';
  const previous = index > 0 ? (lines[index - 1] ?? '') : '';
  return current.includes(ALLOW_MARKER) || previous.includes(ALLOW_MARKER);
}

/** Returns one finding per offending line. Exported so the rule is testable. */
export function findLiteralColours(file, text) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (isAllowed(lines, i)) return;
    const match = COLOUR_RE.exec(line);
    if (match) found.push({ file, line: i + 1, value: match[0] });
  });
  return found;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function main() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (!SCANNED_EXTENSIONS.test(file) || isExempt(file)) continue;
    findings.push(...findLiteralColours(file, readFileSync(file, 'utf8')));
  }

  if (findings.length > 0) {
    console.error(`\nToken discipline FAILED — ${findings.length} literal colour(s):\n`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.value}`);
    console.error(
      '\nUse a token from src/design/tokens.ts instead, so replacing the brand\n' +
        'values stays a one-file change. If a hash genuinely is not a colour, put\n' +
        `a "${ALLOW_MARKER}" comment on that line or the line above.\n`,
    );
    process.exit(1);
  }

  console.error('Token discipline passed. No literal colours outside the token source.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
