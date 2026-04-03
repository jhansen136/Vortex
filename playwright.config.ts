import { defineConfig, devices } from '@playwright/test';

/**
 * VORTEX — Playwright E2E Config
 *
 * Base URL precedence:
 *   PLAYWRIGHT_BASE_URL env var  (e.g. https://dev.vortexintel.app)
 *   → http://localhost:3333 when running locally (served via npx serve)
 *
 * Authenticated tests need real test credentials:
 *   E2E_EMAIL    — test account email
 *   E2E_PASSWORD — test account password
 *
 * Run:
 *   npx playwright test                          # headless, all browsers (serves locally)
 *   npx playwright test --ui                     # interactive UI mode
 *   npx playwright test tests/e2e/landing.spec   # single file
 *   E2E_EMAIL=you@x.com E2E_PASSWORD=pw npx playwright test
 *
 *   # Against deployed dev site:
 *   PLAYWRIGHT_BASE_URL=https://dev.vortexintel.app npx playwright test
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Fail fast in CI, retry once locally
  retries: process.env.CI ? 2 : 1,
  // Single worker locally — avoids port contention and race conditions
  // against the local static server. CI can use 1 too for determinism.
  workers: 1,

  // Reporters
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  // Local dev server — only started when PLAYWRIGHT_BASE_URL is not set
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npx serve . -l 3333 --no-clipboard',
    url:     'http://localhost:3333',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },

  use: {
    baseURL:       process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3333',
    screenshot:    'only-on-failure',
    video:         'retain-on-failure',
    trace:         'retain-on-failure',
    // Most interactions should complete well under 10s
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use:  { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use:  { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use:  { ...devices['Desktop Safari'] },
    },
    // Mobile viewport — critical for a PWA
    {
      name: 'Mobile Chrome',
      use:  { ...devices['Pixel 7'] },
    },
    {
      name: 'Mobile Safari',
      use:  { ...devices['iPhone 14'] },
    },
  ],
});
