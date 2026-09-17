import type { MallExecutor, MallStmt } from './mallApi.js';
import { n, s } from './relationalMapper.js';

export type StaffActor = { id: string; displayName: string; role: string };

type DomainError = Error & { status?: number };
const fail = (status: number, message: string): never => {
  const error = new Error(message) as DomainError;
  error.status = status;
  throw error;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});
const uuid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const ACTIVE_STATUSES = new Set(['pending', 'confirmed', 'processing', 'packed', 'ready_for_pickup', 'out_for_delivery']);

function canOperate(actor: StaffActor) {
  return ['Administrator', 'Store Manager', 'Sales Staff'].includes(actor.role);
}

function publicPayment(row: any) {
  let metadata: Record<string, unknown> = {};
  try { metadata = row?.payment_raw_json ? JSON.parse(row.payment_raw_json) : {}; } catch { /* malformed legacy metadata */ }
  return {
    id: s(row?.payment_id),
    provider: s(row?.payment_provider, 'pay_on_pickup'),
    reference: s(row?.payment_reference),
    amountKobo: n(row?.payment_amount_kobo),
    status: s(row?.payment_status, 'pending'),
    metadata,
  };
}

function publicOrder(row: any, items: any[] = []) {
  let delivery: Record<string, unknown> = {};
  try { delivery = row.delivery_address_json ? JSON.parse(row.delivery_address_json) : {}; } catch { /* malformed legacy data */ }
  const payment = publicPayment(row);
  return {
    id: s(row.id), orderNo: s(row.order_no), customerId: s(row.customer_id) || undefined,
    customerName: s(row.customer_name), customerPhone: s(row.customer_phone), status: s(row.status, 'pending'),
    subtotalKobo: n(row.subtotal_kobo), deliveryFeeKobo: n(row.delivery_fee_kobo),
    discountKobo: n(row.discount_kobo), totalKobo: n(row.total_kobo), linkedSaleId: s(row.linked_sale_id) || undefined,
    delivery, payment, createdAt: s(row.created_at), itemCount: n(row.item_count),
    items: items.map((item) => ({
      id: s(item.id), productId: s(item.product_id), name: s(item.product_name), sku: s(item.sku),
      unit: s(item.unit, 'pcs'), qty: n(item.qty), unitPriceKobo: n(item.unit_price_kobo),
      costPriceKobo: n(item.cost_price_kobo), totalKobo: n(item.total_kobo),
    })),
  };
}

const ORDER_SELECT = `SELECT o.*,
  COUNT(DISTINCT oi.id) AS item_count,
  p.id AS payment_id, p.provider AS payment_provider, p.reference AS payment_reference,
  p.amount_kobo AS payment_amount_kobo, p.status AS payment_status, p.raw_json AS payment_raw_json
  FROM mall_orders o
  LEFT JOIN mall_order_items oi ON oi.mall_order_id = o.id
  LEFT JOIN payments p ON p.order_id = o.id`;

async function getOrderRow(exec: MallExecutor, id: string) {
  const rows = await exec.queryAll(`${ORDER_SELECT} WHERE o.id = ? GROUP BY o.id LIMIT 1`, [id]);
  if (!rows.length) fail(404, 'Mall order not found.');
  return rows[0];
}

async function getOrderItems(exec: MallExecutor, id: string) {
  return exec.queryAll(`SELECT oi.*, COALESCE(p.sku, '') AS sku, COALESCE(p.unit, 'pcs') AS unit,
    COALESCE(p.cost_price_kobo, 0) AS cost_price_kobo
    FROM mall_order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.mall_order_id = ? ORDER BY oi.rowid`, [id]);
}

