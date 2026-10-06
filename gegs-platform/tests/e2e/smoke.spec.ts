import { expect, test } from '@playwright/test';

/**
 * Milestone 0 browser checks. These assert the architectural invariants that
 * must hold from the first commit — the crawler boundary (Phase 1 §1.2), the
 * security headers, keyboard focus, and no horizontal scroll at any breakpoint
 * (Phase 1 §11).
 *
 * Journey tests arrive with the journeys, from Milestone 5.
 */
test.describe('milestone 0 smoke', () => {
  test('landing page renders and declares itself unindexable', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toContain('noindex');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('sets the approved security headers', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['permissions-policy']).toContain('camera=()');
    expect(headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    // Phase 1 §1.2: the app must not advertise its stack.
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('robots.txt disallows everything', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);
    const body = await response!.text();
    expect(body).toMatch(/Disallow:\s*\//);
  });

  test('health endpoint reports per-check detail and leaks nothing', async ({ request }) => {
    const response = await request.get('/api/health');
    // 200 when every dependency is up, 503 when one is down. Both are correct
    // behaviour; reporting "healthy" regardless would not be.
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(body.data.checks).toHaveProperty('database');
    expect(body.data.checks).toHaveProperty('storage');
    expect(body.data.checks).toHaveProperty('migrations_pending');
    expect(body.meta.request_id).toMatch(/^[0-9a-f-]{36}$/);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/postgres(ql)?:\/\//);
    expect(serialised).not.toContain('password');
  });

  test('unknown route returns 404 without leaking internals', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    const body = await page.content();
    expect(body).not.toContain('/home/');
    expect(body).not.toContain('node_modules');
  });

  test('skip link is the first keyboard stop and becomes visible on focus', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to content/i });
    await expect(skip).toBeFocused();
    // Phase 1 §13: the skip link must be visible once focused, not merely present.
    await expect(skip).toBeInViewport();
  });

  test('no horizontal page scroll at this breakpoint', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('every focusable element shows a visible focus ring', async ({ page }) => {
    await page.goto('/');
    const focusables = await page.locator('a[href], button, input, select, textarea').all();
    expect(focusables.length).toBeGreaterThan(0);
    for (const element of focusables) {
      await element.focus();
      const outlineWidth = await element.evaluate(
        (node) => getComputedStyle(node as Element).outlineWidth,
      );
      expect(parseFloat(outlineWidth)).toBeGreaterThan(0);
    }
  });
});
