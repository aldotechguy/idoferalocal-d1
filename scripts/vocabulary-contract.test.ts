/**
 * Vocabulary contract test.
 *
 * The money/stock/account vocabularies in src/types/index.ts are the single
 * source of truth. This test scans every writer/read site under src/server/**,
 * src/context/AppContext.tsx and src/shared/** and fails on any literal that is
 * not a member of the canonical unions — so a typo'd type literal ('Sale Refundd',
 * a legacy 'Refund Outflow' writer, etc.) breaks the build instead of silently
 * corrupting the relational ledger.
 *
 * Run: npm run test:vocabulary
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES_FILE = path.join(ROOT, 'src', 'types', 'index.ts');

// ---------------------------------------------------------------- extraction

/** Pull the union members out of `export type NAME = ... ;` in the TS source. */
function extractUnion(source: string, name: string): string[] {
  const re = new RegExp(`export type ${name}\\s*=[\\s\\S]*?;`);
  const block = source.match(re);
  assert.ok(block, `Union ${name} must exist in src/types/index.ts`);
  return [...block[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const typesSource = fs.readFileSync(TYPES_FILE, 'utf8');
const moneyMovementTypes = extractUnion(typesSource, 'MoneyMovementType');
const movementTypes = extractUnion(typesSource, 'MovementType');
const liquidAccountTypes = extractUnion(typesSource, 'LiquidAccountType');

test('canonical unions extracted from src/types/index.ts', () => {
  assert.ok(moneyMovementTypes.includes('Sale Inflow'));
  assert.ok(moneyMovementTypes.includes('Sale Refund'));
  assert.ok(moneyMovementTypes.includes('Refund Outflow'));
  assert.ok(moneyMovementTypes.includes('Outgoing') === false); // stock, not money
  assert.ok(movementTypes.includes('Outgoing'));
  assert.ok(movementTypes.includes('Incoming'));
  assert.deepEqual(liquidAccountTypes, ['Biz Account', 'Physical Cash']);
});

// -------------------------------------------------------------------- scan

const SCAN_GLOBS: { dir: string; exts: string[] }[] = [
  { dir: path.join(ROOT, 'src', 'server'), exts: ['.ts', '.tsx'] },
  { dir: path.join(ROOT, 'src', 'context'), exts: ['.tsx'] }, // AppContext.tsx
  { dir: path.join(ROOT, 'src', 'shared'), exts: ['.ts', '.tsx'] },
];

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const scannedFiles = SCAN_GLOBS.flatMap((g) => listFiles(g.dir, g.exts));
assert.ok(scannedFiles.length > 0, 'scan set must not be empty');

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');

interface Violation {
  where: string;
  literal: string;
  kind: 'money' | 'stock' | 'account';
}

/** Split an argument list on top-level commas. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of args) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the `type` column, from the explicit column list when present. */
function typeColumnIndex(stmt: string): number {
  const cols = stmt.match(/\(([^)]*)\)\s*VALUES/i);
  if (cols) {
    const names = cols[1].split(',').map((c) => c.trim().toLowerCase());
    const i = names.indexOf('type');
    if (i >= 0) return i;
  }
  return 2; // default layout: id, date, type
}

/**
 * Scan one file for every *writer-context* type/account literal, regardless of
 * whether it is a union member — this is what makes a bogus literal fail.
 * Writer contexts:
 *  - SQL `INSERT INTO money_movements ... VALUES (...)` (type column + accounts)
 *  - SQL `INSERT INTO stock_movements ... VALUES (...)` (type column)
 *  - TS object `type: 'X'` whose body carries sourceAccount/destinationAccount
 *    (MoneyMovement writer) or previousStock/newStock (StockMovement writer)
 *  - the 3rd argument of an `adjustStock(...)` call
 * Reader contexts (=== / !== / switch / UI option labels) are ignored so the
 * legacy 'Refund Outflow' stays readable.
 */
function scanWriters(file: string, text: string): Violation[] {
  const where = (idx: number) => `${rel(file)}:${text.slice(0, idx).split('\n').length}`;
  const violations: Violation[] = [];
  const push = (kind: Violation['kind'], idx: number, literal?: string) => {
    if (literal) violations.push({ where: where(idx), literal, kind });
  };

  // ---- SQL INSERT INTO money_movements
  for (const m of text.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+money_movements[\s\S]{0,600}?VALUES\s*\(([^;]*?)\)/gi)) {
    const args = splitArgs(m[1]);
    push('money', m.index!, args[typeColumnIndex(m[0])]?.match(/'([^']*)'/)?.[1]);
    for (const a of args) {
      const acct = a.match(/'(Biz Account|Physical Cash)'/)?.[1];
      if (acct) push('account', m.index!, acct);
    }
  }

  // ---- SQL INSERT INTO stock_movements (explicit cols, VALUES or SELECT form)
  for (const m of text.matchAll(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+stock_movements([\s\S]{0,600}?)(?:VALUES\s*\(?([^;)]*)\)?|SELECT([\s\S]*?)FROM)/gi)) {
    const isValues = /VALUES/i.test(m[0]);
    if (isValues) {
      push('stock', m.index!, splitArgs(m[2] ?? '')[typeColumnIndex(m[0])]?.match(/'([^']*)'/)?.[1]);
    } else {
      // INSERT..SELECT layout: id, product, name, TYPE, qty, ...
      const args = m[3] !== undefined ? splitArgs(m[3]) : splitArgs(m[2] ?? '');
      for (const a of args.slice(3, 5)) push('stock', m.index!, a.match(/'([^']*)'/)?.[1]);
    }
  }

  // ---- TS object literals: exact `type: 'X'` (not `subtype:`), classified by
  //      neighbouring fields. Skip toast/notification vocabularies, which also
  //      use a `type` field but are unrelated to movements.
  const otherVocab = /^(error|success|info|warning|low_stock|expiry|customer_balance|supplier_overdue|daily_report|price_increase_alert|price_change)$/;
  for (const m of text.matchAll(/(?<![\w])type:\s*'([^']*)'/g)) {
    const literal = m[1];
    if (!literal || otherVocab.test(literal)) continue;
    const before = text.slice(Math.max(0, m.index! - 40), m.index!);
    if (/===|!==|switch/.test(before)) continue; // comparison/switch = reader
    const body = text.slice(m.index!, m.index! + 400);
    if (/destinationAccount|sourceAccount/.test(body)) push('money', m.index!, literal);
    else if (/previousStock|newStock/.test(body)) push('stock', m.index!, literal);
  }

  // ---- adjustStock(productId, qty, 'Type', ...) — 3rd argument
  for (const m of text.matchAll(/adjustStock\s*\(/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    const args = splitArgs(text.slice(m.index! + m[0].length, i - 1));
    push('stock', m.index!, args[2]?.match(/'([^']*)'/)?.[1]);
  }

  return violations;
}

const allWriters: Violation[] = scannedFiles.flatMap((f) => scanWriters(f, fs.readFileSync(f, 'utf8')));

// ------------------------------------------------------- vocabulary contract

// The ONE explicit whitelist entry: legacy 'Refund Outflow' is retained for
// read-only backward compatibility with historical rows, but no writer may
// ever produce it again — new refunds emit 'Sale Refund'.
const WHITELIST = ['Refund Outflow'];

test("whitelist contains exactly the legacy 'Refund Outflow'", () => {
  assert.deepEqual(WHITELIST, ['Refund Outflow']);
  assert.ok(moneyMovementTypes.includes('Refund Outflow'));
});

test('every writer-context money/stock/account literal is a canonical union member', () => {
  const money = new Set(moneyMovementTypes);
  const stock = new Set(movementTypes);
  const accounts = new Set(liquidAccountTypes);
  const offenders = allWriters.filter((v) => {
    if (v.kind === 'money') return !money.has(v.literal);
    if (v.kind === 'stock') return !stock.has(v.literal);
    return !accounts.has(v.literal);
  });
  assert.deepEqual(
    offenders.map((v) => `${v.where}: '${v.literal}' (${v.kind})`),
    [],
    'out-of-vocabulary writer literals found',
  );
});

test("'Refund Outflow' is never produced by a writer (read-only legacy vocabulary)", () => {
  const hits = allWriters.filter((v) => v.literal === 'Refund Outflow');
  assert.deepEqual(
    hits.map((v) => v.where),
    [],
    "'Refund Outflow' must only ever be read (legacy rows), never written",
  );
});

// ------------------------------------------------------- emission assertions

const findWriter = (kind: Violation['kind'], literal: string, fileFragment: string) =>
  allWriters.find((v) => v.kind === kind && v.literal === literal && v.where.includes(fileFragment));

test('POS refunds emit Sale Refund (src/context/AppContext.tsx)', () => {
  assert.ok(findWriter('money', 'Sale Refund', 'AppContext.tsx'), "POS refund writer must emit type 'Sale Refund'");
});

test('Mall refunds emit Sale Refund (src/server/mallOrderAdminApi.ts)', () => {
  assert.ok(findWriter('money', 'Sale Refund', 'mallOrderAdminApi.ts'), "Mall refund writer must emit type 'Sale Refund'");
});

test('Mall checkout emits Outgoing stock movement (src/server/mallApi.ts)', () => {
  assert.ok(findWriter('stock', 'Outgoing', 'mallApi.ts'), "Mall checkout writer must emit stock type 'Outgoing'");
});

test('Mall dispatch emits Expense Outflow (src/server/mallOrderAdminApi.ts)', () => {
  assert.ok(findWriter('money', 'Expense Outflow', 'mallOrderAdminApi.ts'), "Mall dispatch writer must emit type 'Expense Outflow'");
});

test('Mall checkout payment emits Sale Inflow (src/server/mallOrderAdminApi.ts)', () => {
  assert.ok(findWriter('money', 'Sale Inflow', 'mallOrderAdminApi.ts'), "Mall checkout payment writer must emit type 'Sale Inflow'");
});

// -------------------------------------------------------- scan sanity checks

test('scan actually saw writers (guard against a silent no-op scan)', () => {
  assert.ok(allWriters.some((v) => v.kind === 'money' && v.literal === 'Sale Inflow'));
  assert.ok(allWriters.some((v) => v.kind === 'stock' && v.literal === 'Outgoing'));
  assert.ok(allWriters.some((v) => v.kind === 'account'));
  assert.ok(allWriters.length > 20, `expected a substantial writer set, got ${allWriters.length}`);
});
