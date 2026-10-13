/**
 * Read-only production reconciliation monitor (docs/test-setup-runbook.md Step 9).
 *
 * WHAT THIS IS
 *   A drift detector that runs a fixed battery of READ-ONLY SELECTs against the
 *   LIVE production D1 (name `idofera`) and prints a pass/fail table:
 *     M  money      SUM(non-historical sales.total_kobo) vs SUM(Sale Inflow)
 *                   - SUM(Sale Refund), reconciled against outstanding
 *                   receivable so legitimately-unpaid credit sales do not cry.
 *     S  stock      per-product stock_qty vs opening + SUM(signed stock_movements)
 *     L  liquid     per-account liquid balance vs SUM(signed money_movements)
 *     X  expense    non-historical expense with no matching Expense Outflow
 *     O  orders     mall order stuck in a non-terminal state past its SLA
 *     D  drain      freshness of the 'maintenance' job marker (outbox drain)
 *     W  sweep      freshness of the 'sweep' job marker (expiry/cleanup)
 *
 * IT NEVER WRITES TO D1.
 *   Two independent guarantees:
 *     1. token scope — supply a Cloudflare API token with *D1 Read* only
 *        (docs/test-setup-runbook.md §9). A read-scoped token cannot mutate even
 *        if it wanted to.
 *     2. statement guard — readSelect() refuses to send anything that is not a
 *        single SELECT (see assertSelectOnly). The production database id is
 *        used ONLY as a read target, and guardTarget() refuses the preview id.
 *
 *   The only non-SELECT side effect is OPTIONAL: on failure it POSTs a signed
 *   reconciliation alert to MALL_WEBHOOK_URL, reusing signMallWebhook() and the
 *   exact headers the Worker's own outbox drain uses, so the operator gets the
 *   same email path — never a bespoke notifier. --dry-run suppresses the POST.
 *
 * SCHEDULING (pick one):
 *   * Cloudflare cron: a scheduled handler in sites-worker.ts can call the
 *     read body (do NOT share the write batcher); wrangler.toml [env.mall.triggers]
 *     already runs every 10 minutes, so hook the read batch to that cron.
 *   * GitHub Action: .github/workflows/prod-reconciliation.yml runs this script
 *     on a cron with the read-only CF token and secrets; it fails the run (and
 *     the script POSTs the alert) on any drift.
 *
 * Usage:
 *   # safe rehearsal — reads production, prints the table, no POST:
 *   $env:CF_API_TOKEN='<read-only d1 token>'
 *   npm run verify:prod-reconciliation -- --dry-run
 *   # live: alert + non-zero exit on drift:
 *   $env:CF_API_TOKEN='<token>'; $env:MALL_WEBHOOK_URL='...'; $env:MALL_WEBHOOK_SECRET='...'
 *   npm run verify:prod-reconciliation
 */
import { signMallWebhook } from '../src/server/mallOperations.ts';
import { accessDenied } from './access-probe.ts';

// ---------------------------------------------------------------------------
// Immutable target + tuning (env-overridable where it is safe to)
// ---------------------------------------------------------------------------

// The LIVE production database (wrangler.toml [env.mall] d1_databases). Used
// ONLY as a read target. The disposable preview database is hard-denied so a
// misconfigured run can never read the wrong store.
const PROD_D1_ID = '3a3eb157-5aa5-419a-a8ce-2eade2afc436';
const PREVIEW_D1_ID = '647becf9-e665-4a85-9fa5-dbb5dedbcefa';
const DEFAULT_ACCOUNT_ID = '35b307711376954341708cbea8080dcc';

// Freshness windows are coupled to the wrangler cron cadence (10-min drain,
// hourly sweep) exactly as mallReadiness() computes them. Widen BOTH together.
const DRAIN_FRESH_DEFAULT_MS = 30 * 60_000; // 3 missed 10-min runs
const SWEEP_FRESH_DEFAULT_MS = 2 * 3600_000; // 2 missed hourly runs

// Mall order SLA: an unpaid order expires at MALL_UNPAID_EXPIRY_HOURS (48); any
// order still non-terminal past this window is "stuck" and worth a look.
const STALE_ORDER_DEFAULT_HOURS = 48;

