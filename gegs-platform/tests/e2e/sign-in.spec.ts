import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/auth/password';

/**
 * Login screen. Targeted checks only: the backend is already covered by the
 * 37-test API suite, so these assert the SCREEN — accessibility, the four
 * states, and keyboard operation.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });

// secret-scan-allow: throwaway fixture password for a user this spec creates and discards.
const PASSWORD = 'correct-horse-battery-staple-42';
const EMAIL = `signin-${Date.now()}@signin.test`;

test.beforeAll(async () => {
  // An active, verified user created directly: this spec tests the screen, not
  // the registration flow.
  const hash = await hashPassword(PASSWORD);
  await db.$executeRaw`
    INSERT INTO users (email, password_hash, status, email_verified_at, password_changed_at)
    VALUES (${EMAIL}::citext, ${hash}, 'active', now(), now())`;
});

test.beforeEach(async () => {
  // The approved per-IP login limits are 10/minute and 30 failures/15 minutes.
  // Every test here arrives from one address, so state is reset between them.
  // No threshold is changed; throttling is covered in the integration suite.
  await db.$executeRaw`DELETE FROM auth_attempts`;
});

test.afterAll(async () => {
  await db.$executeRaw`DELETE FROM auth_attempts`;
  await db.$disconnect();
});

test('renders with no detectable WCAG 2.2 A/AA violations', async ({ page }) => {
  await page.goto('/sign-in');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
  expect(summary, summary.join('\n')).toEqual([]);
});

test('fields are properly labelled and reachable by keyboard', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

  // Labels resolve by accessible name, which is what a screen reader announces.
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  await page.keyboard.press('Tab'); // skip link
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email address')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeFocused();
});

test('empty submit reports per-field errors and focuses the first one', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText('Enter your email address.')).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeFocused();
  await expect(page.getByLabel('Email address')).toHaveAttribute('aria-invalid', 'true');
  // The error is associated with the input, not merely nearby.
  await expect(page.getByLabel('Email address')).toHaveAttribute('aria-describedby', 'email-error');
});

test('wrong password shows the generic failure and no success state', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(EMAIL);
  await page.getByLabel('Password').fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  const alert = page.getByRole('status');
  await expect(alert).toContainText('Email or password is incorrect.');
  // Phase 2 rule 7: never show success the server did not give.
  await expect(page.getByText('Signed in.')).toHaveCount(0);
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('correct credentials sign in and navigate away', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  // Submit with Enter, proving the form works without a pointer.
  await page.getByLabel('Password').press('Enter');

  await expect(page).toHaveURL(/\/$/);
  // The session cookie is HttpOnly, so its presence is checked via the API.
  const me = await page.request.get('/api/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).data.email).toBe(EMAIL);
});

test('no horizontal scroll at this breakpoint', async ({ page }) => {
  await page.goto('/sign-in');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