async function listOrders(exec: MallExecutor, url: URL) {
  const status = s(url.searchParams.get('status')).trim();
  const q = s(url.searchParams.get('q')).trim().slice(0, 80);
  const limit = Math.min(Math.max(n(url.searchParams.get('limit'), 50), 1), 100);
  const offset = Math.max(n(url.searchParams.get('offset'), 0), 0);
  const filters: string[] = [];
  const params: any[] = [];
  if (status && status !== 'all') { filters.push('o.status = ?'); params.push(status); }
  if (q) {
    filters.push('(o.order_no LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
    const like = `%${q}%`; params.push(like, like, like);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await exec.queryAll(`${ORDER_SELECT} ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const total = await exec.queryAll(`SELECT COUNT(*) AS n FROM mall_orders o ${where}`, params);
  return json({ orders: rows.map((row) => publicOrder(row)), total: n(total[0]?.n), limit, offset });
}

async function counts(exec: MallExecutor) {
  const rows = await exec.queryAll(`SELECT status, COUNT(*) AS count FROM mall_orders GROUP BY status`);
  const byStatus = Object.fromEntries(rows.map((row) => [s(row.status), n(row.count)]));
  const actionable = rows.reduce((sum, row) => sum + (ACTIVE_STATUSES.has(s(row.status)) ? n(row.count) : 0), 0);
  return json({ byStatus, actionable });
}

async function detail(exec: MallExecutor, id: string) {
  const row = await getOrderRow(exec, id);
  return json({ order: publicOrder(row, await getOrderItems(exec, id)) });
}

async function confirmOrder(exec: MallExecutor, id: string, actor: StaffActor) {
  if (!canOperate(actor)) fail(403, 'You do not have permission to confirm Mall orders.');
  const row = await getOrderRow(exec, id);
  const status = s(row.status);
  if (status === 'confirmed') return detail(exec, id);
  if (status !== 'pending') fail(409, `An order in ${status} state cannot be confirmed.`);
  const at = nowIso();
  await exec.runBatch([
    { sql: `UPDATE mall_orders SET status = 'confirmed' WHERE id = ? AND status = 'pending'`, params: [id] },
    { sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'CONFIRM_MALL_ORDER', 'MallOrder', ?, ?, ?)`, params: [`audit-${uuid()}`, actor.id, id, `${actor.displayName} confirmed ${s(row.order_no)}.`, at] },
  ]);
  return detail(exec, id);
}

