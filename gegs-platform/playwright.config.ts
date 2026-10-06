import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';

// Phase 1 §11: 360px is the floor and is tested. Breakpoints are named for what
// changes, not for devices.
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
    // API tests are protocol-level and breakpoint-independent, so they run once
    // in their own project rather than four times across viewports.
    { name: 'api', testMatch: /.*\.api\.spec\.ts/ },
    {
      name: 'base-360',
      testIgnore: /.*\.api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } },
    },
    {
      name: 'md-768',
      testIgnore: /.*\.api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'lg-1024',
      testIgnore: /.*\.api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'xl-1440',
      testIgnore: /.*\.api\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
