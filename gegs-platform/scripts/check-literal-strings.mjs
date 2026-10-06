#!/usr/bin/env node
/**
 * Literal user-facing string gate (Phase 1 §12).
 *
 * §12: "Translation keys only in components; no literal user-facing string in
 * a component file, enforced by lint."
 *
 * WHY A SCRIPT RATHER THAN AN ESLINT RULE. `react/jsx-no-literals` is the
 * obvious candidate and is not enough: eslint-plugin-react is not a direct
 * dependency here, and more importantly that rule only sees JSX TEXT. The
 * inventory of these screens shows copy arriving four ways — a text node, a
 * string-valued prop (`label="Email address"`), a plain assignment
 * (`setSuccess('Your email is confirmed.')`) and a ternary branch
 * (`{busy ? 'Signing in…' : 'Sign in'}`). A gate that catches one of four
 * would give a false sense of coverage. This catches all four, adds no
 * dependency, and weakens no existing lint rule.
 *
 * THREE RULES, deliberately different in strictness:
 *   1. A JSX text node containing a letter is ALWAYS user-facing. If a human
 *      can read it on the page, it needs a key.
 *   2. A string literal in a COPY PROP (label, placeholder, title, alt,
 *      aria-label, aria-description) is ALWAYS user-facing, even one word —
 *      which is how `label="Password"` is caught where a sentence heuristic
 *      would miss it.
 *   3. Anywhere else, a SENTENCE-SHAPED literal: an initial capital followed
 *      by a space and more text, or a literal ending in . ? ! or …
 *      That shape is what separates 'Enter your email address.' from
 *      'current-password', 'application/json', '/api/auth/login' and a class
 *      name, none of which a translator should ever see.
 *
 * A line may be exempted with an `i18n-allow` comment on that line or the one
 * above — the same two-line window the secret scan and the token-discipline
 * gate use. Narrow by design: it marks ONE line, not a file or a directory.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ALLOW_MARKER = 'i18n-allow';

/**
 * Where the rule applies: the locale-aware application UI.
 *
 * Per the recorded batch 2b decision this is NOT limited to the six auth
 * screens — it covers the landing page and the root layout's own copy, the
 * skip link among them.
 */
const SCANNED = [/^src\/app\/.*\.tsx$/, /^src\/app\/\[locale\]\/\(auth\)\/_lib\/.*\.tsx?$/];

/**
 * The catalogue is where copy is SUPPOSED to live, so it is exempt by exact
 * path rather than by pattern. Nothing else is exempt.
 */
const EXEMPT_FILES = new Set([
  'src/i18n/messages/en.ts',
  'src/i18n/messages/ar.ts',
  'src/i18n/messages/index.ts',
]);

/** Props whose value a user reads, so any string in them is copy. */
const COPY_PROPS = ['label', 'placeholder', 'title', 'alt', 'aria-label', 'aria-description'];

const COPY_PROP_RE = new RegExp(`\\b(?:${COPY_PROPS.join('|')})\\s*=\\s*["']([^"'\\n]+)["']`);

/** A JSX text node: between > and <, containing a letter, not an expression. */
const JSX_TEXT_RE = />\s*([^<>{}\n]*[A-Za-z][^<>{}\n]*?)\s*</;

/**
 * A bare prose line: JSX text that Prettier has wrapped onto its own line, so
 * the `>` and `<` that bracket it are on neighbouring lines.
 *
 * Without this the skip link — three lines, with "Skip to content" alone in the
 * middle — would pass unnoticed, and it is named copy in the recorded decision.
 * The exclusions are what keep it quiet: a line carrying `=`, a bracket, a
 * semicolon or a backtick is code, not prose.
 */