async function cancelOrder(exec: MallExecutor, id: string, actor: StaffActor, body: any) {
  if (!['Administrator', 'Store Manager'].includes(actor.role)) fail(403, 'Manager access is required to cancel Mall orders.');
  const row = await getOrderRow(exec, id);
  const status = s(row.status);
  if (status === 'cancelled') return detail(exec, id);
  if (s(row.linked_sale_id) || ['completed', 'refunded'].includes(status)) fail(409, 'Paid or completed orders must use the refund workflow.');
  if (!ACTIVE_STATUSES.has(status)) fail(409, `An order in ${status} state cannot be cancelled.`);
  const items = await getOrderItems(exec, id);
  const reason = s(body?.reason, 'Cancelled by staff').trim().slice(0, 300);
  const at = nowIso();
  const stmts: MallStmt[] = [{
    sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'CANCEL_MALL_ORDER', 'MallOrder', ?, ?, ?)`,
    params: [`audit-cancel-${id}`, actor.id, id, `${actor.displayName} cancelled ${s(row.order_no)} and restored committed stock. Reason: ${reason}`, at],
  }];
  for (const item of items) {
    stmts.push({ sql: 'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?', params: [n(item.qty), at, item.product_id] });
    stmts.push({
      sql: `INSERT INTO stock_movements (id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at)
        VALUES (?, ?, ?, 'Returned', ?, (SELECT stock_qty - ? FROM products WHERE id = ?), (SELECT stock_qty FROM products WHERE id = ?), ?, ?, ?, ?)`,
      params: [`mv-${uuid()}`, item.product_id, item.product_name, n(item.qty), n(item.qty), item.product_id, item.product_id, `cancel:${id}`, `Cancelled Mall order ${s(row.order_no)}: ${reason}`, actor.displayName, at],
    });
  }
  stmts.push({ sql: `UPDATE mall_orders SET status = 'cancelled' WHERE id = ? AND status = ?`, params: [id, status] });
  stmts.push({ sql: `UPDATE payments SET status = 'cancelled', raw_json = ? WHERE order_id = ? AND status = 'pending'`, params: [JSON.stringify({ orderNo: row.order_no, cancellationReason: reason, cancelledBy: actor.displayName, cancelledAt: at }), id] });
  try {
    await exec.runBatch(stmts);
  } catch (error) {
    const concurrent = await exec.queryAll('SELECT status FROM mall_orders WHERE id = ? LIMIT 1', [id]);
    if (s(concurrent[0]?.status) === 'cancelled') return detail(exec, id);
    throw error;
  }
  return detail(exec, id);
}

function paymentDestination(method: string) {
  return method === 'Cash' ? 'Physical Cash' : 'Biz Account';
}

function deliveryData(row: any): Record<string, any> {
  try { return row.delivery_address_json ? JSON.parse(row.delivery_address_json) : {}; } catch { return {}; }
}

async function finalizePayment(exec: MallExecutor, id: string, actor: StaffActor, body: any, transferOnly: boolean) {
  const allowed = transferOnly
    ? ['Administrator', 'Store Manager', 'Accountant'].includes(actor.role)
    : canOperate(actor);
  if (!allowed) fail(403, 'You do not have permission to record this payment.');
  const row = await getOrderRow(exec, id);
  if (s(row.linked_sale_id)) return detail(exec, id);
  const status = s(row.status);
  if (status === 'cancelled') fail(409, 'Cancelled orders cannot be paid.');
  if (!['pending', 'confirmed'].includes(status)) fail(409, `An order in ${status} state cannot be paid.`);
  const items = await getOrderItems(exec, id);
  if (!items.length) fail(409, 'This order has no items.');
  const method = transferOnly ? 'Bank Transfer' : s(body?.paymentMethod, 'Cash');
  if (!['Cash', 'Card', 'Mobile Transfer', 'Bank Transfer'].includes(method)) fail(400, 'Unsupported payment method.');
  const amountKobo = Math.round(n(body?.amountKobo, row.total_kobo));
  if (amountKobo < n(row.total_kobo)) fail(400, 'The payment amount must cover the order total.');
  const at = nowIso();
  // Deterministic identities make concurrent/retried settlement physically unable to create duplicate Sales.
  const saleId = `sale-${id}`;
  const invoiceNo = `INV-${s(row.order_no).replace(/^MALL-/, '')}`;
  const normalizedPhone = s(row.customer_phone).replace(/\D/g, '').slice(-10);
  const customers = normalizedPhone ? await exec.queryAll(`SELECT * FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')','') LIKE ? LIMIT 1`, [`%${normalizedPhone}`]) : [];
  const customer = customers[0];
  const customerId = customer?.id || `cust-${id}`;
  const paymentBreakdown = body?.paymentBreakdown && typeof body.paymentBreakdown === 'object' ? body.paymentBreakdown : null;
  const reference = s(body?.reference, row.payment_reference || `MALL-${row.order_no}`).slice(0, 120);
  const stmts: MallStmt[] = [];
  if (!customer) {
    stmts.push({
      sql: `INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at) VALUES (?, ?, ?, '', ?, 1, 0, ?, ?, ?)`,
      params: [customerId, row.customer_name, row.customer_phone, s(deliveryData(row).address) || null, Math.floor(n(row.total_kobo) / 10_000), row.total_kobo, at],
    });
  }
  stmts.push({
    sql: `INSERT INTO sales (id, receipt_no, customer_id, customer_name, type, subtotal_kobo, discount_kobo, tax_kobo, delivery_fee_kobo, total_kobo, paid_kobo, payment_method, payment_breakdown_json, status, notes, created_by, order_taken_by, is_historical, expense_id, created_at)
      VALUES (?, ?, ?, ?, 'Retail', ?, ?, 0, ?, ?, ?, ?, ?, 'Completed', ?, ?, 'Mall Storefront', 0, NULL, ?)`,
    params: [saleId, invoiceNo, customerId, row.customer_name, row.subtotal_kobo, row.discount_kobo, row.delivery_fee_kobo, row.total_kobo, row.total_kobo, method, paymentBreakdown ? JSON.stringify(paymentBreakdown) : null, `Converted from Mall order ${row.order_no}.`, actor.displayName, at],
  });
  items.forEach((item, index) => stmts.push({
    sql: `INSERT INTO sale_items (id, sale_id, product_id, product_name, sku, qty, unit_price_kobo, cost_price_kobo, total_kobo, is_wholesale, is_clearance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    params: [`${saleId}-item-${index}`, saleId, item.product_id, item.product_name, item.sku, item.qty, item.unit_price_kobo, item.cost_price_kobo, item.total_kobo],
  }));
  stmts.push({ sql: `UPDATE payments SET sale_id = ?, provider = ?, reference = ?, amount_kobo = ?, status = 'paid', raw_json = ? WHERE order_id = ?`, params: [saleId, method, reference, row.total_kobo, JSON.stringify({ orderNo: row.order_no, verifiedBy: actor.displayName, verifiedAt: at, paymentBreakdown }), id] });
  stmts.push({ sql: `UPDATE mall_orders SET linked_sale_id = ?, customer_id = ?, status = 'processing', payment_ref = ? WHERE id = ? AND linked_sale_id IS NULL`, params: [saleId, customerId, reference, id] });
  stmts.push({ sql: `INSERT INTO money_movements (id, date, type, subtype, source_account, dest_account, amount_kobo, notes, ref_no, ref_id, performed_by, created_at) VALUES (?, ?, 'Sale Inflow', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`, params: [`mm-${saleId}`, at, method, paymentDestination(method), row.total_kobo, `Mall order payment for ${row.order_no}`, invoiceNo, saleId, actor.displayName, at] });
  if (customer) stmts.push({ sql: `UPDATE customers SET purchase_history_count = purchase_history_count + 1, lifetime_value_kobo = lifetime_value_kobo + ?, loyalty_points = loyalty_points + ? WHERE id = ?`, params: [row.total_kobo, Math.floor(n(row.total_kobo) / 10_000), customer.id] });
  stmts.push({ sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'CONVERT_MALL_ORDER_SALE', 'MallOrder', ?, ?, ?)`, params: [`audit-${uuid()}`, actor.id, id, `${actor.displayName} converted ${row.order_no} to ${invoiceNo} via ${method}.`, at] });
  try {
    await exec.runBatch(stmts);
  } catch (error) {
    const concurrent = await exec.queryAll('SELECT linked_sale_id FROM mall_orders WHERE id = ? LIMIT 1', [id]);
    if (s(concurrent[0]?.linked_sale_id)) return detail(exec, id);
    throw error;
  }
  return detail(exec, id);
}

const STATUS_ACTIONS: Record<string, { from: string[]; to: string }> = {
  'start-processing': { from: ['confirmed'], to: 'processing' },
  'mark-packed': { from: ['processing'], to: 'packed' },
  'mark-ready': { from: ['packed'], to: 'ready_for_pickup' },
  'mark-out-for-delivery': { from: ['packed'], to: 'out_for_delivery' },
  complete: { from: ['ready_for_pickup', 'out_for_delivery'], to: 'completed' },
};

async function transitionOrder(exec: MallExecutor, id: string, actor: StaffActor, action: string) {
  if (!canOperate(actor)) fail(403, 'You do not have permission to update fulfilment.');
  const transition = STATUS_ACTIONS[action];
  if (!transition) fail(404, 'Unknown Mall order action.');
  const row = await getOrderRow(exec, id);
  const status = s(row.status);
  if (status === transition.to) return detail(exec, id);
  if (!transition.from.includes(status)) fail(409, `An order in ${status} state cannot move to ${transition.to}.`);
  if (!s(row.linked_sale_id)) fail(409, 'Payment must be recorded before fulfilment continues.');
  const at = nowIso();
  const stmts: MallStmt[] = [
    { sql: 'UPDATE mall_orders SET status = ? WHERE id = ? AND status = ?', params: [transition.to, id, status] },
    { sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'UPDATE_MALL_ORDER_STATUS', 'MallOrder', ?, ?, ?)`, params: [`audit-${uuid()}`, actor.id, id, `${actor.displayName} moved ${s(row.order_no)} from ${status} to ${transition.to}.`, at] },
  ];
  if (action === 'mark-out-for-delivery') {
    const items = await getOrderItems(exec, id);
    const invoice = await exec.queryAll('SELECT receipt_no FROM sales WHERE id = ? LIMIT 1', [row.linked_sale_id]);
    const delivery = deliveryData(row);
    const saleItems = items.map((item) => ({ productId: item.product_id, productName: item.product_name, sku: item.sku, quantity: n(item.qty), unitPrice: n(item.unit_price_kobo) / 100, costPrice: n(item.cost_price_kobo) / 100, total: n(item.total_kobo) / 100 }));
    stmts.push({
      sql: `INSERT OR IGNORE INTO delivery_orders (id, delivery_no, sale_id, invoice_no, customer_id, customer_name, customer_phone, delivery_address, items_json, delivery_fee_kobo, status, is_pickup_confirmed, courier_notes, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Pickup', 0, NULL, ?, ?, ?, ?)`,
      params: [`del-${id}`, `DEL-${s(row.order_no).replace(/^MALL-/, '')}`, row.linked_sale_id, s(invoice[0]?.receipt_no), row.customer_id, row.customer_name, row.customer_phone, s(delivery.address), JSON.stringify(saleItems), row.delivery_fee_kobo, `Created from Mall order ${row.order_no}. ${s(delivery.note)}`, actor.displayName, at, at],
    });
  }
  await exec.runBatch(stmts);
  return detail(exec, id);
}

