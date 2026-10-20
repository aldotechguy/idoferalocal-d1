/**
 * Remote Rust money engine client.
 *
 * The Mall runs on a Cloudflare Worker, which cannot load the native addon. When
 * a remote engine is configured and reachable, this module answers money
 * questions from the Rust service instead of the TypeScript implementation.
 *
 * Design rules:
 *  - Availability is decided by configuration alone (`MONEY_ENGINE_URL`), never
 *    by a probe. The Worker's fetch handler must stay synchronous up to the
 *    point of use, so every call here is `await`ed by the bridge.
 *  - Every failure (network, timeout, non-200, `ok:false`, malformed body) is
 *    turned into `null` so the caller falls back to the tested TypeScript path.
 *    A money endpoint must never throw because an auxiliary service is down.
 *  - Money crosses the wire as integer kobo (`i64` in Rust), never as naira
 *    floats, so no rounding can happen in transit.
 */

export type RemoteEngineConfig = {
  /** Public https origin of a self-hosted engine. Empty when using a container. */
  url: string;
  token?: string;
  /** Milliseconds before a call is abandoned and the TS fallback takes over. */
  timeoutMs?: number;
  /**
   * Container mode. When present, requests go to the container through this
   * Durable Object binding instead of the public URL — no ingress, no token.
   */
  container?: ContainerBinding;
};

/**
 * The slice of the @cloudflare/containers binding this module needs. Typed
 * structurally so the shared bridge never imports Worker-only globals.
 */
export type ContainerBinding = {
  getByName(name: string): { fetch(input: Request): Promise<Response> };
};

/** A single named instance: the engine is stateless, so one is enough. */
const CONTAINER_INSTANCE = 'money-engine';

export type RemoteOrderTransition = {
  allowed: boolean;
  isIdempotent: boolean;
  errorMessage?: string | null;
};

export type RemoteSqlStmt = { sql: string; params: unknown[] };

const DEFAULT_TIMEOUT_MS = 800;

/** Trim, drop the trailing slash, and reject anything that is not http(s). */
export function normalizeEngineUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Read config from a Worker `env` object; returns null when unconfigured. */
export function remoteEngineConfigFrom(env: Record<string, unknown> | undefined | null): RemoteEngineConfig | null {
  if (!env) return null;
  const timeout = Number(env.MONEY_ENGINE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 5_000) : DEFAULT_TIMEOUT_MS;
  const container = env.MONEY_ENGINE_CONTAINER as ContainerBinding | undefined;
  if (container && typeof container.getByName === 'function') {
    return { url: '', container, timeoutMs };
  }
  const url = normalizeEngineUrl(typeof env.MONEY_ENGINE_URL === 'string' ? env.MONEY_ENGINE_URL : null);
  if (!url) return null;
  const token = typeof env.MONEY_ENGINE_TOKEN === 'string' && env.MONEY_ENGINE_TOKEN ? env.MONEY_ENGINE_TOKEN : undefined;
  return { url, token, timeoutMs };
}

export const isRemoteEngineConfigured = (config: RemoteEngineConfig | null | undefined): boolean =>
  Boolean(config && (config.container || normalizeEngineUrl(config.url)));

type CallResult = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * Send one request to whichever transport the config names: the container
 * binding (production) or a public https origin (self-hosted). Returns null on
 * any failure so the caller can fall back to TypeScript.
 */
async function send(
  config: RemoteEngineConfig,
  method: 'GET' | 'POST',
  route: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<CallResult | null> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response: Response;
  if (config.container) {
    // Container requests go through the Durable Object; the URL host is only
    // used for routing inside the container runtime.
    const instance = config.container.getByName(CONTAINER_INSTANCE);
    response = await instance.fetch(new Request(`http://money-engine${route}`, init));
  } else {
    const base = normalizeEngineUrl(config.url);
    if (!base) return null;
    response = await fetchImpl(`${base}${route}`, init);
  }
  if (!response.ok) return null;
  const payload = (await response.json()) as CallResult;
  return payload && payload.ok === true ? payload : null;
}

