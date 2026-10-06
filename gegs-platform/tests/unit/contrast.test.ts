import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/contrast';
import { CONTRAST_REQUIREMENTS, colour } from '@/design/tokens';

describe('palette contrast (WCAG 2.2)', () => {
  it('has requirements to check, so the gate cannot pass vacuously', () => {
    expect(CONTRAST_REQUIREMENTS.length).toBeGreaterThan(10);
  });

  it.each(CONTRAST_REQUIREMENTS)(
    '$usage: $foreground on $background meets $minimum:1',
    ({ foreground, background, minimum }) => {
      expect(contrastRatio(colour[foreground], colour[background])).toBeGreaterThanOrEqual(minimum);
    },
  );

  it('reproduces the reference ratios from the WCAG definition', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is symmetric in its arguments', () => {
    expect(contrastRatio(colour.navy900, colour.paper50)).toBeCloseTo(
      contrastRatio(colour.paper50, colour.navy900),
      10,
    );
  });

  it('still rejects the two values Phase 1 rejected', () => {
    // White on gold-500 failed the 4.5 body-text minimum at 2.79:1.
    expect(contrastRatio(colour.paper50, colour.gold500)).toBeLessThan(4.5);
    // Gold-500 as a focus ring on a light page failed SC 1.4.11 at 2.79:1.
    expect(contrastRatio(colour.gold500, colour.paper50)).toBeLessThan(3);
    // The replacements pass, which is the point of recording the failures.
    expect(contrastRatio(colour.navy900, colour.gold500)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colour.gold600, colour.paper50)).toBeGreaterThanOrEqual(3);
  });

  it('rejects a malformed hex value rather than scoring it', () => {
    expect(() => contrastRatio('#GGG', '#FFFFFF')).toThrow();
  });
});
