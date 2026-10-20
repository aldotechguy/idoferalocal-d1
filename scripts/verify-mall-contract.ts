/**
 * Hardened preview contract verification — the deployment gate for the
 * disposable preview deployment.
 *
 * HARD TARGET RULE: this script targets ONLY the isolated preview:
 *   Worker idomall-preview (https://idomall-preview.olz.workers.dev),
 *   D1 idofera-preview (id 647becf9-e665-4a85-9fa5-dbb5dedbcefa),
 *   R2 idomall-preview (wrangler --env preview).
 * It refuses to touch the live store (idomall / idofera) — the live origin and
 * live database are hard-denied and MALL_CONTRACT_ALLOW_LIVE is intentionally
 * NOT honored here.
 *
 * Pipeline:
 *   0. startup assertion (host + D1 id) — refuses to run otherwise
 *   1. backup: `npx wrangler d1 export idofera-preview --remote --output backups/...sql`
 *   2. the existing static contract suite (scripts/mall-contract-check.ts):
 *      cold-start schema bootstrap, max cart (100 x 1000) atomic commit, idempotent
 *      checkout replay, defensive caps
 *   3. the NEW full money-flow phase (this file):
 *      checkout -> stock decrement + Outgoing movement -> payment -> mirrored sale
 *      + Sale Inflow -> dispatch -> Logistics expense + Expense Outflow -> refund
 *      -> Sale Refund + stock restore + expense/outflow void -> final
 *      reconciliation snapshot
 *
 * Output: a pass/fail table; exit code 1 on any mismatch.
 *
 * Usage (from repo root):
 *   $env:MALL_CONTRACT_BASE_URL='https://idomall-preview.olz.workers.dev'
 *   $env:MALL_CONTRACT_D1='idofera-preview'
 *   $env:MALL_CONTRACT_WRANGLER_ENV='preview'
 *   npm run verify:mall-contract
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessHeaders } from './access-probe.ts';

// ---------------------------------------------------------------------------
// Hard target rule — the ONLY acceptable target
// ---------------------------------------------------------------------------

const PREVIEW_HOST = 'idomall-preview.olz.workers.dev';
const PREVIEW_DB_NAME = 'idofera-preview';
const PREVIEW_DB_ID = '647becf9-e665-4a85-9fa5-dbb5dedbcefa';
const PREVIEW_R2 = 'idomall-preview';

// Live identifiers — hard-denied (this orchestrator NEVER honors ALLOW_LIVE).
const LIVE_HOST = 'idomall.olz.workers.dev';
const LIVE_DB = 'idofera';

function requireConfig() {
  // Hard rule 1: MALL_CONTRACT_ALLOW_LIVE must be unset. Fail loudly if set.
  if (process.env.MALL_CONTRACT_ALLOW_LIVE !== undefined) {
    throw new Error(
      'MALL_CONTRACT_ALLOW_LIVE is set but this check must never target live. ' +
      'Unset it — the preview contract only ever runs against the isolated preview.',
    );
  }

  const raw = process.env.MALL_CONTRACT_BASE_URL;
  if (!raw) throw new Error('Set MALL_CONTRACT_BASE_URL=https://idomall-preview.olz.workers.dev');
  const base = new URL(raw);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/') {
    throw new Error('Use an HTTPS origin without credentials or a path.');
  }

  // Hard rule 1a: host must be the preview worker.
  if (base.hostname !== PREVIEW_HOST) {
    throw new Error(
      `Refusing to run: base URL host "${base.hostname}" is not the isolated preview worker. ` +
      `Only https://${PREVIEW_HOST} is allowed (live ${LIVE_HOST} is hard-denied).`,
    );
  }

  const database = process.env.MALL_CONTRACT_D1;
  if (!database) throw new Error('Set MALL_CONTRACT_D1=idofera-preview');

  // Hard rule 1b: D1 must be the preview database by NAME and by ID.
  if (database !== PREVIEW_DB_NAME) {
    throw new Error(
      `Refusing to run: MALL_CONTRACT_D1="${database}" is not "${PREVIEW_DB_NAME}". ` +
      `The live "${LIVE_DB}" database is hard-denied.`,
    );
  }

  const env = process.env.MALL_CONTRACT_WRANGLER_ENV;
  if (!env) throw new Error('Set MALL_CONTRACT_WRANGLER_ENV=preview');
  if (env !== 'preview') {
    throw new Error(
      `Refusing to run: MALL_CONTRACT_WRANGLER_ENV="${env}" is not "preview". ` +
      `Only the isolated preview environment (worker ${PREVIEW_HOST}, D1 ${PREVIEW_DB_NAME}, R2 ${PREVIEW_R2}) is allowed.`,
    );
  }

  // The staff API sits behind the Cloudflare Access application for this host;
  // a raw cookie cannot pass the edge gate. A Cloudflare Access SERVICE TOKEN
  // (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET, docs/staff-access.md §3)
  // is required, and the seeded contract-only app_user provides the role.
  // The token is environment-specific operator configuration — without it the
  // public API phase still runs and the staff checks are reported as SKIPPED.
  const hasServiceToken = Boolean(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET);

  return { base, database, env, hasServiceToken };
}

// ---------------------------------------------------------------------------
// Wrangler D1 helpers (remote, --env preview only)
// ---------------------------------------------------------------------------

const WRANGLER = process.platform === 'win32' ? 'node_modules\\.bin\\wrangler.cmd' : 'node_modules/.bin/wrangler';

function runSql(config: { database: string; env: string }, sql: string) {
  const file = join(tmpdir(), `idomall-contract-${randomUUID()}.sql`);
  writeFileSync(file, sql, 'utf8');
  execFileSync(
    process.platform === 'win32' ? 'cmd' : 'sh',
    process.platform === 'win32'
      ? ['/c', WRANGLER, 'd1', 'execute', config.database, '--env', config.env, '--remote', '--file', file]
      : ['-c', `${WRANGLER} d1 execute ${config.database} --env ${config.env} --remote --file ${file}`],
    { encoding: 'utf8' },
  );
}

/** Read rows back from the remote preview D1 (SELECT only — the read path).
 *
 *  Uses `wrangler d1 execute --command` because this wrangler version's
 *  `--file --json` path returns only batch META (rows read/written) and not the
 *  SELECT results, while `--command --json` returns the actual rows. --command
 *  is single-statement, which every read here is. */