/** POST a JSON body; resolves to the parsed `result` or null on any failure. */
export async function callRemoteEngine(
  config: RemoteEngineConfig,
  route: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown | null> {
  if (!isRemoteEngineConfigured(config)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const payload = await send(config, 'POST', route, body, fetchImpl);
    return payload?.ok === true ? payload.result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function remoteValidateOrderTransition(
  config: RemoteEngineConfig,
  from: string,
  to: string,
  fetchImpl?: typeof fetch,
): Promise<RemoteOrderTransition | null> {
  const result = await callRemoteEngine(config, '/orders/transition', { from, to }, fetchImpl) as Partial<RemoteOrderTransition> | null;
  if (!result || typeof result.allowed !== 'boolean') return null;
  return {
    allowed: result.allowed,
    isIdempotent: result.isIdempotent === true,
    errorMessage: typeof result.errorMessage === 'string' ? result.errorMessage : null,
  };
}

export async function remoteCalculateAmountDueKobo(
  config: RemoteEngineConfig,
  totalKobo: number,
  paidKobo: number,
  status: string,
  fetchImpl?: typeof fetch,
): Promise<number | null> {
  const result = await callRemoteEngine(config, '/orders/amount-due', { totalKobo, paidKobo, status }, fetchImpl) as { amountDueKobo?: unknown } | null;
  const due = result?.amountDueKobo;
  return typeof due === 'number' && Number.isSafeInteger(due) && due >= 0 ? due : null;
}

export async function remoteVerifyOrderTotals(
  config: RemoteEngineConfig,
  subtotalKobo: number,
  discountKobo: number,
  deliveryFeeKobo: number,
  totalKobo: number,
  fetchImpl?: typeof fetch,
): Promise<boolean | null> {
  const result = await callRemoteEngine(
    config,
    '/orders/verify-totals',
    { subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo },
    fetchImpl,
  ) as { valid?: unknown } | null;
  return typeof result?.valid === 'boolean' ? result.valid : null;
}

export async function remotePlanCoreUpsert(
  config: RemoteEngineConfig,
  collection: string,
  document: unknown,
  now: string,
  fetchImpl?: typeof fetch,
): Promise<RemoteSqlStmt[] | null | undefined> {
  const result = await callRemoteEngine(config, '/relational/plan-upsert', { collection, document, now }, fetchImpl) as { statements?: unknown } | null;
  if (!result) return undefined;
  return normalizeStatements(result.statements);
}

export async function remotePlanCoreDelete(
  config: RemoteEngineConfig,
  collection: string,
  documentId: string,
  fetchImpl?: typeof fetch,
): Promise<RemoteSqlStmt[] | null | undefined> {
  const result = await callRemoteEngine(config, '/relational/plan-delete', { collection, documentId }, fetchImpl) as { statements?: unknown } | null;
  if (!result) return undefined;
  return normalizeStatements(result.statements);
}

/**
 * `undefined` distinguishes "the service could not answer" from the meaningful
 * `null` ("this collection is not supported"), which the relational planner
 * relies on to stay in sync with the Rust implementation.
 */
function normalizeStatements(raw: unknown): RemoteSqlStmt[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  const statements: RemoteSqlStmt[] = [];
  for (const entry of raw) {
    const sql = (entry as { sql?: unknown })?.sql;
    const params = (entry as { params?: unknown })?.params;
    if (typeof sql !== 'string' || !Array.isArray(params)) return undefined;
    statements.push({ sql, params });
  }
  return statements;
}

export type EngineIdentity = { engine: string; version: string; runtime: string };

/**
 * GET /health, used by the Worker's own /api/money-engine/health endpoint to
 * prove which implementation answered. Returns null when unreachable.
 */
export async function probeRemoteEngine(
  config: RemoteEngineConfig | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<EngineIdentity | null> {
  if (!isRemoteEngineConfigured(config)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const payload = await send(config!, 'GET', '/health', undefined, fetchImpl);
    const identity = (payload?.ok === true ? payload.result : null) as Partial<EngineIdentity> | null;
    if (!identity || typeof identity.engine !== 'string' || typeof identity.version !== 'string') return null;
    return { engine: identity.engine, version: identity.version, runtime: String(identity.runtime ?? 'rust') };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
