import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

// Phase 1 §11: 360px is the floor and is tested. Breakpoints are named for what
// changes, not for devices.
/**
 * The §11 breakpoint matrix: "Tested at 360 / 414 / 768 / 1024 / 1440, in both
 * directions."
 *
 * Generated rather than written out ten times, so a width cannot be added in
 * one direction and forgotten in the other. Each project carries its locale in
 * `metadata`, which is how a spec knows whether to drive `/en/...` or
 * `/ar/...` — see tests/e2e/_lib/locale.ts.
 *
 * 414 was the missing width: the four original projects covered 360, 768, 1024
 * and 1440 in LTR only, which is half of what §11 requires.
 */
const WIDTHS = [
  { name: 'base', width: 360, height: 740 },
  { name: 'sm', width: 414, height: 896 },
  { name: 'md', width: 768, height: 1024 },
  { name: 'lg', width: 1024, height: 768 },
  { name: 'xl', width: 1440, height: 900 },
] as const;

/** `ar` renders right-to-left; its copy is the approved English fallback (§12). */
const E2E_LOCALES = ['en', 'ar'] as const;

const VIEWPORT_PROJECTS = E2E_LOCALES.flatMap((locale) =>
  WIDTHS.map((breakpoint) => ({
    name: `${breakpoint.name}-${breakpoint.width}-${locale}`,
    testIgnore: /.*\.api\.spec\.ts/,
    metadata: { locale },
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width: breakpoint.width, height: breakpoint.height },
    },
  })),
);

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // An explicit binary path is only set when the environment supplies one;
    // otherwise Playwright resolves its own (honouring PLAYWRIGHT_BROWSERS_PATH).
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    // API tests are protocol-level and breakpoint-independent, so they run ONCE
    // in their own project rather than repeating across the viewport matrix.
    // The locale-routing spec lives here: redirects, header parity and the
    // server-rendered lang/dir are proven at the protocol level and must not be
    // re-run ten times.
    { name: 'api', testMatch: /.*\.api\.spec\.ts/ },
    ...VIEWPORT_PROJECTS,
  ],
});
