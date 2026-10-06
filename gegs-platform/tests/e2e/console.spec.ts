import { expect, test } from '@playwright/test';

/**
 * Console and network review (Phase 1 §14.4 gate).
 *
 * A clean console is not cosmetic: a React hydration warning or a 404 on an
 * asset is usually the visible end of a real defect, and letting those
 * accumulate means the signal is gone when it matters.
 */
test('loads with no console errors and no failed requests', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failed: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    failed.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(failed, failed.join('\n')).toEqual([]);
});