async function refundOrder(exec: MallExecutor, id: string, actor: StaffActor, body: any) {
  if (!['Administrator', 'Accountant'].includes(actor.role)) fail(403, 'Administrator or Accountant access is required to refund an order.');
  const row = await getOrderRow(exec, id);
  if (s(row.status) === 'refunded') return detail(exec, id);
  if (!s(row.linked_sale_id) || s(row.payment_status) !== 'paid') fail(409, 'Only paid Mall orders can be refunded.');
  const items = await getOrderItems(exec, id);
  const returnStock = body?.returnStock !== false;
  const reason = s(body?.reason, 'Customer refund').trim().slice(0, 300);
  const at = nowIso();
  const stmts: MallStmt[] = [{ sql: `UPDATE mall_orders SET status = 'refunded' WHERE id = ?`, params: [id] }];
  stmts.push({ sql: `UPDATE payments SET status = 'refunded', raw_json = ? WHERE order_id = ?`, params: [JSON.stringify({ orderNo: row.order_no, refundedBy: actor.displayName, refundedAt: at, reason, returnStock }), id] });
  stmts.push({ sql: `UPDATE sales SET status = 'Refunded', notes = COALESCE(notes, '') || ? WHERE id = ?`, params: [` | Refunded from Mall: ${reason}`, row.linked_sale_id] });
  stmts.push({ sql: `INSERT INTO money_movements (id, date, type, subtype, source_account, dest_account, amount_kobo, notes, ref_no, ref_id, performed_by, created_at) VALUES (?, ?, 'Refund Outflow', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, params: [`mm-refund-${row.linked_sale_id}`, at, s(row.payment_provider), paymentDestination(s(row.payment_provider)), s(row.payment_provider), row.total_kobo, reason, row.order_no, row.linked_sale_id, actor.displayName, at] });
  if (row.customer_id) stmts.push({ sql: `UPDATE customers SET purchase_history_count = MAX(0, purchase_history_count - 1), lifetime_value_kobo = MAX(0, lifetime_value_kobo - ?), loyalty_points = MAX(0, loyalty_points - ?) WHERE id = ?`, params: [row.total_kobo, Math.floor(n(row.total_kobo) / 10_000), row.customer_id] });
  if (returnStock) for (const item of items) {
    stmts.push({ sql: 'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE id = ?', params: [item.qty, at, item.product_id] });
    stmts.push({ sql: `INSERT INTO stock_movements (id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at) VALUES (?, ?, ?, 'Returned', ?, (SELECT stock_qty - ? FROM products WHERE id = ?), (SELECT stock_qty FROM products WHERE id = ?), ?, ?, ?, ?)`, params: [`mv-refund-${id}-${item.id}`, item.product_id, item.product_name, item.qty, item.qty, item.product_id, item.product_id, `refund:${id}`, reason, actor.displayName, at] });
  }
  stmts.push({ sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'REFUND_MALL_ORDER', 'MallOrder', ?, ?, ?)`, params: [`audit-refund-${id}`, actor.id, id, `${actor.displayName} refunded ${row.order_no}. ${reason}`, at] });
  try { await exec.runBatch(stmts); } catch (error) {
    const concurrent = await exec.queryAll('SELECT status FROM mall_orders WHERE id = ?', [id]);
    if (s(concurrent[0]?.status) === 'refunded') return detail(exec, id);
    throw error;
  }
  return detail(exec, id);
}

