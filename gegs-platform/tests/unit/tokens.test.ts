import { describe, expect, it } from 'vitest';
import {
  borderWidth,
  colour,
  CONTRAST_REQUIREMENTS,
  focusRing,
  fontFamily,
  lineHeight,
  motionMs,
  radius,
  shadow,
  space,
  typeLimits,
  typeScale,
} from '@/design/tokens';
import { renderCss } from '../../scripts/generate-css-tokens.ts';

/**
 * Token integrity (Phase 1 §10).
 *
 * The contrast gate already proves the palette is legible. What it cannot
 * prove is that the palette is COMPLETE, that nothing sits off an approved
 * scale, and that the generated stylesheet still says what the tokens say.
 * Those three are what let §10.1's "replacing the brand values is a one-file
 * change" stay true.
 */
describe('colour palette (§10.1)', () => {
  it('carries every colour the approved palette names, and no others', () => {
    // Exactly the §10.1 table. A missing token means a screen will reach for a
    // literal; an extra one means a value nobody approved has crept in.
    expect(Object.keys(colour).sort()).toEqual(
      [
        'navy900',
        'navy700',
        'navy500',
        'gold600',
        'gold500',
        'gold300',
        'paper50',
        'paper200',
        'line500',
        'ink700',
        'success',
        'warning',
        'danger',
        'info',
      ].sort(),
    );
  });

  it('holds every value as a full six-digit hex, so the gate can parse it', () => {
    for (const [name, value] of Object.entries(colour)) {
      expect(value, name).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('keeps the two values Phase 1 rejected out of the palette', () => {
    // White on gold (2.79:1) and gold-500 as a light-page focus ring (2.79:1)
    // were measured and rejected. Neither may return by the back door.
    expect(Object.values(colour)).not.toContain('#FFFFFF');
    expect(CONTRAST_REQUIREMENTS).not.toContainEqual(
      expect.objectContaining({ foreground: 'gold500', background: 'paper50' }),
    );
  });
});

describe('scales (§10.2, §10.3)', () => {
  it('uses the approved 4px spacing scale exactly', () => {
    expect([...space]).toEqual([4, 8, 12, 16, 24, 32, 48, 64]);
  });

  it('uses the approved 1.25-ratio type scale exactly', () => {
    expect([...typeScale]).toEqual([12, 14, 16, 20, 25, 31, 39]);
  });

  it('keeps every spacing step on the 4px grid', () => {
    for (const step of space) expect(step % 4, `${step} is off-scale`).toBe(0);
  });

  it('encodes radius by elevation rather than one global value', () => {
    expect(radius).toEqual({ rule: 0, control: 4, card: 8, overlay: 12 });
  });

  it('never allows body text below 16px', () => {
    // §10.2: never 14px for content. A candidate reading Arabic on a phone in
    // bright sunlight is the case this rule exists for.
    expect(typeLimits.bodyMinimumPx).toBe(16);
    expect(typeScale).toContain(typeLimits.bodyMinimumPx);
  });

  it('caps line length at 70 characters', () => {
    expect(typeLimits.measureCh).toBe(70);
  });

  it('sets 1.6 body and 1.2 display line height', () => {
    expect(lineHeight).toEqual({ body: 1.6, display: 1.2 });
  });
});

describe('typography (§10.2)', () => {
  it('names the approved superfamily for both scripts in one stack', () => {
    expect(fontFamily.ui).toContain('IBM Plex Sans');
    expect(fontFamily.ui).toContain('IBM Plex Sans Arabic');
  });

  it('uses naskh for display and leaves the Latin serif unnamed', () => {
    // §10.2 names Noto Naskh Arabic but only says "a transitional serif" for
    // Latin. Naming one here would be inventing a decision.
    expect(fontFamily.display).toContain('Noto Naskh Arabic');
    expect(fontFamily.display).toContain('serif');
  });

  it('ends every stack in a generic family, so it degrades rather than fails', () => {
    for (const [name, stack] of Object.entries(fontFamily)) {
      expect(stack, name).toMatch(/(?:sans-serif|serif|monospace)$/);
    }
  });
});

describe('surface and motion (§10.3, §10.4)', () => {
  it('specifies the focus ring as 2px with a 2px offset', () => {
    // §10.4: on every focusable element, and never removed.
    expect(focusRing).toEqual({ widthPx: 2, offsetPx: 2 });
  });

  it('keeps exactly one shadow', () => {
    // §10.3: "One shadow, used twice." A second would mean cards start floating.
    expect(Object.keys(shadow)).toEqual(['overlay']);
  });

  it('records the approved usage, which is the only settled part', () => {
    expect(shadow.overlay.usage).toContain('modals and dropdowns only');
    expect(shadow.overlay.usage).toContain('never cards');
  });

  it('leaves the geometry UNDECIDED rather than inventing one', () => {
    // §10.3 states no offset, blur, colour or alpha, and §10.3 lines 733-736
    // are the only mention of a shadow in the whole approved corpus. A token
    // file is exactly where an unapproved value would become canon, so this
    // test fails the build if a number appears here without a decision.
    expect(shadow.overlay.geometry).toBeNull();
  });

  it('uses the approved two motion durations', () => {
    expect(motionMs).toEqual({ local: 120, layout: 200 });
  });

  it('declares border widths for a control boundary and an error boundary', () => {
    expect(borderWidth).toEqual({ hairline: 1, emphasis: 2 });
  });
});

describe('the generated stylesheet is derived, not authored', () => {
  const css = renderCss();

  it('emits every palette colour as a custom property', () => {
    for (const [name, value] of Object.entries(colour)) {
      const cssName = name.replace(/([a-z]+)(\d+)$/, '$1-$2');
      expect(css, name).toContain(`--${cssName}: ${value.toLowerCase()};`);
    }
  });

  it('names spacing by its value, so a step cannot be misread', () => {
    // The hand-written block this replaced named --space-4 for 16px, which is
    // how a 4px token and a 16px token came to share a name.
    expect(css).toContain('--space-16: 1rem;');
    expect(css).toContain('--space-4: 0.25rem;');
  });

  it('emits the scales, radius, focus ring and motion', () => {
    expect(css).toContain('--text-25: 1.5625rem;');
    expect(css).toContain('--radius-card: 8px;');
    expect(css).toContain('--focus-ring-width: 2px;');
    expect(css).toContain('--motion-local: 120ms;');
  });

  it('emits no shadow property while its geometry is undecided', () => {
    // The absence is deliberate and documented in the output, so a reader does
    // not conclude the shadow was forgotten.
    expect(css).not.toContain('--shadow-overlay');
    expect(css).toContain('Geometry UNDECIDED');
  });

  it('warns against editing it by hand', () => {
    expect(css).toContain('DO NOT EDIT');
  });

  it('introduces no colour the token source does not hold', () => {
    const emitted = [...css.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
    const known = Object.values(colour).map((hex) => hex.toLowerCase());
    for (const hex of emitted) expect(known, hex).toContain(hex);
  });
});
