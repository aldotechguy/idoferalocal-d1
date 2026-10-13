import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * baseURL is required to come from an environment variable (E2E_BASE_URL). Every
 * test additionally asserts — via the assertPreviewHost fixture in
 * e2e/fixtures.ts — that the target host is NOT the deployed production worker
 * (idomall.olz.workers.dev) before any action runs. This is a second guard on
 * top of the config: even a misconfigured baseURL cannot drive a browser into
 * production, because each test refuses to run against a forbidden host.
 */
const FORBIDDEN_HOSTS = ['idomall.olz.workers.dev'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer: E2E runs against an already-running PREVIEW host. The baseURL
  // is supplied by CI or the operator. `npm run test:e2e` fails loudly when it is
  // unset rather than silently defaulting to a local or production host.
  globalSetup: './e2e/global-setup.ts',
});

// Re-exported so the guard is visible to anyone reading the config.
export { FORBIDDEN_HOSTS };
