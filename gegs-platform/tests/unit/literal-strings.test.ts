import { describe, expect, it } from 'vitest';
import { findLiteralStrings, isScanned } from '../../scripts/check-literal-strings.mjs';

/**
 * The literal-string gate (Phase 1 §12).
 *
 * Two failure modes, and the second is the dangerous one. A gate that misses
 * copy lets an untranslatable string ship; a gate that fires on code gets
 * switched off, after which it misses everything. So the four shapes it must
 * catch are asserted explicitly, and so is every technical shape it must leave
 * alone.
 */
const tsx = (text: string) => findLiteralStrings('src/app/[locale]/x/page.tsx', text);
const ts = (text: string) => findLiteralStrings('src/app/[locale]/(auth)/_lib/x.ts', text);

describe('catches all four shapes copy arrives in', () => {
  it('JSX text on one line', () => {
    expect(tsx('<h1>Sign in</h1>')).toHaveLength(1);
  });

  it('JSX text wrapped onto its own line, as Prettier leaves it', () => {
    // The skip link is exactly this shape, and it is named copy in the decision.
    expect(tsx('<a className="skip-link" href="#main">\n  Skip to content\n</a>')).toHaveLength(1);
  });

  it('a string-valued copy prop, even a single word', () => {
    // `label="Password"` is user-facing but not sentence-shaped, so a sentence
    // heuristic alone would miss it.
    const found = tsx('<Field id="password" label="Password" />');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'copy prop', text: 'Password' });
  });

  it('a TypeScript string assignment', () => {
    const found = ts("      setSuccess('Your email is confirmed. You can sign in now.');");
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('string literal');
  });

  it('a ternary branch', () => {
    expect(tsx("        {busy ? 'Signing in…' : 'Sign in'}")).toHaveLength(1);
  });

  it('a literal ending in sentence punctuation without a capital', () => {
    expect(ts("  const m = 'that address is already registered.';")).toHaveLength(1);
  });

  it('reports the line number and the text', () => {
    const found = tsx('<div>\n  <h1>Create your account</h1>\n</div>');
    expect(found[0]).toMatchObject({ line: 2, text: 'Create your account' });
  });

  it('reports every offending line, not just the first', () => {
    expect(tsx('<h1>Sign in</h1>\n<p>Reset your password</p>')).toHaveLength(2);
  });
});

describe('leaves technical strings alone', () => {
  it.each([
    ['the client directive', "'use client';"],
    ['an API path', "await postAuth('/api/auth/login', body);"],
    ['an autocomplete token', '<input autoComplete="current-password" />'],
    ['an input type', '<input type="email" />'],
    ['a content type', "headers: { 'Content-Type': 'application/json' }"],
    ['a csrf header name', "headers: { 'x-csrf-token': token }"],
    ['class names', '<div className="page page--narrow">'],
    ['an element id and name', '<input id="confirm_password" name="confirm_password" />'],
    ['an aria-live value', '<div role="status" aria-live="polite">'],
    ['a status union', "type Status = 'idle' | 'submitting' | 'failed' | 'succeeded';"],
    ['a field key', "setFields({ confirm_password: 'x' });"],
    ['an import', "import { Field } from '../_lib/Field';"],
    ['a hex colour', "const c = '#9b2c2c';"],
    ['a viewport property', "  width: 'device-width',"],
    ['a non-copy object property', '  robots: { index: false, follow: false },'],
    ['a numeric object property', '  initialScale: 1,'],
  ])('%s', (_label, line) => {
    expect(tsx(line)).toEqual([]);
  });

  it('ignores a TypeScript return type that looks like a text node', () => {
    // `): Promise<AuthResult> {` sits between angle brackets in a .ts file.
    expect(ts('export async function postAuth(path: string): Promise<AuthResult> {')).toEqual([]);
  });

  it('ignores prose inside a block comment', () => {
    const source = [
      '{/*',
      '  One live region for the whole form. Announced politely so a screen',
      '  reader hears the failure without the focus move interrupting it.',
      '*/}',
    ].join('\n');
    expect(tsx(source)).toEqual([]);
  });

  it('ignores a doc comment above real code', () => {
    expect(tsx('/** Sets the password from an invitation link. */\nconst x = 1;')).toEqual([]);
  });
});

describe('metadata copy is copy', () => {
  it('catches the document title, which a user reads in the browser tab', () => {
    // Per the recorded decision this becomes a key while KEEPING its value:
    // DECISION REQUIRED #4 is open and no application name is invented.
    const found = tsx("  title: 'Operations platform',");
    expect(found).toHaveLength(1);
    expect(found[0]?.text).toBe('Operations platform');
  });
});

describe('the allow marker', () => {
  it('exempts the line it sits on', () => {
    expect(tsx('<a href="/api/health">/api/health</a> {/* i18n-allow */}')).toEqual([]);
  });

  it('exempts the line below it', () => {
    expect(tsx('{/* i18n-allow: a JSON endpoint, not copy */}\n<h1>Sign in</h1>')).toEqual([]);
  });

  it('does not reach two lines down, so it cannot silently widen', () => {
    const source = '{/* i18n-allow */}\nconst x = 1;\n<h1>Sign in</h1>';
    expect(tsx(source)).toHaveLength(1);
  });
});

describe('scope is narrow and explicit', () => {
  it('covers the six auth screens', () => {
    expect(isScanned('src/app/[locale]/(auth)/sign-in/page.tsx')).toBe(true);
    expect(isScanned('src/app/[locale]/(auth)/reset-password/page.tsx')).toBe(true);
  });

  it('covers the shared auth _lib, including its .ts files', () => {
    expect(isScanned('src/app/[locale]/(auth)/_lib/Field.tsx')).toBe(true);
    expect(isScanned('src/app/[locale]/(auth)/_lib/client.ts')).toBe(true);
  });

  it('covers the landing page and the root layout, per the recorded decision', () => {
    expect(isScanned('src/app/[locale]/page.tsx')).toBe(true);
    expect(isScanned('src/app/layout.tsx')).toBe(true);
  });

  it('exempts the catalogue, which is where copy belongs', () => {
    expect(isScanned('src/i18n/messages/en.ts')).toBe(false);
    expect(isScanned('src/i18n/messages/ar.ts')).toBe(false);
  });

  it('does not scan server code, tests, scripts or docs', () => {
    expect(isScanned('src/lib/auth/messages.ts')).toBe(false);
    expect(isScanned('src/app/api/auth/login/route.ts')).toBe(false);
    expect(isScanned('tests/e2e/sign-in.spec.ts')).toBe(false);
    expect(isScanned('scripts/check-literal-strings.mjs')).toBe(false);
    expect(isScanned('docs/01-ARCHITECTURE-AND-UX-PLAN.md')).toBe(false);
  });

  it('cannot be widened by a lookalike path', () => {
    expect(isScanned('src/i18n/messages/en.ts.bak')).toBe(false);
    expect(isScanned('other/src/app/page.tsx')).toBe(false);
  });
});
