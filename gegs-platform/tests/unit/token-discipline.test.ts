import { describe, expect, it } from 'vitest';
import { findLiteralColours, isExempt } from '../../scripts/check-token-discipline.mjs';

/**
 * The token-discipline rule (Phase 1 §10.1).
 *
 * A gate nobody tests is a gate nobody can trust. The risk here is not that it
 * misses a literal colour — it is that it fires on something that is not a
 * colour at all, because a noisy gate gets switched off, and then the next real
 * literal ships.
 */
const find = (text: string) => findLiteralColours('src/app/example.css', text);

describe('detects a literal colour', () => {
  it.each([
    ['six-digit lowercase', 'color: #9b2c2c;'],
    ['six-digit uppercase', 'color: #9B2C2C;'],
    ['three-digit shorthand', 'background: #fff;'],
    ['eight-digit with alpha', 'background: #0b1a2fcc;'],
    ['inside a TypeScript string', "const c = '#B8923F';"],
    ['inside a comment', '/* was #1f6b4a before */'],
  ])('%s', (_label, line) => {
    expect(find(line)).toHaveLength(1);
  });

  it('reports the line number and the offending value', () => {
    const [finding] = find('a {\n  color: #a67f30;\n}');
    expect(finding).toMatchObject({ line: 2, value: '#a67f30' });
  });

  it('reports one finding per line, not per match', () => {
    // Enough to send the author to the line; listing both adds noise.
    expect(find('border: 1px solid #8b8172; background: #fbfaf8;')).toHaveLength(1);
  });

  it('finds a literal on every offending line', () => {
    expect(find('color: #9b2c2c;\npadding: 0;\nborder-color: #1f6b4a;')).toHaveLength(2);
  });
});

describe('leaves things that are not colours alone', () => {
  it.each([
    ['a URL fragment', 'href="/faq#section"'],
    ['a hyphenated anchor', 'href="#step-two"'],
    ['a shebang', '#!/usr/bin/env node'],
    ['a CSS id selector', '#main { margin: 0; }'],
    ['a full commit SHA', '// see 1e6ae9c08ae0f58b0ecb7c850fda94c1cc29be7a'],
    ['a hash inside a word', 'const issue = "GH#1234567";'],
    ['a character class, as the contrast gate uses', 'const re = /#[0-9a-fA-F]{6}/;'],
    ['a bare hash', 'const tag = "#";'],
    ['a four-digit hash', 'ticket #1234'],
    ['a five-digit hash', 'ref #12345'],
  ])('%s', (_label, line) => {
    expect(find(line)).toEqual([]);
  });

  it('does not fire on a token reference, which is the whole point', () => {
    expect(find('color: var(--danger);')).toEqual([]);
  });
});

describe('the allow marker', () => {
  it('exempts the line it sits on', () => {
    expect(find('background: #fff; /* token-colour-allow */')).toEqual([]);
  });

  it('exempts the line below it, so a reflowed comment still covers it', () => {
    expect(find('/* token-colour-allow */\nbackground: #fff;')).toEqual([]);
  });

  it('does not reach two lines down, so it cannot silently widen', () => {
    // A marker that drifted away from its line must stop working, not keep
    // covering whatever ends up below it.
    expect(find('/* token-colour-allow */\npadding: 0;\nbackground: #fff;')).toHaveLength(1);
  });

  it('covers a two-line window and nothing beyond it', () => {
    // The window is the marked line plus the one below, which is what lets a
    // marker sit in a comment above the code it exempts. The cost is that an
    // INLINE marker also covers the next line, so the window is asserted here
    // rather than left as a surprise: the third line is not covered.
    const findings = find(
      'background: #fff; /* token-colour-allow */\ncolor: #1f6b4a;\nborder-color: #9b2c2c;',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 3, value: '#9b2c2c' });
  });
});

describe('exemptions are narrow and by exact path', () => {
  it('exempts the canonical token source, where the values belong', () => {
    expect(isExempt('src/design/tokens.ts')).toBe(true);
  });

  it('exempts the generated stylesheet, which is derived not authored', () => {
    expect(isExempt('src/design/tokens.generated.css')).toBe(true);
  });

  it('exempts the approved specification and test fixtures', () => {
    expect(isExempt('docs/01-ARCHITECTURE-AND-UX-PLAN.md')).toBe(true);
    expect(isExempt('tests/unit/token-discipline.test.ts')).toBe(true);
  });

  it('does NOT exempt application code', () => {
    expect(isExempt('src/app/globals.css')).toBe(false);
    expect(isExempt('src/app/(auth)/sign-in/page.tsx')).toBe(false);
    expect(isExempt('src/design/other.ts')).toBe(false);
  });

  it('does NOT exempt the gates themselves', () => {
    // They parse hex with character classes rather than literals, so they pass
    // on their own merits rather than by exemption.
    expect(isExempt('scripts/check-contrast.mjs')).toBe(false);
    expect(isExempt('scripts/generate-css-tokens.ts')).toBe(false);
  });

  it('cannot be widened by a lookalike path', () => {
    expect(isExempt('src/design/tokens.ts.bak')).toBe(false);
    expect(isExempt('app/docs/theme.css')).toBe(false);
  });
});
