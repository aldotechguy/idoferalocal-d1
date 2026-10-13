import { test as base, expect } from '@playwright/test';

/**
 * The deployed production worker. Playwright E2E must NEVER run against this
 * host — it is a real storefront with live money-bearing flows. Every test uses
 * the `guardPreviewHost` fixture which asserts the host is not production before
 * any action runs.
 */
const FORBIDDEN_HOSTS = ['idomall.olz.workers.dev'];

export function assertNotProductionHost(baseUrl: string | undefined): void {
  if (!baseUrl) {
    throw new Error('E2E_BASE_URL is not set; refusing to run against an unknown host.');
  }
  const host = new URL(baseUrl).hostname.toLowerCase();
  for (const forbidden of FORBIDDEN_HOSTS) {
    if (host === forbidden || host.endsWith(`.${forbidden}`)) {
      throw new Error(
        `baseURL "${baseUrl}" targets production (${forbidden}). Playwright E2E must never run against production.`
      );
    }
  }
}

/**
 * Fixture applied to every test. It reads the resolved baseURL from the
 * configured `use.baseURL` and asserts it is a PREVIEW host before the test
 * body runs. This is a per-test second guard that survives a broken env var at
 * launch time.
 */
export interface GuardFixtures {
  guardPreviewHost: void;
}

export const test = base.extend<GuardFixtures>({
  guardPreviewHost: [async ({ baseURL }, use) => {
    assertNotProductionHost(baseURL);
    await use();
  }, { auto: true }],
});

export { expect, FORBIDDEN_HOSTS };
