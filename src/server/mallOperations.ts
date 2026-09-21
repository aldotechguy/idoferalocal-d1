import type { MallExecutor, MallStmt } from './mallApi.js';
import { normalizedPhoneSql } from '../shared/mallPhone.js';

/**
 * #10 merchandising fields. These are added to `products` with guarded ALTERs:
 * a duplicate-column error means the column already exists, which is the normal
 * path on every start after the first. Both runtimes apply this before serving.
 */
/**
 * Bumped whenever the additive schema below changes. A deployed Worker checks
 * this single row before re-running the DDL, so a cold isolate no longer repeats
 * ~80 statements (and the 5 known-failing duplicate-column ALTERs) on every
 * start. See `ensureSchema` in sites-worker.ts.
 */
// v7 installs the session-first buy-again indexes on existing D1 databases;
// v8 adds the covering sold-quantity index behind the top-sellers rail.
export const MALL_SCHEMA_VERSION = 8;

export const MALL_MERCH_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'mall_featured', ddl: 'ALTER TABLE products ADD COLUMN mall_featured INTEGER NOT NULL DEFAULT 0' },
  { name: 'mall_display_order', ddl: 'ALTER TABLE products ADD COLUMN mall_display_order INTEGER' },
  { name: 'mall_promo_price_kobo', ddl: 'ALTER TABLE products ADD COLUMN mall_promo_price_kobo INTEGER' },
  { name: 'mall_promo_start', ddl: 'ALTER TABLE products ADD COLUMN mall_promo_start TEXT' },
  { name: 'mall_promo_end', ddl: 'ALTER TABLE products ADD COLUMN mall_promo_end TEXT' },
];

export const MALL_ORDER_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'customer_email', ddl: 'ALTER TABLE mall_orders ADD COLUMN customer_email TEXT' },
];

export function isDuplicateColumnError(error: unknown) {
  return /duplicate column name/i.test(String(error));
}

export const MALL_LISTING_STATES = "mall_featured, mall_display_order, mall_promo_price_kobo, mall_promo_start, mall_promo_end";

export type MallConfig = {
  MALL_BANK_NAME?: string; MALL_BANK_ACCOUNT_NAME?: string; MALL_BANK_ACCOUNT_NUMBER?: string;
  MALL_PICKUP_ADDRESS?: string; MALL_PICKUP_HOURS?: string;
  MALL_WEBHOOK_URL?: string; MALL_WEBHOOK_SECRET?: string;
  MALL_CHECKOUT_ENABLED?: string; MALL_UNPAID_EXPIRY_HOURS?: string;
};

