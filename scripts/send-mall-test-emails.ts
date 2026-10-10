/**
 * End-to-end proof that a completed buyer transaction emails BOTH copies.
 *
 * Drives the REAL pipeline against the REAL local database, not a mock:
 *   buyer checkout (HTTP handler) -> mall_outbox row -> drain (in-process,
 *   exactly how server.ts now wires maintainMall) -> handleMallWebhook (HMAC
 *   verified) -> Resend.
 *
 * Usage:  npx tsx scripts/send-mall-test-emails.ts [buyerEmail]
 * Requires MALL_WEBHOOK_SECRET, MALL_NOTIFY_EMAIL, MALL_EMAIL_FROM and a real
 * RESEND_API_KEY in .env.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureRelationalSchemaNode, makeNodeMallExecutor } from '../src/server/nodeAdapter.js';
import { handleMallApi } from '../src/server/mallApi.js';
import { handleMallWebhook, type WebhookDatabase } from '../src/server/mallWebhook.js';

const BUYER_EMAIL = process.argv[2] || 'seakak@gmail.com';
const DB_PATH = path.join(process.cwd(), 'data', 'd1_storage.db');

const required = ['MALL_WEBHOOK_SECRET', 'MALL_NOTIFY_EMAIL', 'MALL_EMAIL_FROM', 'RESEND_API_KEY'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}. Fill them in .env before running.`);
  process.exit(1);
}
if (/^REPLACE/i.test(process.env.RESEND_API_KEY!)) {
  console.error('RESEND_API_KEY is still the placeholder. Paste your real Resend key into .env first.');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`Local database not found at ${DB_PATH}. Start the server once (npm run dev) so it is created.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
ensureRelationalSchemaNode(db);

const webhookDb: WebhookDatabase = {
  prepare(sql: string) {
    let params: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { params = values; return statement; },
      async run() { return { meta: { changes: Number(db.prepare(sql).run(...(params as any[])).changes) } }; },
      async all() { return { results: db.prepare(sql).all(...(params as any[])) as any[] }; },
    };
    return statement;
  },
};

const exec = makeNodeMallExecutor(db, process.env);
const session = `test-${Date.now()}`;

// A real, listed product so checkout has something to buy against real stock.
const product = db.prepare('SELECT id FROM products WHERE status=? AND is_mall_listed=1 AND stock_qty>0 LIMIT 1').get('Active') as any;
if (!product) {
  console.error('No in-stock, Mall-listed product exists in the local DB. Add one before running.');
  process.exit(1);
}
const cartId = `mc-${session}`;
db.prepare("INSERT OR IGNORE INTO mall_carts(id,session_id,status,updated_at) VALUES(?,?,'active',?)").run(cartId, session, Date.now());
const item = db.prepare('SELECT retail_price_kobo AS price FROM products WHERE id=?').get(product.id) as any;
db.prepare('INSERT INTO mall_cart_items(id,cart_id,product_id,qty,unit_price_kobo) VALUES(?,?,?,?,?)')
  .run(crypto.randomUUID(), cartId, product.id, 1, item.price);

console.log(`Placing a buyer checkout as ${BUYER_EMAIL} ...`);
const placed = await handleMallApi(new Request('http://localhost/api/mall/checkout', {
  method: 'POST',
  headers: { 'x-mall-session': session, 'idempotency-key': `test-attempt-${Date.now()}-abcdef` },
  body: JSON.stringify({
    customerName: 'Test Buyer',
    customerPhone: '08031234567',
    customerEmail: BUYER_EMAIL,
    deliveryAddress: '16 Atakpo Street, Uyo',
    paymentMethod: 'pay_on_pickup',
  }),
}), exec);
const receipt = await placed.json() as any;
console.log(`  checkout -> HTTP ${placed.status}`, receipt.orderNo ? `order ${receipt.orderNo}` : receipt);
if (placed.status !== 201) process.exit(1);

// Drain exactly as the running server does: in-process delivery to the receiver.
const queued = db.prepare("SELECT COUNT(*) AS n FROM mall_outbox WHERE status!='delivered'").get() as any;
console.log(`  outbox has ${queued.n} undelivered row(s); draining in-process ...`);

const { drainMallOutbox } = await import('../src/server/mallOperations.js');
const results: string[] = [];
await drainMallOutbox(exec, async (input: any, init: any) => {
  const request = new Request(String(input), {
    method: init?.method || 'POST',
    headers: init?.headers as Record<string, string>,
    body: init?.body as string,
  });
  const response = await handleMallWebhook(request, { ...process.env, DB: webhookDb });
  const detail = await response.clone().json().catch(() => ({}));
  results.push(`event -> HTTP ${response.status} ${JSON.stringify(detail)}`);
  return response;
});

console.log(results.join('\n'));
const deliveries = db.prepare('SELECT event,status,error,delivered_at FROM mall_webhook_deliveries ORDER BY delivered_at DESC LIMIT 5').all();
console.log('recent delivery rows:', deliveries);
console.log('\nCheck the two inboxes:', BUYER_EMAIL, 'and', process.env.MALL_NOTIFY_EMAIL);