// Money tolerance (kobo). 0 by default: the identity is exact. A benign-but-real
// future term (store credit / rounding) can be expressed here without hiding a
// genuine kobo-sized drift.
const MONEY_TOLERANCE_DEFAULT_KOBO = 0;

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== '') return value.trim();
  }
  return undefined;
}

interface Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
  webhookUrl?: string;
  webhookSecret?: string;
  dryRun: boolean;
  json: boolean;
  drainFreshMs: number;
  sweepFreshMs: number;
  staleOrderMs: number;
  moneyToleranceKobo: number;
}

function parseFlags(): Config {
  const databaseId = firstEnv('RECON_D1_DATABASE_ID') ?? PROD_D1_ID;
  guardTarget(databaseId);
  const apiToken = firstEnv('CF_API_TOKEN', 'RECON_CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN');
  if (!apiToken) {
    throw new Error(
      'A read-only Cloudflare API token is required (CF_API_TOKEN / RECON_CF_API_TOKEN). ' +
      'Provision one with the "D1 → Read" permission only (docs/test-setup-runbook.md §9).',
    );
  }
  const moneyToleranceRaw = process.env.RECON_MONEY_TOLERANCE_KOBO;
  return {
    accountId: firstEnv('RECON_CF_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID') ?? DEFAULT_ACCOUNT_ID,
    databaseId,
    apiToken,
    webhookUrl: firstEnv('RECON_WEBHOOK_URL', 'MALL_WEBHOOK_URL'),
    webhookSecret: firstEnv('RECON_WEBHOOK_SECRET', 'MALL_WEBHOOK_SECRET'),
    dryRun: process.argv.includes('--dry-run'),
    json: process.argv.includes('--json'),
    drainFreshMs: intEnv('RECON_DRAIN_FRESH_MIN', DRAIN_FRESH_DEFAULT_MS / 60_000) * 60_000,
    sweepFreshMs: intEnv('RECON_SWEEP_FRESH_MIN', SWEEP_FRESH_DEFAULT_MS / 60_000) * 60_000,
    staleOrderMs: intEnv('RECON_STALE_ORDER_HOURS', STALE_ORDER_DEFAULT_HOURS) * 3600_000,
    moneyToleranceKobo: moneyToleranceRaw !== undefined ? intEnv('RECON_MONEY_TOLERANCE_KOBO', MONEY_TOLERANCE_DEFAULT_KOBO) : MONEY_TOLERANCE_DEFAULT_KOBO,
  };
}

/** The production id is a read target; every other target is denied. */
function guardTarget(databaseId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
    throw new Error(`RECON_D1_DATABASE_ID "${databaseId}" is not a database UUID.`);
  }
  if (databaseId.toLowerCase() === PREVIEW_D1_ID) {
    throw new Error(
      `Refusing to target the preview database ${PREVIEW_D1_ID}. This monitor reconciles ` +
      `the LIVE production database (${PROD_D1_ID}) and must never read the preview.`,
    );
  }
  if (databaseId.toLowerCase() !== PROD_D1_ID.toLowerCase()) {
    // Not preview and not the documented production id: allowed only as a
    // deliberate override of a real production-equivalent, never silently.
    console.warn(`WARNING: RECON_D1_DATABASE_ID ${databaseId} is not the documented production id ${PROD_D1_ID}; proceeding with the override.`);
  }
}

// ---------------------------------------------------------------------------
// The ONLY D1 read path — SELECT-only, single statement
// ---------------------------------------------------------------------------

/** Strip SQL comments then reject anything that is not a single SELECT. */
function assertSelectOnly(sql: string): string {
  const stripped = sql
    .replace(/--[^\n]*/g, '')        // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .trim()
    .replace(/;+\s*$/, '');           // a single trailing semicolon is fine
  if (/;/.test(stripped)) {
    throw new Error(`READ-ONLY GUARD: refusing a multi-statement query: ${stripped.slice(0, 80)}`);
  }
  if (!/^\s*(SELECT)\b/i.test(stripped) || /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|DROP|ALTER|CREATE|PRAGMA|ATTACH|VACUUM|BEGIN|COMMIT|SAVEPOINT)\b/i.test(stripped)) {
    throw new Error(`READ-ONLY GUARD: only a single SELECT may run against production: ${stripped.slice(0, 80)}`);
  }
  return stripped;
}