const phone = normalizedPhoneSql('customer_phone');
const orderStates = "'pending','confirmed','processing','packed','ready_for_pickup','out_for_delivery','completed','cancelled','refunded'";
export const MALL_OPERATIONS_DDL = [
  `CREATE TABLE IF NOT EXISTS mall_schema_versions(version INTEGER PRIMARY KEY, installed_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mall_order_events(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_mall_events_order ON mall_order_events(order_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS mall_outbox(id TEXT PRIMARY KEY, order_id TEXT, event TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','delivered','dead')), attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER, last_error TEXT, created_at TEXT NOT NULL, delivered_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_mall_outbox_due ON mall_outbox(status,next_attempt_at)`,
  `CREATE TABLE IF NOT EXISTS mall_job_runs(name TEXT PRIMARY KEY, last_success_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mall_metrics(day TEXT NOT NULL, metric TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(day,metric))`,
  `CREATE TABLE IF NOT EXISTS mall_rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mall_returns(order_id TEXT PRIMARY KEY, disposition TEXT NOT NULL CHECK(disposition IN ('restocked','not_restocked')), receipt_reference TEXT NOT NULL, reason TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mall_webhook_deliveries(id TEXT PRIMARY KEY, event_id TEXT NOT NULL, event TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('sent','failed')), error TEXT, delivered_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_mall_webhook_event ON mall_webhook_deliveries(event_id, delivered_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mall_cart_product_unique ON mall_cart_items(cart_id,product_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mall_active_session ON mall_carts(session_id) WHERE status='active' AND session_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_mall_normalized_phone ON mall_orders(${phone})`,
  `CREATE INDEX IF NOT EXISTS idx_customer_normalized_phone ON customers(${normalizedPhoneSql('phone')})`,
  `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`,
  `CREATE TRIGGER IF NOT EXISTS mall_delivery_consistency BEFORE UPDATE OF status ON delivery_orders
    WHEN EXISTS(SELECT 1 FROM mall_orders o WHERE o.linked_sale_id=NEW.sale_id AND
      ((o.status='out_for_delivery' AND NEW.status!='In Transit') OR (o.status='completed' AND NEW.status!='Delivered') OR
       (o.status='refunded' AND NEW.status NOT IN ('Returned','Cancelled'))))
    BEGIN SELECT RAISE(ABORT,'USE_MALL_FULFILMENT_WORKFLOW'); END`,
  `CREATE TRIGGER IF NOT EXISTS mall_cart_parent_delete AFTER DELETE ON mall_carts BEGIN DELETE FROM mall_cart_items WHERE cart_id=OLD.id; END`,
  ...['INSERT', 'UPDATE'].flatMap((operation) => [
    `CREATE TRIGGER IF NOT EXISTS mall_cart_valid_${operation} BEFORE ${operation} ON mall_cart_items WHEN NEW.qty <= 0 OR NEW.qty > 1000 OR typeof(NEW.qty) != 'integer' OR NEW.unit_price_kobo < 0 OR NOT EXISTS(SELECT 1 FROM mall_carts WHERE id=NEW.cart_id) OR NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id) BEGIN SELECT RAISE(ABORT,'MALL_INVALID_CART_LINE'); END`,
    `CREATE TRIGGER IF NOT EXISTS mall_order_valid_${operation} BEFORE ${operation} ON mall_orders WHEN NEW.status NOT IN (${orderStates}) OR NEW.total_kobo < 0 OR NEW.subtotal_kobo < 0 OR NEW.delivery_fee_kobo < 0 OR NEW.discount_kobo < 0 OR typeof(NEW.total_kobo) != 'integer' BEGIN SELECT RAISE(ABORT,'MALL_INVALID_ORDER'); END`,
    `CREATE TRIGGER IF NOT EXISTS mall_item_valid_${operation} BEFORE ${operation} ON mall_order_items WHEN NEW.qty <= 0 OR typeof(NEW.qty) != 'integer' OR NEW.unit_price_kobo <= 0 OR NEW.total_kobo != NEW.qty * NEW.unit_price_kobo OR NOT EXISTS(SELECT 1 FROM mall_orders WHERE id=NEW.mall_order_id) BEGIN SELECT RAISE(ABORT,'MALL_INVALID_ORDER_LINE'); END`,
    `CREATE TRIGGER IF NOT EXISTS mall_payment_valid_${operation} BEFORE ${operation} ON payments WHEN NEW.order_id IS NOT NULL AND (NEW.amount_kobo < 0 OR typeof(NEW.amount_kobo) != 'integer' OR NEW.status NOT IN ('pending','paid','failed','cancelled','refunded') OR NOT EXISTS(SELECT 1 FROM mall_orders WHERE id=NEW.order_id)) BEGIN SELECT RAISE(ABORT,'MALL_INVALID_PAYMENT'); END`,
  ]),
  `CREATE TRIGGER IF NOT EXISTS mall_order_created AFTER INSERT ON mall_orders BEGIN
    INSERT INTO mall_order_events VALUES ('created:' || NEW.id,NEW.id,'ORDER_RECEIVED','storefront','Order received',NEW.status,NEW.created_at);
    INSERT INTO notifications(id,title,message,type,is_read,link,created_at) VALUES ('mall:' || NEW.id,'New Mall order',NEW.order_no,'mall_order',0,'/sales',NEW.created_at);
    INSERT INTO mall_outbox(id,order_id,event,payload_json,next_attempt_at,created_at) VALUES ('created:' || NEW.id,NEW.id,'ORDER_RECEIVED',json_object('orderNo',NEW.order_no,'status',NEW.status),0,NEW.created_at);
  END`,
  `CREATE TRIGGER IF NOT EXISTS mall_order_audited AFTER INSERT ON audit_logs WHEN NEW.entity='MallOrder' AND EXISTS(SELECT 1 FROM mall_orders WHERE id=NEW.entity_id) BEGIN
    INSERT OR IGNORE INTO mall_order_events SELECT NEW.id,NEW.entity_id,NEW.action,NEW.actor_id,NEW.details,status,NEW.created_at FROM mall_orders WHERE id=NEW.entity_id;
    INSERT OR IGNORE INTO mall_outbox(id,order_id,event,payload_json,next_attempt_at,created_at) SELECT NEW.id,NEW.entity_id,NEW.action,json_object('orderNo',order_no,'status',status),0,NEW.created_at FROM mall_orders WHERE id=NEW.entity_id;
  END`,
  `INSERT OR IGNORE INTO mall_order_events SELECT 'created:' || id,id,'ORDER_RECEIVED','legacy','Imported original creation timestamp',status,created_at FROM mall_orders`,
  `INSERT OR IGNORE INTO mall_order_events SELECT a.id,a.entity_id,a.action,a.actor_id,a.details,o.status,a.created_at FROM audit_logs a JOIN mall_orders o ON o.id=a.entity_id WHERE a.entity='MallOrder'`,
  `INSERT OR IGNORE INTO mall_schema_versions VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
];

export function publicMallConfig(config: MallConfig = {}) {
  return {
    bank: config.MALL_BANK_NAME && config.MALL_BANK_ACCOUNT_NAME && /^\d{10}$/.test(config.MALL_BANK_ACCOUNT_NUMBER || '')
      ? { name: config.MALL_BANK_NAME, accountName: config.MALL_BANK_ACCOUNT_NAME, accountNumber: config.MALL_BANK_ACCOUNT_NUMBER } : null,
    pickup: config.MALL_PICKUP_ADDRESS && config.MALL_PICKUP_HOURS
      ? { address: config.MALL_PICKUP_ADDRESS, hours: config.MALL_PICKUP_HOURS } : null,
    checkoutEnabled: config.MALL_CHECKOUT_ENABLED === 'true',
  };
}

export function webhookConfigured(config: MallConfig) {
  try {
    const url = new URL(config.MALL_WEBHOOK_URL || '');
    return url.protocol === 'https:' && !url.username && !url.password &&
      !['localhost','127.0.0.1','[::1]'].includes(url.hostname) && (config.MALL_WEBHOOK_SECRET?.length || 0) >= 32;
  } catch { return false; }
}

/**
 * The HMAC secret is the only credential the receiver actually verifies, so it
 * is the only thing an in-process delivery needs. This is deliberately separate
 * from `webhookConfigured`: that gate also bans loopback/non-HTTPS URLs because
 * a *network* deliverer would otherwise POST to an unreachable or dev target.
 * An in-process deliverer has no network target at all (both runtimes hand the
 * drain a `send` that calls the receiver directly), so requiring a public HTTPS
 * URL there only makes local delivery impossible.
 */
export function webhookSecretReady(config: MallConfig) {
  return (config.MALL_WEBHOOK_SECRET?.length || 0) >= 32;
}

export async function mallReadiness(exec: MallExecutor) {
  const checks: Record<string, boolean> = {};
  try {
    checks.schema = (await exec.queryAll('SELECT version FROM mall_schema_versions WHERE version=?', [MALL_SCHEMA_VERSION])).length === 1;
    checks.stockTrigger = (await exec.queryAll("SELECT name FROM sqlite_master WHERE type='trigger' AND name='trg_products_no_oversell'")).length === 1;
    await exec.queryAll('SELECT o.id FROM mall_orders o JOIN mall_order_items i ON i.mall_order_id=o.id JOIN payments p ON p.order_id=o.id LIMIT 1');
    checks.database = true;
    try {
      await exec.queryAll(`SELECT ${MALL_LISTING_STATES} FROM products LIMIT 1`);
      checks.listingFields = true;
    } catch { checks.listingFields = false; }
    const expected = ['mall_write_guards','mall_checkout_attempts','mall_order_events','mall_outbox','mall_returns','mall_rate_limits','mall_metrics','idx_mall_normalized_phone','idx_mall_cart_product_unique','idx_mall_active_session','mall_order_created','mall_order_audited','mall_delivery_consistency'];
    const present=await exec.queryAll(`SELECT name FROM sqlite_master WHERE name IN (${expected.map(()=>'?').join(',')})`,expected);
    checks.schemaObjects=present.length===expected.length;
    const job = (await exec.queryAll("SELECT last_success_at FROM mall_job_runs WHERE name='maintenance'"))[0];
    checks.scheduler = !!job && Date.now() - Date.parse(job.last_success_at) < 15 * 60_000;
    checks.notifications = (await exec.queryAll("SELECT id FROM mall_outbox WHERE status='dead' OR (status!='delivered' AND created_at < ?) LIMIT 1", [new Date(Date.now()-30*60_000).toISOString()])).length === 0;
    checks.webhookDelivery = (await exec.queryAll("SELECT id FROM mall_outbox WHERE status='delivered' LIMIT 1")).length>0;
    checks.fulfilmentQueue = (await exec.queryAll("SELECT id FROM mall_orders WHERE status IN ('processing','packed','ready_for_pickup','out_for_delivery') AND created_at<? LIMIT 1",[new Date(Date.now()-48*3600_000).toISOString()])).length===0;
  } catch { checks.database = false; }
  const config = publicMallConfig(exec.config);
  checks.bank = !!config.bank; checks.pickup = !!config.pickup;
  checks.webhook = webhookConfigured(exec.config || {});
  checks.checkoutEnabled = config.checkoutEnabled;
  checks.imageStorage = !!exec.imagesConfigured;
  return { ready: Object.values(checks).every(Boolean), checks };
}

export async function mallMetrics(exec: MallExecutor) {
  return {
    readiness: await mallReadiness(exec),
    orders: await exec.queryAll('SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest FROM mall_orders GROUP BY status'),
    payments: await exec.queryAll('SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest FROM payments WHERE order_id IS NOT NULL GROUP BY status'),
    notifications: await exec.queryAll('SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest FROM mall_outbox GROUP BY status'),
    jobs: await exec.queryAll('SELECT * FROM mall_job_runs'),
    metrics: await exec.queryAll('SELECT * FROM mall_metrics ORDER BY day DESC,metric LIMIT 100'),
  };
}

/** Caller supplies a trusted runtime-derived IP. Never trust a browser header in Node. */
export const MALL_RATE_LIMITS = { checkout: 10, tracking: 5, cart: 60, catalog: 120 } as const;
/**
 * Tracking serves `GET /api/mall/orders` — a phone+order-number lookup and a
 * phone-enumeration vector — so its cap is intentionally stricter than checkout.
 * @returns the route group name for a given pathname (the caller looks up `MALL_RATE_LIMITS[group]`).
 */
export function mallRateLimitGroup(pathname: string): keyof typeof MALL_RATE_LIMITS {
  return pathname.includes('/checkout') ? 'checkout' : pathname.includes('/orders') ? 'tracking' : pathname.includes('/cart') ? 'cart' : 'catalog';
}

export function mallRateLimitFor(pathname: string): number {
  return MALL_RATE_LIMITS[mallRateLimitGroup(pathname)];
}

export async function mallRateLimit(exec: MallExecutor, request: Request) {
  if (!exec.clientIp) return;
  const path = new URL(request.url).pathname;
  const group = mallRateLimitGroup(path);
  const limit = MALL_RATE_LIMITS[group];
  const window = Math.floor(Date.now()/60_000);
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${window}:${exec.clientIp}`));
  const hash = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  const key = `${group}:${window}:${hash}`;
  const rows = await exec.queryAll(`INSERT INTO mall_rate_limits(key,count,expires_at) VALUES (?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`, [key, (window+2)*60_000]);
  const count = rows[0]?.count;
  if (count > limit) throw Object.assign(new Error('Too many requests. Please wait a minute.'),{mallStatus:429});
}