const BARE_PROSE_RE = /^[A-Za-z'"][^=(){}[\];`]*\s+[^=(){}[\];`]*[A-Za-z.?!…,]$/;

/**
 * An object property (`title: 'Operations platform',`) reads like prose to the
 * rule above but is code. Prose keeps its colons — "implemented yet: schema"
 * is a real sentence — so the test anchors on an identifier-then-colon at the
 * START of the line rather than banning the character.
 */
const OBJECT_PROPERTY_RE = /^['"]?[\w-]+['"]?\s*:/;

/** Sentence-shaped: capitalised multi-word, or ending in sentence punctuation. */
const SENTENCE_RE = /['"](?:[A-Z][^'"\n]*\s[^'"\n]*|[^'"\n]*[.?!…])['"]/;

/** Technical shapes that must never count, whatever else matches. */
const TECHNICAL_RE =
  /^(?:use client|use server|[/.][\w/.\-[\]()]*|[a-z][\w-]*(?:\/[\w+.-]+)?|[A-Z][A-Z_]+|#[0-9a-fA-F]{3,8}|\d[\w.\s-]*)$/;

export function isScanned(file) {
  if (EXEMPT_FILES.has(file)) return false;
  return SCANNED.some((re) => re.test(file));
}

function isAllowed(lines, index) {
  const current = lines[index] ?? '';
  const previous = index > 0 ? (lines[index - 1] ?? '') : '';
  return current.includes(ALLOW_MARKER) || previous.includes(ALLOW_MARKER);
}

/** Strips line comments so prose in a comment is not mistaken for copy. */
function withoutComments(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '')
    .replace(/^\s*\*.*$/, '');
}

/**
 * Marks the lines inside a multi-line comment, including a JSX block comment.
 *
 * Comment prose reads exactly like copy — the live-region note in the sign-in
 * screen is two sentences of plain English — so without this the gate would
 * send someone off to translate a code comment.
 */
function blockCommentLines(lines) {
  const inside = new Array(lines.length).fill(false);
  let open = false;
  lines.forEach((line, i) => {
    const stripped = line.replace(/\/\*.*?\*\//g, '');
    if (open) inside[i] = true;
    if (stripped.includes('/*')) open = true;
    if (stripped.includes('*/')) open = false;
  });
  return inside;
}

/**
 * One finding per offending line, so the report points at a line to fix.
 *
 * The two JSX rules apply only to `.tsx`. In a plain `.ts` file a return type
 * such as `): Promise<AuthResult> {` looks exactly like a text node between
 * angle brackets, and reporting that would be the kind of noise that gets a
 * gate switched off.
 */
export function findLiteralStrings(file, text) {
  const found = [];
  const lines = text.split('\n');
  const jsx = file.endsWith('.tsx');
  const inComment = blockCommentLines(lines);

  lines.forEach((raw, i) => {
    if (isAllowed(lines, i) || inComment[i]) return;
    const line = withoutComments(raw);
    if (line.trim() === '') return;

    const copyProp = jsx ? COPY_PROP_RE.exec(line) : null;
    if (copyProp?.[1] && !TECHNICAL_RE.test(copyProp[1].trim())) {
      found.push({ file, line: i + 1, kind: 'copy prop', text: copyProp[1].trim() });
      return;
    }

    const jsxText = jsx ? JSX_TEXT_RE.exec(line) : null;
    if (jsxText?.[1] && !TECHNICAL_RE.test(jsxText[1].trim())) {
      found.push({ file, line: i + 1, kind: 'JSX text', text: jsxText[1].trim() });
      return;
    }

    if (jsx) {
      // `{' '}` is Prettier's explicit space at a wrap; it is punctuation in the
      // sentence, not code, so it is removed before the shape is judged.
      const bare = line.replace(/\{' '\}/g, '').trim();
      const prose = BARE_PROSE_RE.test(bare) && !OBJECT_PROPERTY_RE.test(bare);
      if (prose && !TECHNICAL_RE.test(bare)) {
        found.push({ file, line: i + 1, kind: 'JSX text', text: bare });
        return;
      }
    }

    const sentence = SENTENCE_RE.exec(line);
    if (sentence) {
      const value = sentence[0].slice(1, -1).trim();
      if (!TECHNICAL_RE.test(value)) {
        found.push({ file, line: i + 1, kind: 'string literal', text: value });
      }
    }
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
    if (!isScanned(file)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      // A tracked path that is not on disk (a rename staged only in the index)
      // is skipped rather than crashing the gate.
      continue;
    }
    findings.push(...findLiteralStrings(file, text));
  }

  if (findings.length > 0) {
    console.error(`\nLiteral user-facing strings FOUND — ${findings.length}:\n`);
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  [${f.kind}]  ${JSON.stringify(f.text)}`);
    }
    console.error(
      '\nMove the copy into src/i18n/messages/en.ts and read it through a key\n' +
        `(Phase 1 §12). If a literal is genuinely technical, put an "${ALLOW_MARKER}"\n` +
        'comment on that line or the line above, with the reason.\n',
    );
    process.exit(1);
  }

  console.error('No literal user-facing strings outside the message catalogue.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
