import { defineConfig, devices } from '@playwright/test';

/**
 * AURAMAXING Playwright Config
 *
 * Rules:
 * - ONE browser window, always headed (visible)
 * - New tabs for each test/task — never new windows
 * - Tabs stay open after tests — user closes manually
 * - Single worker — keeps one browser instance
 * - Connects to persistent browser server if running (see scripts/browser-server.mjs)
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    headless: false,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Connect to persistent browser if endpoint exists
    ...(process.env.PW_ENDPOINT ? { connectOptions: { wsEndpoint: process.env.PW_ENDPOINT } } : {}),
    launchOptions: {
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // CI-only: cross-browser
    ...(process.env.CI ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ] : []),
  ],
});