async function readSelect(cfg: Config, sql: string): Promise<any[]> {
  const statement = assertSelectOnly(sql);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`,
    {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiToken}`,
      },
      body: JSON.stringify({ sql: statement }),
    },
  );
  if (accessDenied(response) || response.status === 401 || response.status === 403) {
    throw new Error(`D1 read rejected (HTTP ${response.status}): the token must be D1-Read scoped and target account ${cfg.accountId}.`);
  }
  if (!response.ok) throw new Error(`D1 read failed (HTTP ${response.status}): ${await response.text()}`);
  const payload = await response.json() as any;
  if (payload && payload.success === false) throw new Error(`D1 read error: ${JSON.stringify(payload.errors ?? payload)}`);
  const batch = Array.isArray(payload?.result) ? payload.result[0] : undefined;
  const rows = batch?.results;
  return Array.isArray(rows) ? rows : [];
}

// ---------------------------------------------------------------------------
// Pass/fail table
// ---------------------------------------------------------------------------

interface CheckResult { label: string; ok: boolean; detail: string; }
const results: CheckResult[] = [];
function check(ok: boolean, label: string, detail = ''): void { results.push({ label, ok, detail }); }
const naira = (kobo: number) => '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const first = (rows: any[]) => (rows[0] ?? {});

function printTable(cfg: Config): boolean {
  const width = Math.max(...results.map((r) => r.label.length), 40);
  console.log(`\n===== PRODUCTION RECONCILIATION (READ-ONLY) — D1 ${cfg.databaseId} =====`);
  for (const r of results) {
    console.log(`${r.ok ? '[PASS]' : '[FAIL]'} | ${r.label.padEnd(width)} | ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log('==============================================================');
  console.log(`Total: ${results.length}   Passed: ${results.length - failed.length}   Failed: ${failed.length}`);
  return failed.length === 0;
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function checkMoney(cfg: Config): Promise<void> {
  const r = first(await readSelect(cfg, `
    SELECT
      (SELECT COALESCE(SUM(total_kobo),0)          FROM sales WHERE is_historical=0) AS sales_total,
      (SELECT COALESCE(SUM(total_refunded_kobo),0) FROM sales WHERE is_historical=0) AS refunded,
      (SELECT COALESCE(SUM(CASE WHEN total_kobo-paid_kobo>0 THEN total_kobo-paid_kobo ELSE 0 END),0)
                                                     FROM sales WHERE is_historical=0) AS receivable,
      (SELECT COALESCE(SUM(amount_kobo),0)          FROM money_movements WHERE type='Sale Inflow')  AS inflow,
      (SELECT COALESCE(SUM(amount_kobo),0)          FROM money_movements WHERE type='Sale Refund') AS refund;
  `));
  const salesTotal = Number(r.sales_total) || 0;
  const refunded = Number(r.refunded) || 0;
  const receivable = Number(r.receivable) || 0;
  const inflow = Number(r.inflow) || 0;
  const refund = Number(r.refund) || 0;
  // net ledger sales == net cash settled + still-owed receivable.
  const netSales = salesTotal - refunded;
  const netCash = inflow - refund;
  const residual = netSales - netCash - receivable;
  const ok = Math.abs(residual) <= cfg.moneyToleranceKobo;
  check(ok, 'money: sales ledger vs Sale Inflow - Sale Refund',
    `sales ${naira(salesTotal)} − refunded ${naira(refunded)} = ${naira(netSales)} | cash in ${naira(inflow)} − refund ${naira(refund)} + receivable ${naira(receivable)} = ${naira(netCash + receivable)} | residual ${residual} kobo`);
}

async function checkStock(cfg: Config): Promise<void> {
  // Opening = prev_stock of the product's earliest tracked movement; expected =
  // opening + Σ(signed qty), where Outgoing/Damaged/Discard subtract. Matches
  // assertStockReconciles() in scripts/money-invariants.test.ts.
  const rows = await readSelect(cfg, `
    SELECT p.id AS id, p.stock_qty AS stock,
      (SELECT prev_stock FROM stock_movements m WHERE m.product_id=p.id ORDER BY m.created_at LIMIT 1) AS opening_raw,
      COALESCE((SELECT SUM(CASE WHEN sm.qty<0 THEN sm.qty
                               WHEN sm.type IN ('Outgoing','Damaged','Discard') THEN -sm.qty
                               ELSE sm.qty END)
                FROM stock_movements sm WHERE sm.product_id=p.id),0) AS signed_moves
    FROM products p
    WHERE EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.product_id=p.id);
  `);
  const drifted = rows.filter((row) => {
    const opening = Number(row.opening_raw);
    const stock = Number(row.stock);
    const moves = Number(row.signed_moves) || 0;
    return stock !== opening + moves;
  });
  const sample = drifted.slice(0, 10)
    .map((d) => `${d.id}: shelf ${d.stock} != opening ${d.opening_raw} + ${d.signed_moves}`)
    .join('; ');
  check(drifted.length === 0, 'stock: shelf qty vs opening + signed movements',
    drifted.length === 0 ? `${rows.length} tracked products reconcile` : `${drifted.length} drifting of ${rows.length}: ${sample}`);
}

async function checkLiquid(cfg: Config): Promise<void> {
  // Derive each account's liquid balance exactly as AppContext does: Σ amount to
  // the account minus Σ amount from it. A healthy store keeps both >= 0.
  const legal = await readSelect(cfg, `
    SELECT
      (SELECT COUNT(*) FROM money_movements WHERE source_account IS NOT NULL AND source_account NOT IN ('Biz Account','Physical Cash')
                                  OR dest_account IS NOT NULL AND dest_account NOT IN ('Biz Account','Physical Cash')) AS bad_accounts,
      (SELECT COALESCE(SUM(amount_kobo),0) FROM money_movements WHERE dest_account='Biz Account')
        - (SELECT COALESCE(SUM(amount_kobo),0) FROM money_movements WHERE source_account='Biz Account') AS biz,
      (SELECT COALESCE(SUM(amount_kobo),0) FROM money_movements WHERE dest_account='Physical Cash')
        - (SELECT COALESCE(SUM(amount_kobo),0) FROM money_movements WHERE source_account='Physical Cash') AS cash;
  `);
  const r = first(legal);
  const bad = Number(r.bad_accounts) || 0;
  const biz = Number(r.biz) || 0;
  const cash = Number(r.cash) || 0;
  check(bad === 0, 'liquid: every movement uses a known account', bad === 0 ? 'no illegal source/dest accounts' : `${bad} movements reference an unknown account`);
  check(biz >= 0 && cash >= 0, 'liquid: per-account balance matches signed movements',
    `Biz ${naira(biz)} + Cash ${naira(cash)} = ${naira(biz + cash)}${biz < 0 || cash < 0 ? ' (a negative balance is drift)' : ''}`);
}

async function checkExpenses(cfg: Config): Promise<void> {
  const rows = await readSelect(cfg, `
    SELECT e.id AS id, e.amount_kobo AS amount, e.title AS title
    FROM expenses e
    WHERE e.is_historical=0 AND e.amount_kobo>0
      AND NOT EXISTS (SELECT 1 FROM money_movements m
                      WHERE m.type='Expense Outflow' AND m.ref_id=e.id);
  `);
  const sample = rows.slice(0, 10).map((r) => `${r.id}(${naira(Number(r.amount) || 0)})`).join(', ');
  check(rows.length === 0, 'expense: every non-historical expense books an Expense Outflow',
    rows.length === 0 ? 'no orphan expenses' : `${rows.length} orphan expense(s): ${sample}`);
}

async function checkStuckOrders(cfg: Config): Promise<void> {
  const cutoff = new Date(Date.now() - cfg.staleOrderMs).toISOString();
  const rows = await readSelect(cfg, `
    SELECT id, order_no, status, total_kobo, created_at
    FROM mall_orders
    WHERE status IN ('pending','confirmed','processing','packed','ready_for_pickup','out_for_delivery')
      AND created_at < ?
    ORDER BY created_at LIMIT 20;
  `.replace('?', `'${cutoff}'`));
  const oldest = rows[0];
  check(rows.length === 0, `orders: none stuck non-terminal past ${Math.round(cfg.staleOrderMs / 3600_000)}h`,
    rows.length === 0 ? 'no stuck orders'
      : `${rows.length} stuck; oldest ${oldest?.order_no ?? oldest?.id} (${oldest?.status}) since ${oldest?.created_at}`);
}

async function checkMarkers(cfg: Config): Promise<void> {
  const r = first(await readSelect(cfg, `SELECT
    (SELECT last_success_at FROM mall_job_runs WHERE name='maintenance') AS drain,
    (SELECT last_success_at FROM mall_job_runs WHERE name='sweep')       AS sweep;`));
  const now = Date.now();
  const drain = r.drain ? Date.parse(String(r.drain)) : NaN;
  const sweep = r.sweep ? Date.parse(String(r.sweep)) : NaN;
  const drainAge = Number.isFinite(drain) ? now - drain : Infinity;
  const sweepAge = Number.isFinite(sweep) ? now - sweep : Infinity;
  check(drainAge <= cfg.drainFreshMs, `drain: 'maintenance' marker fresh (<= ${Math.round(cfg.drainFreshMs / 60_000)}m)`,
    Number.isFinite(drainAge) ? `last drain ${Math.round(drainAge / 60_000)}m ago` : 'no maintenance marker — outbox drain never succeeded');
  check(sweepAge <= cfg.sweepFreshMs, `sweep: 'sweep' marker fresh (<= ${Math.round(cfg.sweepFreshMs / 60_000)}m)`,
    Number.isFinite(sweepAge) ? `last sweep ${Math.round(sweepAge / 60_000)}m ago` : 'no sweep marker — expiry/cleanup never ran');
}

// ---------------------------------------------------------------------------
// Signed failure alert — the SAME authenticated receiver the Worker's outbox
// drain uses (docs/mall-operations.md §independent-monitoring/§reuse-the-signed-receiver)
// ---------------------------------------------------------------------------

async function postAlert(cfg: Config): Promise<void> {
  const failures = results.filter((r) => !r.ok).map((r) => ({ label: r.label, detail: r.detail }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    id: `recon:${timestamp}`,
    event: 'MALL_RECON_FAIL',
    occurredAt: new Date().toISOString(),
    order: undefined,
    data: { source: 'verify-prod-reconciliation', database: cfg.databaseId, failures },
  });
  const signature = await signMallWebhook(cfg.webhookSecret!, timestamp, body);
  const response = await fetch(cfg.webhookUrl!, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'content-type': 'application/json',
      'x-mall-timestamp': timestamp,
      'x-mall-signature': `sha256=${signature}`,
    },
    body,
  });
  await response.body?.cancel();
  console.log(`alert: POSTed reconciliation failure to ${cfg.webhookUrl} (HTTP ${response.status})`);
  if (!response.ok) console.warn(`alert: receiver returned HTTP ${response.status}; the run still fails.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = parseFlags();
  console.log(`\nReconciling LIVE production D1 ${cfg.databaseId} (READ-ONLY). ${cfg.dryRun ? '--dry-run: no alert, exit 0 regardless.' : 'failures will alert + exit non-zero.'}`);

  await checkMoney(cfg);
  await checkStock(cfg);
  await checkLiquid(cfg);
  await checkExpenses(cfg);
  await checkStuckOrders(cfg);
  await checkMarkers(cfg);

  const passed = printTable(cfg);
  const payload = JSON.stringify({ database: cfg.databaseId, passed, results }, null, 2);
  if (cfg.json) console.log(`\n${payload}`);

  if (passed) return;

  if (cfg.dryRun) { console.log('\n--dry-run: drift detected but no alert was sent and the process exits 0.'); return; }
  if (cfg.webhookUrl && cfg.webhookSecret) {
    try { await postAlert(cfg); } catch (error) {
      console.error(`alert: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.warn('MALL_WEBHOOK_URL / MALL_WEBHOOK_SECRET not set — cannot alert; failing without notification.');
  }
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nReconciliation run failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
