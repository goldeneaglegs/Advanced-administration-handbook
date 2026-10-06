import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/auth/password';
import { localePath } from './_lib/locale';

/**
 * The five remaining auth screens. Targeted UI checks only — the endpoints are
 * already covered by the 37-test API suite, so these assert accessibility, the
 * states each screen owns, and that success is never shown without a 2xx.
 */
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
const STRONG = 'correct-horse-battery-staple-42';
const DOMAIN = 'screens.test';

const unique = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;

/** Creates a user plus a usable token of the given purpose, returning the plaintext. */
async function seedToken(email: string, purpose: string, status: string): Promise<string> {
  const hash = await hashPassword(STRONG);
  const plaintext = `tok-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  await db.$executeRaw`
    INSERT INTO users (email, password_hash, status, password_changed_at)
    VALUES (${email}::citext, ${hash}, ${status}::user_status, now())`;
  await db.$executeRaw`
    INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at)
    SELECT id, ${purpose}::email_token_purpose, digest(${plaintext}, 'sha256'),
           now() + interval '1 day'
    FROM users WHERE email = ${email}::citext`;
  return plaintext;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.help}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test.beforeEach(async () => {
  // Approved per-IP budgets (register 10/h, forgot-password 5/h) are shared by
  // every test here, since all arrive from one address. State is reset; no
  // threshold is changed.
  await db.$executeRaw`DELETE FROM auth_attempts`;
});

test.afterAll(async () => {
  await db.$executeRaw`DELETE FROM auth_attempts`;
  await db.$disconnect();
});

test.describe('accessibility and structure', () => {
  for (const [path, heading] of [
    ['/register', 'Create your account'],
    ['/forgot-password', 'Reset your password'],
    ['/verify-email?token=placeholder-token-value', 'Confirm your email'],
    ['/reset-password?token=placeholder-token-value', 'Choose a new password'],
    ['/accept-invite?token=placeholder-token-value', 'Set your password'],
  ] as const) {
    test(`${path} has one h1 and no WCAG 2.2 A/AA violations`, async ({ page }) => {
      await page.goto(localePath(path));
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expectNoAxeViolations(page);
    });

    test(`${path} has no horizontal scroll`, async ({ page }) => {
      await page.goto(localePath(path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('register', () => {
  test('server field error is shown and associated with its input', async ({ page }) => {
    await page.goto(localePath('/register'));
    await page.getByLabel('Full name').fill('Screen Test');
    await page.getByLabel('Email address').fill(unique('weak'));
    await page.getByLabel('Password', { exact: true }).fill('passwordpassword'); // in the breached corpus
    await page.getByRole('button', { name: 'Create account' }).click();

    const field = page.getByLabel('Password', { exact: true });
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAttribute('aria-describedby', 'password-error');
    await expect(page.locator('#password-error')).toContainText(/data breach/i);
    // No success state on a rejected submit.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('accepted registration shows the server message and hides the form', async ({ page }) => {
    await page.goto(localePath('/register'));
    await page.getByLabel('Full name').fill('Screen Test');
    await page.getByLabel('Email address').fill(unique('ok'));
    await page.getByLabel('Password', { exact: true }).fill(STRONG);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('status')).toContainText(/check your email/i);
    await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  });
});

test.describe('forgot-password', () => {
  test('always reports acceptance, even for an unknown address', async ({ page }) => {
    await page.goto(localePath('/forgot-password'));
    await page.getByLabel('Email address').fill(unique('ghost'));
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText(/reset link is on its way/i);
  });
});

test.describe('verify-email', () => {
  test('a missing token is explained rather than silently failing', async ({ page }) => {
    await page.goto(localePath('/verify-email'));
    await expect(page.getByText(/missing its confirmation code/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /confirm my email/i })).toHaveCount(0);
  });

  test('a valid token confirms the address', async ({ page }) => {
    const email = unique('verify');
    const token = await seedToken(email, 'verify_email', 'invited');
    await page.goto(localePath(`/verify-email?token=${token}`));
    await page.getByRole('button', { name: 'Confirm my email' }).click();
    await expect(page.getByRole('status')).toContainText(/email is confirmed/i);

    const rows = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM users WHERE email = ${email}::citext`;
    expect(rows[0]!.status).toBe('active');
  });

  test('an invalid token shows the generic failure, not success', async ({ page }) => {
    await page.goto(localePath('/verify-email?token=not-a-real-token-value-at-all'));
    await page.getByRole('button', { name: 'Confirm my email' }).click();
    await expect(page.getByRole('status')).toContainText(/no longer valid/i);
    await expect(page.getByText(/email is confirmed/i)).toHaveCount(0);
  });
});

test.describe('reset-password', () => {
  test('mismatched confirmation is caught in the browser before any request', async ({ page }) => {
    await page.goto(localePath('/reset-password?token=placeholder-token-value'));
    await page.getByLabel('New password', { exact: true }).fill(STRONG);
    await page.getByLabel('Confirm new password', { exact: true }).fill('something-else-entirely');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.locator('#confirm_password-error')).toContainText(/must match/i);
  });

  test('a valid token sets the password', async ({ page }) => {
    const email = unique('reset');
    const token = await seedToken(email, 'reset_password', 'active');
    await page.goto(localePath(`/reset-password?token=${token}`));
    await page.getByLabel('New password', { exact: true }).fill('a-different-long-passphrase-77');
    await page
      .getByLabel('Confirm new password', { exact: true })
      .fill('a-different-long-passphrase-77');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('status')).toContainText(/password is set/i);
  });
});

test.describe('accept-invite', () => {
  test('a valid invitation sets the initial password and activates', async ({ page }) => {
    const email = unique('invite');
    const token = await seedToken(email, 'accept_invite', 'invited');
    await page.goto(localePath(`/accept-invite?token=${token}`));
    await page.getByLabel('Password', { exact: true }).fill(STRONG);
    await page.getByLabel('Confirm password', { exact: true }).fill(STRONG);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('status')).toContainText(/account is ready/i);

    const rows = await db.$queryRaw<Array<{ status: string }>>`
      SELECT status::text AS status FROM users WHERE email = ${email}::citext`;
    expect(rows[0]!.status).toBe('active');
  });
});
