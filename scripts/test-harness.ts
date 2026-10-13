/**
 * Shared production-safe test harness for Idofera local tests.
 *
 * Everything here is in-memory only: DatabaseSync(':memory:') with the real
 * relational DDL (ensureRelationalSchemaNode). No file database, no network,
 * and no helper in this file may ever touch a remote D1 — assertNotProduction
 * guards that contract.
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.ts';

/** Forbidden production targets. If a test target matches any of these, fail loudly. */
const FORBIDDEN_TARGETS = [
  'idomall.olz.workers.dev', // deployed workers domain
  'idofera', // exact production D1 database name (matched as its own token)
  '3e95a550-a091-490b-819d-f0acb7ea8dd8', // production D1 database id
];

/**
 * Guard for any helper that could reach a remote D1 (env bindings, connection
 * strings, script args, config objects). Throws when the target points at
 * production.
 */
export function assertNotProduction(target: unknown): void {
  const text = typeof target === 'string' ? target : JSON.stringify(target ?? '');
  for (const forbidden of FORBIDDEN_TARGETS) {
    if (forbidden === 'idofera') {
      // The bare database name only counts when it stands alone (word boundary);
      // the repo itself is named idofera-local-d1, which is fine.
      if (new RegExp('(?:^|[\\s"\':=,])idofera(?:$|[\\s"\':=,;/])').test(text)) {
        throw new Error(`Production D1 target detected (${forbidden}). Refusing to continue.`);
      }
      continue;
    }
    if (text.includes(forbidden)) {
      throw new Error(`Production target detected (${forbidden}). Refusing to continue.`);
    }
  }
}

export type HarnessDb = DatabaseSync;

/** Fresh in-memory relational database with the full schema bootstrapped. */
export function makeTestDb(): HarnessDb {
  assertNotProduction(':memory:');
  const db = new DatabaseSync(':memory:');
  ensureRelationalSchemaNode(db);
  return db;
}

/** Executor over the shared handlers, exactly as the node runtime builds it. */
export function makeTestExecutor(db: HarnessDb) {
  assertNotProduction(db);
  return makeNodeMallExecutor(db);
}

export type SeedProduct = {
  id: string;
  sku?: string;
  name?: string;
  stockQty?: number;
  retailPriceKobo?: number;
  mallPriceKobo?: number | null;
  isMallListed?: boolean;
};

/** Insert one or more products (mall-listed by default). */
export function seedCatalog(db: HarnessDb, products: SeedProduct | SeedProduct[]): void {
  const list = Array.isArray(products) ? products : [products];
  for (const p of list) {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO products (id, sku, name, cost_price_kobo, retail_price_kobo, stock_qty,
      unit, status, is_mall_listed, mall_price_kobo, created_at, updated_at)
      VALUES (?, ?, ?, 5000, ?, ?, 'pcs', 'Active', ?, ?, ?, ?)`).run(
      p.id,
      p.sku ?? p.id,
      p.name ?? p.id,
      p.retailPriceKobo ?? 10000,
      p.stockQty ?? 10,
      p.isMallListed === false ? 0 : 1,
      p.mallPriceKobo === null || p.mallPriceKobo === undefined ? null : p.mallPriceKobo,
      now,
      now,
    );
  }
}

export type CartLine = { productId: string; qty: number; unitPriceKobo: number };

/** Create an active cart for a session with the given lines. */
export function seedActiveCart(db: HarnessDb, session: string, lines: CartLine[]): string {
  assertNotProduction(session);
  const cartId = `mc-${session}`;
  db.prepare(`INSERT INTO mall_carts (id, session_id, status, updated_at) VALUES (?, ?, 'active', ?)`)
    .run(cartId, session, Date.now());
  for (const line of lines) {
    db.prepare('INSERT INTO mall_cart_items (id, cart_id, product_id, qty, unit_price_kobo) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), cartId, line.productId, line.qty, line.unitPriceKobo);
  }
  return cartId;
}

export type MoneyTotals = {
  salesTotalKobo: number;
  saleInflowKobo: number;
  saleRefundKobo: number;
  expenseOutflowKobo: number;
  liquidByAccount: Record<string, number>;
};

/**
 * Money aggregates computed from the relational tables themselves:
 *  - salesTotalKobo: SUM(sales.total_kobo)
 *  - saleInflowKobo / saleRefundKobo / expenseOutflowKobo: money_movements by type
 *  - liquidByAccount: net liquid movement per account (inflows credit the
 *    destination account, outflows debit the source account).
 */
export function moneyTotals(db: HarnessDb): MoneyTotals {
  const salesTotalKobo = Number((db.prepare('SELECT COALESCE(SUM(total_kobo), 0) AS n FROM sales').get() as any).n);
  const sumBy = (type: string) => Number(
    (db.prepare('SELECT COALESCE(SUM(amount_kobo), 0) AS n FROM money_movements WHERE type = ?').get(type) as any).n,
  );
  const saleInflowKobo = sumBy('Sale Inflow');
  const saleRefundKobo = sumBy('Sale Refund');
  const expenseOutflowKobo = sumBy('Expense Outflow');

  const liquidByAccount: Record<string, number> = {};
  const credit = (account: string | null, amount: number) => {
    if (account === null || account === undefined) return;
    liquidByAccount[account] = (liquidByAccount[account] ?? 0) + amount;
  };
  const debit = (account: string | null, amount: number) => {
    if (account === null || account === undefined) return;
    liquidByAccount[account] = (liquidByAccount[account] ?? 0) - amount;
  };
  for (const m of db.prepare('SELECT type, source_account, dest_account, amount_kobo FROM money_movements').all() as any[]) {
    const amount = Number(m.amount_kobo);
    const type = String(m.type);
    if (/transfer/i.test(type)) {
      debit(m.source_account, amount);
      credit(m.dest_account, amount);
    } else if (/drawing|expense|supplier payment|refund|outflow/i.test(type)) {
      debit(m.source_account, amount);
    } else {
      credit(m.dest_account, amount);
    }
  }
  return { salesTotalKobo, saleInflowKobo, saleRefundKobo, expenseOutflowKobo, liquidByAccount };
}

// Re-exports so test files need only one harness import.
export { ensureRelationalSchemaNode, makeNodeMallExecutor };
