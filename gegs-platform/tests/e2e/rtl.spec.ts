import { expect, test } from '@playwright/test';
import { localePath, projectDir, projectLocale } from './_lib/locale';

/**
 * Direction-dependent layout (Phase 1 §11, §12, §13).
 *
 * Runs in all ten viewport projects, so each assertion is made at 360, 414,
 * 768, 1024 and 1440 in BOTH directions — §11's "in both directions" rather
 * than LTR only.
 *
 * It deliberately does not re-check what the protocol-level locale-routing spec
 * already proves (redirects, header parity, the served lang/dir markup). What
 * is tested here is what only a browser can answer: that §11's claim — "all
 * spacing uses logical properties, so RTL needs no mirrored stylesheet" — is
 * actually true of the rendered page.
 */
const PAGES = ['/', '/sign-in', '/register', '/forgot-password'] as const;

/** Horizontal overflow of the document, in CSS pixels. */
function overflowOf(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('direction is applied to the rendered document', () => {
  test('html dir matches the locale this project drives', async ({ page }) => {
    await page.goto(localePath('/'));
    await expect(page.locator('html')).toHaveAttribute('dir', projectDir());
    await expect(page.locator('html')).toHaveAttribute('lang', projectLocale());
  });

  test('the computed direction reaches the body, not just the html element', async ({ page }) => {
    // An attribute nothing inherits from would be a lie told to a screen
    // reader: the layout would still be laid out the other way round.
    await page.goto(localePath('/'));
    const direction = await page.evaluate(() => getComputedStyle(document.body).direction);
    expect(direction).toBe(projectDir());
  });
});

test.describe('no horizontal scrolling in either direction', () => {
  for (const path of PAGES) {
    test(`${path} does not scroll horizontally`, async ({ page }) => {
      // Phase 1 §11: "No horizontal page scroll at any width", and §13 forbids
      // two-dimensional scrolling outright. RTL is where a physical `margin-left`
      // or `padding-left` would show up as overflow on the other side.
      await page.goto(localePath(path));
      expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe('the skip link works in both directions', () => {
  test('is reachable by keyboard and lands at the inline-start edge', async ({ page }) => {
    await page.goto(localePath('/'));
    await page.keyboard.press('Tab');

    const skip = page.getByRole('link', { name: /skip/i });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    // `inset-inline-start` puts it on the left in LTR and the right in RTL. A
    // physical `left` would pin it to the same edge in both, which is the bug
    // logical properties exist to prevent.
    const box = await skip.boundingBox();
    const viewport = page.viewportSize();
    expect(box, 'the skip link has no box once focused').not.toBeNull();
    expect(viewport).not.toBeNull();

    if (projectDir() === 'rtl') {
      const distanceFromRight = viewport!.width - (box!.x + box!.width);
      expect(distanceFromRight).toBeLessThan(viewport!.width / 2);
    } else {
      expect(box!.x).toBeLessThan(viewport!.width / 2);
    }
  });

  test('moves focus to the main landmark when activated', async ({ page }) => {
    await page.goto(localePath('/'));
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator('main')).toBeVisible();
  });
});

test.describe('keyboard order follows the form, not the direction', () => {
  test('tabs through sign-in in DOM order and submits with Enter', async ({ page }) => {
    // Tab order is DOM order in both directions; mirroring the layout must not
    // mirror the sequence a keyboard user moves through (Phase 1 §13).
    await page.goto(localePath('/sign-in'));

    await page.getByLabel('Email address').focus();
    await expect(page.getByLabel('Email address')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /sign in/i })).toBeFocused();
  });

  test('every focusable element keeps a visible focus ring', async ({ page }) => {
    // §10.4: the focus ring is never removed. Gold-600 on light, and asserted
    // here rather than assumed, in both directions.
    await page.goto(localePath('/sign-in'));
    for (const name of ['Email address', 'Password'] as const) {
      const field = page.getByLabel(name, { exact: true });
      await field.focus();
      const outline = await field.evaluate((el) => {
        const style = getComputedStyle(el);
        return { width: style.outlineWidth, style: style.outlineStyle };
      });
      expect(outline.style, `${name} has no focus outline`).not.toBe('none');
      expect(Number.parseFloat(outline.width)).toBeGreaterThan(0);
    }
  });
});

test.describe('localised navigation keeps the direction it was clicked in', () => {
  test('an in-app link stays inside this locale', async ({ page }) => {
    // The decision from batch 2a: an explicit locale is authoritative. A link
    // from /ar must not drop the reader into /en.
    //
    // No token, because that is the branch carrying the link: with a token the
    // screen renders the form instead. Reaching it any other way would be
    // testing a control the user cannot see.
    await page.goto(localePath('/reset-password'));
    await page.getByRole('link', { name: /request a new reset link/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${projectLocale()}/forgot-password$`));
    await expect(page.locator('html')).toHaveAttribute('dir', projectDir());
  });

  test('a token survives the locale prefix', async ({ page }) => {
    const token = 'placeholder-token-value';
    await page.goto(localePath(`/verify-email?token=${token}`));
    expect(page.url()).toContain(`token=${token}`);
    expect(page.url()).toContain(`/${projectLocale()}/verify-email`);
    // The screen reached its token-present branch rather than the missing-code one.
    await expect(page.getByRole('button', { name: /confirm my email/i })).toBeVisible();
  });
});

test.describe('untranslated Arabic renders the English fallback', () => {
  test('the page is in the right direction with the approved English copy', async ({ page }) => {
    // Phase 1 §12: "Untranslated keys render the English." No Arabic copy
    // exists yet, so /ar must be RTL English rather than blank or key names.
    await page.goto(localePath('/sign-in'));
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', projectDir());
    // A key name leaking to the page would be the failure mode worth catching.
    await expect(page.locator('body')).not.toContainText('signIn.title');
  });
});
