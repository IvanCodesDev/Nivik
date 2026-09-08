import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

/**
 * Browser smoke tests for the canvas (spec 08 §3 task 1.9). The web app runs against no Agent
 * Runtime on purpose: the canvas falls back to the in-page mock agent, so the suite needs nothing
 * but Next.js and a browser.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'en-US',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // `PW_CHANNEL=msedge` (or `chrome`) runs on an installed browser instead of the downloaded one.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: 'pnpm --filter @nivik/web dev',
    url: `http://localhost:${PORT}/library`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      NEXT_PUBLIC_NIVIK_E2E: '1',
      // An address nothing listens on: every run takes the local-agent path.
      NEXT_PUBLIC_NIVIK_AGENT_URL: 'http://127.0.0.1:1',
    },
  },
});