export async function signMallWebhook(secret: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
}

export async function drainMallOutbox(exec: MallExecutor, send?: typeof fetch, now = Date.now()) {
  // A caller-supplied `send` delivers in-process (both runtimes do this, so the
  // receiver never has to be reachable over the network); only its HMAC secret
  // must be present. The default global fetch is a real network call and keeps
  // the full URL gate.
  const inProcess = typeof send === 'function';
  if (!(inProcess ? webhookSecretReady(exec.config || {}) : webhookConfigured(exec.config || {}))) return;
  const deliver = send ?? fetch;
  const config = exec.config!;
  const rows = await exec.queryAll("SELECT * FROM mall_outbox WHERE (status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<?) ORDER BY created_at LIMIT 10",[now,now]);
  for (const row of rows) {
    const token = crypto.randomUUID();
    const changed = await exec.runBatch([{sql:"UPDATE mall_outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<?))",params:[token,now+120_000,row.id,now,now]}]);
    if (!changed[0]) continue;
    try {
      const order = row.order_id ? (await exec.queryAll(`SELECT o.order_no,o.customer_phone,o.customer_name,o.customer_email,o.total_kobo,o.status,
        o.delivery_address_json AS fulfilment_json,p.reference AS payment_reference,p.status AS payment_status,p.provider AS payment_method
        FROM mall_orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.id=? LIMIT 1`,[row.order_id]))[0] : null;
      const body = JSON.stringify({id:row.id,event:row.event,occurredAt:row.created_at,data:JSON.parse(row.payload_json),order, instructions:publicMallConfig(config)});
      const timestamp = String(Math.floor(Date.now()/1000));
      const response = await deliver(config.MALL_WEBHOOK_URL || 'http://localhost/api/mall-webhook',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),headers:{'content-type':'application/json','x-mall-event-id':row.id,'x-mall-timestamp':timestamp,'x-mall-signature':`sha256=${await signMallWebhook(config.MALL_WEBHOOK_SECRET!,timestamp,body)}`},body});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await response.body?.cancel();
      await exec.runBatch([{sql:"UPDATE mall_outbox SET status='delivered',delivered_at=?,lease_token=NULL,lease_until=NULL,last_error=NULL WHERE id=? AND lease_token=?",params:[new Date().toISOString(),row.id,token]}]);
    } catch (error) {
      const attempts = row.attempts + 1;
      // Persist the real cause. The old constant string made the queue
      // undiagnosable: "Webhook delivery failed" was identical for an HTTP 401,
      // a DNS failure, and a receiver that threw before answering.
      const reason = `Delivery failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
      await exec.runBatch([{sql:"UPDATE mall_outbox SET status=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL,last_error=? WHERE id=? AND lease_token=?",params:[attempts>=10?'dead':'pending',now+Math.min(3600,2**attempts*30)*1000,reason,row.id,token]}]);
    }
  }
}

export async function runMallMaintenance(exec: MallExecutor, expire: (id:string)=>Promise<Response>, send?:typeof fetch) {
  const now=Date.now();
  await exec.runBatch([{sql:"INSERT OR IGNORE INTO mall_outbox(id,event,payload_json,next_attempt_at,created_at) VALUES (?,'MALL_HEARTBEAT','{}',0,?)",params:[`heartbeat:${new Date(now).toISOString().slice(0,13)}`,new Date(now).toISOString()]}]);
  const configured=Number(exec.config?.MALL_UNPAID_EXPIRY_HOURS || 48);
  const hours=Number.isFinite(configured) && configured>=1 && configured<=720 ? configured : 48;
  const old=await exec.queryAll("SELECT o.id FROM mall_orders o WHERE o.status IN ('pending','confirmed') AND o.linked_sale_id IS NULL AND o.created_at<? ORDER BY o.created_at LIMIT 1",[new Date(now-hours*3600_000).toISOString()]);
  for(const row of old) { const response=await expire(row.id); if(!response.ok && response.status!==409) throw new Error('Unpaid order expiry failed'); }
  await exec.runBatch([
    {sql:"DELETE FROM mall_carts WHERE id IN (SELECT c.id FROM mall_carts c WHERE c.updated_at<? LIMIT 100)",params:[now-30*86400_000]},
    {sql:'DELETE FROM mall_cart_items WHERE NOT EXISTS(SELECT 1 FROM mall_carts c WHERE c.id=mall_cart_items.cart_id)'},
    {sql:'DELETE FROM mall_rate_limits WHERE expires_at<?',params:[now]},
    {sql:"DELETE FROM mall_outbox WHERE status='delivered' AND delivered_at<?",params:[new Date(now-30*86400_000).toISOString()]},
    {sql:'DELETE FROM mall_metrics WHERE day<?',params:[new Date(now-90*86400_000).toISOString().slice(0,10)]},
  ]);
  const stale=await exec.queryAll("SELECT id,order_no FROM mall_orders WHERE status IN ('processing','packed','ready_for_pickup','out_for_delivery') AND created_at<? LIMIT 50",[new Date(now-24*3600_000).toISOString()]);
  const alertStatements:MallStmt[]=stale.flatMap(row=>{
    const id=`stale:${row.id}:${new Date(now).toISOString().slice(0,10)}`;
    return [
      {sql:"INSERT OR IGNORE INTO mall_outbox(id,order_id,event,payload_json,next_attempt_at,created_at) VALUES (?,?,'STAFF_ATTENTION_REQUIRED',?,0,?)",params:[id,row.id,JSON.stringify({orderNo:row.order_no}),new Date(now).toISOString()]},
      {sql:"INSERT OR IGNORE INTO notifications(id,title,message,type,is_read,created_at) VALUES (?,'Mall order needs attention',?,'mall_order',0,?)",params:[id,row.order_no,new Date(now).toISOString()]},
    ];
  });
  if(alertStatements.length) await exec.runBatch(alertStatements);
  await drainMallOutbox(exec,send);
  await exec.runBatch([{sql:"INSERT INTO mall_job_runs(name,last_success_at) VALUES ('maintenance',?) ON CONFLICT(name) DO UPDATE SET last_success_at=excluded.last_success_at",params:[new Date().toISOString()]}]);
}