async function parseBody(request: Request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleStaffMallApi(request: Request, exec: MallExecutor, actor: StaffActor): Promise<Response> {
  try {
    const url = new URL(request.url, 'http://localhost');
    const prefix = '/api/staff/mall-orders';
    const tail = url.pathname.slice(prefix.length).replace(/^\//, '');
    const parts = tail ? tail.split('/') : [];
    if (request.method === 'GET' && parts.length === 0) return await listOrders(exec, url);
    if (request.method === 'GET' && parts[0] === 'counts') return await counts(exec);
    if (request.method === 'GET' && parts.length === 1) return await detail(exec, decodeURIComponent(parts[0]));
    if (request.method === 'POST' && parts.length === 2) {
      const id = decodeURIComponent(parts[0]);
      const body = await parseBody(request);
      if (parts[1] === 'confirm') return await confirmOrder(exec, id, actor);
      if (parts[1] === 'cancel') return await cancelOrder(exec, id, actor, body);
      if (parts[1] === 'collect-payment') return await finalizePayment(exec, id, actor, body, false);
      if (parts[1] === 'verify-payment') return await finalizePayment(exec, id, actor, body, true);
      if (parts[1] === 'refund') return await refundOrder(exec, id, actor, body);
      if (STATUS_ACTIONS[parts[1]]) return await transitionOrder(exec, id, actor, parts[1]);
    }
    return json({ error: 'Unknown staff Mall order route.' }, 404);
  } catch (error) {
    const known = error as DomainError;
    return json({ error: error instanceof Error ? error.message : 'Mall order operation failed.' }, known.status || 500);
  }
}