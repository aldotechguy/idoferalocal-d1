/**
 * Global setup: verifies the E2E baseURL is a valid PREVIEW host before ANY test
 * or browser is launched. Refuses to run if the variable is unset or if the host
 * is the deployed production worker.
 */
const FORBIDDEN_HOSTS = ['idomall.olz.workers.dev'];

function assertPreviewHost(): string {
  const base = process.env.E2E_BASE_URL;
  if (!base) {
    throw new Error(
      'E2E_BASE_URL is not set. Playwright E2E must run against a PREVIEW host only. ' +
        'Set E2E_BASE_URL to the disposable preview origin (e.g. https://my-preview.example.com). ' +
        'No host was contacted.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    throw new Error(`E2E_BASE_URL "${base}" is not a valid URL. No host was contacted.`);
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`E2E_BASE_URL must be HTTPS (got "${parsed.protocol}"). No host was contacted.`);
  }

  const host = parsed.hostname.toLowerCase();
  for (const forbidden of FORBIDDEN_HOSTS) {
    if (host === forbidden || host.endsWith(`.${forbidden}`)) {
      throw new Error(
        `E2E_BASE_URL "${base}" targets the deployed production worker (${forbidden}). ` +
          'Playwright E2E must never run against production. Refusing to start.'
      );
    }
  }

  console.log(`[e2e global-setup] Using PREVIEW host: ${parsed.origin}`);
  return parsed.origin;
}

export default async function globalSetup(): Promise<void> {
  assertPreviewHost();
}