function querySql(config: { database: string; env: string }, sql: string): any[] {
  const stmt = sql.trim().replace(/;+\s*$/, '');
  if (/;/.test(stmt)) throw new Error(`querySql accepts a single statement, got: ${stmt.slice(0, 80)}`);
  if (!/^\s*(SELECT|WITH)\b/i.test(stmt)) throw new Error(`querySql is read-only, refusing: ${stmt.slice(0, 80)}`);
  const out = execFileSync(
    process.platform === 'win32' ? 'cmd' : 'sh',
    process.platform === 'win32'
      ? ['/c', WRANGLER, 'd1', 'execute', config.database, '--env', config.env, '--remote', '--json', '--command', stmt]
      : ['-c', `${WRANGLER} d1 execute ${config.database} --env ${config.env} --remote --json --command '${stmt}'`],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Wrangler --json emits an ARRAY of batch objects: [{ results: [...], success, meta }].
  const extract = (parsed: any): any[] => {
    const batches = Array.isArray(parsed) ? parsed : [parsed];
    for (const batch of batches) if (Array.isArray(batch?.results)) return batch.results;
    return [];
  };
  // 1. The whole output is (usually) pure JSON — try it directly.
  try {
    const rows = extract(JSON.parse(out));
    if (rows.length) return rows;
  } catch { /* human output mixed in — fall through to candidate slicing */ }
  // 2. Otherwise slice balanced JSON arrays from the output and parse each.
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== '[') continue;
    // Walk to the matching close bracket to get a balanced slice.
    let depth = 0;
    for (let j = i; j < out.length; j++) {
      if (out[j] === '[') depth++;
      else if (out[j] === ']') {
        depth--; if (depth === 0) {
          try {
            const rows = extract(JSON.parse(out.slice(i, j + 1)));
            if (rows.length) return rows;
          } catch { /* not the results block */ }
          break;
        }
      }
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public API client (preview only)
// ---------------------------------------------------------------------------

function makeApi(base: URL) {
  return async function api(path: string, session: string, init: RequestInit = {}) {
    const headers = {
      'content-type': 'application/json',
      'x-mall-session': session,
      ...accessHeaders(),
      ...((init.headers as Record<string, string>) || {}),
    };
    const response = await fetch(new URL(path, base), { ...init, headers, signal: AbortSignal.timeout(90_000) });
    const text = await response.text();
    let body: any = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    return { status: response.status, body };
  };
}

// ---------------------------------------------------------------------------
// Pass/fail table
// ---------------------------------------------------------------------------

interface CheckResult { label: string; ok: boolean; detail: string; skipped?: boolean; }

const results: CheckResult[] = [];
function check(ok: boolean, label: string, detail = ''): boolean {
  results.push({ label, ok, detail });
  return ok;
}
function skip(label: string, detail = ''): void {
  results.push({ label, ok: false, detail: `SKIPPED — ${detail}`, skipped: true });
}

function printTable() {
  const width = Math.max(...results.map((r) => r.label.length), 40);
  console.log('\n================ PASS/FAIL TABLE ================');
  for (const r of results) {
    const verdict = r.skipped ? '[SKIP]' : r.ok ? '[PASS]' : '[FAIL]';
    console.log(`${verdict} | ${r.label.padEnd(width)} | ${r.detail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log('================================================');
  console.log(`Total: ${results.length}   Passed: ${passed}   Failed: ${results.length - passed - skipped}   Skipped: ${skipped}`);
  if (results.some((r) => !r.ok && !r.skipped)) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const config = requireConfig();
  const api = makeApi(config.base);
  const run = randomUUID().slice(0, 8);
  const now = Date.now();

  console.log(`\nTarget: ${config.base.origin} (D1 ${config.database} via wrangler env "${config.env ?? config.env}")`);
  console.log(`Hard rule: preview-only — worker ${PREVIEW_HOST}, D1 ${PREVIEW_DB_NAME} (${PREVIEW_DB_ID}), R2 ${PREVIEW_R2}. Live is hard-denied.\n`);
  let orderId: string | undefined;
  let cleanupRun = false;
  const session = `verify-${run}`;
  const sessionsToClean = new Set<string>([session, `contract-a-${run}`, `contract-b-${run}`, `contract-c-${run}`, `contract-d-${run}`]);
  let checkoutTemporarilyEnabled = false;
  const cleanup = () => {
    if (cleanupRun) return;
    cleanupRun = true;
    try {
      cleanupContractPreview(config, { session, orderId, run, sessions: [...sessionsToClean] });
      if (checkoutTemporarilyEnabled) {
        runSql(config, "UPDATE settings SET value_json='\"false\"',updated_at=unixepoch()*1000 WHERE key='MALL_CHECKOUT_ENABLED';");
      }
    } catch (error) {
      console.error('[preview-contract] artifact cleanup failed:', error instanceof Error ? error.message : String(error));
    }
  };
  process.once('exit', cleanup);

  // ------------------------------------------------------------------
  // Step 1: backup the preview database BEFORE writing anything
  // ------------------------------------------------------------------
  console.log('Backing up idofera-preview...');
  const stamp = new Date().toISOString().slice(0, 10);
  const backupDir = join(process.cwd(), 'backups');
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
  const backupFile = join(backupDir, `idofera-preview-${stamp}.sql`);
  execFileSync(
    process.platform === 'win32' ? 'cmd' : 'sh',
    process.platform === 'win32'
      ? ['/c', 'npx', 'wrangler', 'd1', 'export', PREVIEW_DB_NAME, '--remote', '--output', backupFile]
      : ['-c', `npx wrangler d1 export ${PREVIEW_DB_NAME} --remote --output ${backupFile}`],
    { encoding: 'utf8', stdio: 'inherit' },
  );
  check(existsSync(backupFile) && backupFile.length > 0, 'backup: idofera-preview exported before writes', backupFile);

  // ------------------------------------------------------------------
  // Step 2: the existing static contract suite (cold start, max cart,
  // idempotent replay, caps) — reuse the proven checks.
  // ------------------------------------------------------------------
  console.log('\nRunning the static contract suite (scripts/mall-contract-check.ts)...');
  const suiteEnv = {
    ...process.env,
    MALL_CONTRACT_BASE_URL: config.base.origin,
    MALL_CONTRACT_D1: config.database,
    MALL_CONTRACT_WRANGLER_ENV: config.env ?? 'preview',
    MALL_CONTRACT_ALLOW_LIVE: undefined,
  };
  try {
    execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/mall-contract-check.ts'], {
      encoding: 'utf8', stdio: 'inherit', env: suiteEnv,
    });
    check(true, 'static suite: cold start + max cart + idempotent replay + caps', 'scripts/mall-contract-check.ts exited 0');
  } catch (error) {
    check(false, 'static suite: cold start + max cart + idempotent replay + caps', error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200));
  }

  // ------------------------------------------------------------------
  // Step 3: the NEW money-flow phase, driven through the same public API
  // (plus staff endpoints via Access service-token headers when configured).
  // ------------------------------------------------------------------
  console.log('\nRunning the money-flow phase...');

  // Seed preview-only rows (pv-* prefix, cleaned up at the end).
  const seed = [
    `DELETE FROM mall_carts WHERE session_id IN (${[...sessionsToClean].map((staleSession) => `'${staleSession}'`).join(',')});`,
    `DELETE FROM mall_cart_items WHERE id IN ('pv-fci-1','pv-fci-2');`,
    `DELETE FROM products WHERE id IN ('pv-f-1','pv-f-2','pv-f-3');`,
    `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n < 3) INSERT OR REPLACE INTO products
      (id, sku, name, status, stock_qty, cost_price_kobo, retail_price_kobo, mall_price_kobo, min_selling_price_kobo, created_at, updated_at)
      SELECT 'pv-f-' || n, 'PV-F-' || n, 'Verify product ' || n, 'Active', 100, 5000, 10000, 10000, 5000,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' FROM seq;`,
    `INSERT OR REPLACE INTO mall_carts (id, session_id, status, updated_at) VALUES ('mc-${session}', '${session}', 'active', ${now});`,
    `INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo)
      VALUES ('pv-fci-1', 'mc-${session}', 'pv-f-1', 2, 10000), ('pv-fci-2', 'mc-${session}', 'pv-f-2', 1, 10000);`,
  ];
  for (const statement of seed) runSql(config, statement);
  console.log('seeded 3 preview products (pv-f-*) and a 3-unit cart');

  // Sanity: the seed must actually be visible to the DEPLOYED WORKER (same D1
  // the Worker binds); if the cart reads back empty the flow would silently no-op.
  const cartCheck = await api('/api/mall/cart', session);
  check(
    cartCheck.status === 200 && cartCheck.body?.items?.length === 2 && cartCheck.body?.subtotalKobo === 30000,
    'seed: cart visible to the deployed worker with 2 lines / 30000 kobo',
    `status ${cartCheck.status}, items ${cartCheck.body?.items?.length}, subtotal ${cartCheck.body?.subtotalKobo}`,
  );

  // --- checkout
  const checkoutBody = {
    customerName: 'Contract Verify',
    customerPhone: '+2348000000001',
    // Delivery zone (not pickup) so dispatch books the Logistics expense +
    // Expense Outflow — the money-flow phase under test.
    deliveryZone: 'uyo_outer',
    deliveryAddress: 'Shelter Afrique, Uyo',
    paymentMethod: 'pay_on_pickup',
    note: `verify run ${run}`,
  };
  const checkoutKey = `verify-${run}-0001`;
  const checkoutAvailability = await api('/api/mall/config', session);
  if (checkoutAvailability.status !== 200 || checkoutAvailability.body?.checkoutEnabled !== true) {
    skip('checkout and money-flow phases', 'Preview checkout is disabled for public traffic; temporarily enable it only for this hard-guarded test.');
    checkoutTemporarilyEnabled = true;
    runSql(config, "UPDATE settings SET value_json='\"true\"',updated_at=unixepoch()*1000 WHERE key='MALL_CHECKOUT_ENABLED';");
    const enabledConfig = await api('/api/mall/config', session);
    if (enabledConfig.status !== 200 || enabledConfig.body?.checkoutEnabled !== true) {
      throw new Error('Could not enable checkout on isolated Preview for contract run.');
    }
  }
  const placed = await api('/api/mall/checkout', session, {
    method: 'POST', headers: { 'Idempotency-Key': checkoutKey }, body: JSON.stringify(checkoutBody),
  });
  const order = placed.body?.order ?? placed.body;
  const expectedSubtotal = 3 * 10000; // 3 units x 10000 kobo
  const expectedFee = 250000; // uyo_outer zone fee from the server policy
  const expectedTotal = expectedSubtotal + expectedFee;
  check(
    (placed.status === 200 || placed.status === 201) && order?.orderNo && order?.totalKobo === expectedTotal,
    'checkout: order placed and priced server-side (delivery fee from the zone policy)',
    `status ${placed.status}, total ${order?.totalKobo} (expected ${expectedTotal})`,
  );

  orderId = order?.id ?? order?.orderNo;
  check(Boolean(orderId), 'checkout: order id is available for the staff flow', `id ${orderId}`);

  // --- stock decrement + Outgoing movement (read from remote D1)
  const stockRows = querySql(config, "SELECT stock_qty FROM products WHERE id = 'pv-f-1'");
  check(stockRows[0]?.stock_qty === 98, 'stock decrement: pv-f-1 100 -> 98 after checkout', `stock ${stockRows[0]?.stock_qty}`);
  const outgoings = querySql(config, "SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = 'pv-f-1' AND type = 'Outgoing'");
  check(Number(outgoings[0]?.n) >= 1, 'stock movement: an Outgoing movement is written at checkout', `count ${outgoings[0]?.n}`);

  // --- payment -> mirrored sale + Sale Inflow
  // Mint a contract-only staff session directly in the preview D1 (no real
  // credentials; the seeded session is cleaned up at the end). Requires the
  // Access service token to pass the edge gate; otherwise SKIPPED.
  const cookie = config.hasServiceToken ? mintStaffSession(config, run) : null;
  if (!cookie) {
    skip('staff phase: confirm/collect-payment/dispatch/complete/refund', 'no CF_ACCESS_CLIENT_ID/SECRET service token configured for the preview Access application');
    skip('payment -> mirrored sale + Sale Inflow', 'requires the staff phase');
    skip('dispatch -> Logistics expense + Expense Outflow', 'requires the staff phase');
    skip('refund -> Sale Refund + stock restore + expense void', 'requires the staff phase');
    skip('reconciliation snapshot of the staff-driven lifecycle', 'requires the staff phase');
    cleanup();
    process.removeListener('exit', cleanup);
    printTable();
    return;
  }
  const staffApi = async (action: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(new URL(`/api/staff/mall-orders/${orderId}/${action}`, config.base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...accessHeaders() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  const confirmed = await staffApi('confirm');
  check(confirmed.status === 200, 'staff: order confirmed', `status ${confirmed.status}`);

  const collected = await staffApi('collect-payment', { paymentMethod: 'Cash', amountKobo: expectedTotal });
  check(collected.status === 200, 'staff: payment collected in full', `status ${collected.status} ${JSON.stringify(collected.body).slice(0, 120)}`);

  const sale = querySql(config, `SELECT id, total_kobo, paid_kobo, status FROM sales WHERE id = 'sale-${orderId}'`);
  check(
    sale.length === 1 && sale[0]?.total_kobo === expectedTotal && sale[0]?.paid_kobo === expectedTotal && sale[0]?.status === 'Completed',
    'payment: mirrored sale created, totals match, status Completed',
    `rows ${sale.length}, total ${sale[0]?.total_kobo}, paid ${sale[0]?.paid_kobo}, status ${sale[0]?.status}`,
  );

  const inflow = querySql(config, `SELECT amount_kobo, source_account, dest_account FROM money_movements WHERE id = 'mm-sale-${orderId}'`);
  const inflowRow = inflow[0] ?? {};
  check(
    inflowRow.amount_kobo === expectedTotal && !inflowRow.source_account && inflowRow.dest_account === 'Physical Cash',
    'payment: Sale Inflow movement booked into Physical Cash',
    `amount ${inflowRow.amount_kobo}, dest ${inflowRow.dest_account}`,
  );

  // --- dispatch -> Logistics expense + Expense Outflow
  const processing = await staffApi('start-processing');
  check(processing.status === 200, 'dispatch: order entered processing', `status ${processing.status}`);
  await staffApi('mark-packed');
  const dispatched = await staffApi('mark-out-for-delivery', { courier: 'Contract Courier' });
  check(dispatched.status === 200, 'dispatch: order dispatched to courier', `status ${dispatched.status}`);

  const expense = querySql(config, `SELECT amount_kobo FROM expenses WHERE id = 'exp-mall-del-${orderId}'`);
  check(expense[0]?.amount_kobo === expectedFee, 'dispatch: Logistics expense booked at the zone fee', `amount ${expense[0]?.amount_kobo} (expected ${expectedFee})`);
  const outflow = querySql(config, `SELECT amount_kobo FROM money_movements WHERE id = 'mm-exp-mall-del-${orderId}'`);
  check(
    outflow[0]?.amount_kobo === expectedFee && outflow[0]?.source_account === 'Physical Cash',
    'dispatch: Expense Outflow movement booked out of the till',
    `amount ${outflow[0]?.amount_kobo}, src ${outflow[0]?.source_account}`,
  );

  // --- complete -> refund -> Sale Refund + stock restore + expense/outflow void
  const completed = await staffApi('complete');
  check(completed.status === 200, 'lifecycle: order completed', `status ${completed.status}`);

  const refund = await staffApi('refund', { reason: 'Contract verify refund', returnStock: true, returnReference: 'GRN-VERIFY' });
  check(refund.status === 200, 'lifecycle: refund accepted', `status ${refund.status}`);

  const refundMm = querySql(config, `SELECT amount_kobo, source_account FROM money_movements WHERE id = 'mm-refund-sale-${orderId}'`);
  check(
    refundMm[0]?.amount_kobo === expectedTotal && refundMm[0]?.source_account === 'Physical Cash',
    'refund: Sale Refund movement equals the cash collected, out of the till',
    `amount ${refundMm[0]?.amount_kobo}, src ${refundMm[0]?.source_account}`,
  );

  const stockAfter = querySql(config, "SELECT stock_qty FROM products WHERE id = 'pv-f-1'");
  check(stockAfter[0]?.stock_qty === 100, 'refund: stock restored to the pre-order level', `stock ${stockAfter[0]?.stock_qty}`);

  const voidedExpense = querySql(config, `SELECT amount_kobo FROM expenses WHERE id = 'exp-mall-del-${orderId}'`);
  check(voidedExpense[0]?.amount_kobo === 0, 'refund: Logistics expense voided to 0', `amount ${voidedExpense[0]?.amount_kobo}`);
  const voidedOutflow = querySql(config, `SELECT amount_kobo FROM money_movements WHERE id = 'mm-exp-mall-del-${orderId}'`);
  check(voidedOutflow[0]?.amount_kobo === 0, 'refund: Expense Outflow movement voided to 0', `amount ${voidedOutflow[0]?.amount_kobo}`);

  // ------------------------------------------------------------------
  // Step 4: final reconciliation snapshot
  // ------------------------------------------------------------------
  console.log('\nReconciliation snapshot...');
  const recon = {
    order: querySql(config, `SELECT status, total_kobo, linked_sale_id FROM mall_orders WHERE id = '${orderId}'`)[0],
    sale: querySql(config, `SELECT status, total_kobo, paid_kobo, total_refunded_kobo FROM sales WHERE id = 'sale-${orderId}'`)[0],
    payment: querySql(config, `SELECT status, amount_kobo FROM payments WHERE order_id = '${orderId}'`)[0],
    movements: querySql(config, `SELECT type, amount_kobo FROM money_movements WHERE ref_id = 'sale-${orderId}' OR ref_id = '${orderId}' ORDER BY created_at`),
    stock: querySql(config, "SELECT stock_qty FROM products WHERE id = 'pv-f-1'")[0],
    outgoing: querySql(config, "SELECT qty FROM stock_movements WHERE product_id = 'pv-f-1' AND type = 'Outgoing' LIMIT 1")[0],
    returned: querySql(config, `SELECT qty FROM stock_movements WHERE ref_id = 'refund:${orderId}' AND type = 'Returned'`)[0],
  };
  console.log(JSON.stringify(recon, null, 2));

  const inflowAmt = recon.movements.find((m: any) => m.type === 'Sale Inflow')?.amount_kobo ?? 0;
  const refundAmt = recon.movements.find((m: any) => m.type === 'Sale Refund')?.amount_kobo ?? 0;
  const outflowAmt = recon.movements.filter((m: any) => m.type === 'Expense Outflow').reduce((s: number, m: any) => s + (m.amount_kobo ?? 0), 0);
  check(recon.order?.status === 'refunded', 'reconciliation: order is refunded', `status ${recon.order?.status}`);
  check(recon.sale?.status === 'Refunded' && recon.sale?.total_refunded_kobo === expectedTotal, 'reconciliation: sale mirrors the refund', `status ${recon.sale?.status}, refunded ${recon.sale?.total_refunded_kobo}`);
  check(recon.payment?.status === 'refunded', 'reconciliation: payment row is refunded', `status ${recon.payment?.status}`);
  check(
    inflowAmt === expectedTotal && refundAmt === expectedTotal,
    'reconciliation: Sale Inflow == Sale Refund == collected cash',
    `inflow ${inflowAmt}, refund ${refundAmt}, expected ${expectedTotal}`,
  );
  check(outflowAmt === 0, 'reconciliation: the delivery outflow fully unwound', `outflow ${outflowAmt}`);
  check(recon.stock?.stock_qty === 100, 'reconciliation: shelf stock back to 100', `stock ${recon.stock?.stock_qty}`);
  check(Number(recon.outgoing?.qty) === 3, 'reconciliation: the Outgoing movement moved 3 units', `qty ${recon.outgoing?.qty}`);
  check(Number(recon.returned?.qty) === 3, 'reconciliation: the Returned movement restored 3 units', `qty ${recon.returned?.qty}`);

  // ------------------------------------------------------------------
  // Cleanup: delete the pv-* rows this run created
  // ------------------------------------------------------------------
  const finalCleanup = [
    `DELETE FROM mall_order_items WHERE mall_order_id = '${orderId}';`,
    `DELETE FROM payments WHERE order_id = '${orderId}';`,
    `DELETE FROM mall_order_events WHERE order_id = '${orderId}';`,
    `DELETE FROM sales WHERE id = 'sale-${orderId}';`,
    `DELETE FROM sale_items WHERE sale_id = 'sale-${orderId}';`,
    `DELETE FROM delivery_orders WHERE sale_id = 'sale-${orderId}';`,
    `DELETE FROM expenses WHERE id = 'exp-mall-del-${orderId}';`,
    "DELETE FROM money_movements WHERE ref_id IN ('sale-" + orderId + "', '" + orderId + "', 'refund:" + orderId + "');",
    `DELETE FROM stock_movements WHERE ref_id IN ('checkout:${orderId}', 'refund:${orderId}');`,
    `DELETE FROM mall_returns WHERE order_id = '${orderId}';`,
    `DELETE FROM mall_checkout_attempts WHERE order_id = '${orderId}';`,
    `DELETE FROM app_sessions WHERE user_id='contract-user-${run}';`,
    `DELETE FROM app_users WHERE id='contract-user-${run}';`,
    `DELETE FROM mall_orders WHERE id = '${orderId}';`,
    `DELETE FROM mall_carts WHERE session_id = '${session}';`,
    `DELETE FROM mall_cart_items WHERE cart_id = 'mc-${session}';`,
    "DELETE FROM products WHERE id LIKE 'pv-f-%';",
    "DELETE FROM audit_logs WHERE entity_id = '" + orderId + "';",
  ];
  for (const statement of finalCleanup) runSql(config, statement);
  cleanup();
  process.removeListener('exit', cleanup);
  console.log('cleanup: preview-only rows removed (pv-f-* and this run order)');

  printTable();
}

/**
 * Mint a staff session for the contract run by seeding a contract-only
 * app_user + app_session directly into the preview D1 (ids prefixed
 * 'contract-', deleted at cleanup). This avoids real credentials entirely and
 * cannot touch the live database (the guard already fixed the target).
 */
function mintStaffSession(config: { database: string; env: string }, runTag: string): string {
  const userId = `contract-user-${runTag}`;
  const token = `contract-token-${runTag}-${randomUUID().replaceAll('-', '')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const nowMs = Date.now();
  runSql(
    config,
    `INSERT OR REPLACE INTO app_users (id, email, display_name, role, status, password_hash, password_salt, created_at)
     VALUES ('${userId}', 'contract-${runTag}@preview.invalid', 'Contract Runner', 'Administrator', 'Active', 'contract-disabled-login', 'contract', '2026-01-01T00:00:00.000Z');`,
  );
  runSql(
    config,
    `INSERT OR REPLACE INTO app_sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES ('${hash}', '${userId}', ${nowMs}, ${nowMs + 3_600_000}, ${nowMs});`,
  );
  return `idofera_session=${token}`;
}

main().catch((error) => {
  console.error(`\nContract verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});


/** Clean both contract suites' deterministic preview-only fixtures after any exit path. */
function cleanupContractPreview(
  config: { database: string; env: string },
  run: { session: string; orderId?: string; run: string; sessions: string[] },
): void {
  const orderId = run.orderId;
  const statements = [
    ...(orderId ? [
      `DELETE FROM mall_order_items WHERE mall_order_id='${orderId}';`,
      `DELETE FROM payments WHERE order_id='${orderId}';`,
      `DELETE FROM mall_order_events WHERE order_id='${orderId}';`,
      `DELETE FROM sales WHERE id='sale-${orderId}';`,
      `DELETE FROM sale_items WHERE sale_id='sale-${orderId}';`,
      `DELETE FROM delivery_orders WHERE sale_id='sale-${orderId}';`,
      `DELETE FROM expenses WHERE id='exp-mall-del-${orderId}';`,
      `DELETE FROM money_movements WHERE ref_id IN ('sale-${orderId}','${orderId}','refund:${orderId}');`,
      `DELETE FROM stock_movements WHERE ref_id IN ('checkout:${orderId}','refund:${orderId}');`,
      `DELETE FROM mall_returns WHERE order_id='${orderId}';`,
      `DELETE FROM mall_checkout_attempts WHERE attempt_key='verify-${run.run}-0001';`,
      `DELETE FROM audit_logs WHERE entity_id='${orderId}';`,
      `DELETE FROM mall_orders WHERE id='${orderId}';`,
    ] : []),
    `DELETE FROM mall_carts WHERE session_id IN (${run.sessions.map((session) => `'${session}'`).join(',')}) OR session_id LIKE 'contract-a-${run.run}' OR session_id LIKE 'contract-b-${run.run}' OR session_id LIKE 'contract-c-${run.run}' OR session_id LIKE 'contract-d-${run.run}';`,
    `DELETE FROM mall_checkout_attempts WHERE attempt_key LIKE 'verify-%' OR attempt_key LIKE 'contract-%';`,
    `DELETE FROM mall_order_items WHERE id LIKE 'pv-fci-%';`,
    `DELETE FROM mall_cart_items WHERE id LIKE 'pv-fci-%' OR id LIKE 'pv-ci-a-%' OR id LIKE 'pv-ci-b-%' OR id LIKE 'pv-ci-c-%';`,
    "DELETE FROM products WHERE id LIKE 'pv-f-%' OR id LIKE 'pv-%' OR id='pv-big';",
    `DELETE FROM mall_outbox WHERE id LIKE 'created:${orderId || 'no-order'}' OR id LIKE 'heartbeat:%' AND order_id IS NULL;`,
    `DELETE FROM mall_outbox WHERE order_id='${orderId || ''}' AND order_id IS NOT NULL;`,
    `DELETE FROM mall_webhook_deliveries WHERE event_id LIKE 'created:${orderId || 'no-order'}';`,
  ];
  for (const statement of statements) runSql(config, statement);
}
