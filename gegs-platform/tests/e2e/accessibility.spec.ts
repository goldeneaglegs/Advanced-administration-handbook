import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { localePath } from './_lib/locale';

/**
 * Accessibility gate (Phase 1 §13, §14.1). axe-core runs on every page and
 * fails the build on a violation.
 *
 * Automation catches roughly half of what matters, so Phase 1 also requires a
 * manual keyboard pass and a screen-reader pass each milestone. This file is
 * the automated half and is not a substitute for the other.
 */
const PAGES = ['/'];

for (const path of PAGES) {
  test(`${path} has no detectable WCAG 2.2 A/AA violations`, async ({ page }) => {
    await page.goto(localePath(path));
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();

    // Name the violations in the failure message rather than just a count, so
    // CI output is actionable without downloading an artifact.
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

test('page exposes one h1 and a main landmark', async ({ page }) => {
  await page.goto(localePath('/'));
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
});

test('html carries explicit lang and dir per locale', async ({ page }) => {
  // Phase 1 §12: dir is set server-side so there is no flash of wrong direction.
  await page.goto('/en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  await page.goto('/ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});

test('remains usable at 200% zoom with no horizontal scroll', async ({ page }) => {
  // Phase 1 §13: reflow at 200% zoom. Emulated by halving the viewport width,
  // which is the standard equivalent.
  await page.setViewportSize({ width: 640, height: 512 });
  await page.goto(localePath('/'));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
