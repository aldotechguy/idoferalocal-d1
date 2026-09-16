/** Phase 4 — snapshot builder: raw table rows -> frontend D1Snapshot (part 4/4). */
import { KoboToNaira, n, b, parseJsonArray } from './relationalMapper.js';
import { productRow, customerRow, supplierRow, saleRow, purchaseRow } from './relationalMapper.js';
import type { QueryAll, Snapshot } from './relationalMapper.js';

export async function buildSnapshot(q: QueryAll): Promise<Snapshot> {
  const [productRows, customerRows, supplierRows, saleRows, saleItemRows, purchaseRows, purchaseItemRows, recvRows, expenseRows, stockRows, pricingRows, moneyRows, deliveryRows, heldRows, wapoRows, notifRows, auditRows, settingsRows] = await Promise.all([
    q('SELECT * FROM products ORDER BY updated_at DESC'),
    q('SELECT * FROM customers ORDER BY created_at DESC'),
    q('SELECT * FROM suppliers ORDER BY created_at DESC'),
    q('SELECT * FROM sales ORDER BY created_at DESC'),
    q('SELECT * FROM sale_items'),
    q('SELECT * FROM purchases ORDER BY created_at DESC'),
    q('SELECT * FROM purchase_items'),
    q('SELECT * FROM receiving_history'),
    q('SELECT * FROM expenses ORDER BY date DESC'),
    q('SELECT * FROM stock_movements ORDER BY created_at DESC'),
    q('SELECT * FROM pricing_history ORDER BY created_at DESC'),
    q('SELECT * FROM money_movements ORDER BY date DESC'),
    q('SELECT * FROM delivery_orders ORDER BY created_at DESC'),
    q('SELECT * FROM held_orders ORDER BY created_at DESC'),
    q('SELECT * FROM whatsapp_preorders ORDER BY created_at DESC'),
    q('SELECT * FROM notifications ORDER BY created_at DESC'),
    q('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 1500'),
    q('SELECT * FROM settings'),
  ]);
  const itemsBySale = new Map<string, any[]>();
  for (const it of saleItemRows) {
    const k = String((it as any).sale_id);
    if (!itemsBySale.has(k)) itemsBySale.set(k, []);
    itemsBySale.get(k)!.push(it);
  }
  const itemsByPo = new Map<string, any[]>();
  for (const it of purchaseItemRows) {
    const k = String((it as any).purchase_id);
    if (!itemsByPo.has(k)) itemsByPo.set(k, []);
    itemsByPo.get(k)!.push(it);
  }
  const recvByPo = new Map<string, any[]>();
  for (const g of recvRows) {
    const k = String((g as any).purchase_id);
    if (!recvByPo.has(k)) recvByPo.set(k, []);
    recvByPo.get(k)!.push(g);
  }
  return {
    products: productRows.map(productRow),
    customers: customerRows.map(customerRow),
    suppliers: supplierRows.map(supplierRow),
    sales: saleRows.map((r) => saleRow(r, itemsBySale)),
    purchases: purchaseRows.map((r) => purchaseRow(r, itemsByPo, recvByPo)),
    expenses: expenseRows.map((r: any) => ({ id: r.id, title: r.title, category: r.category, amount: KoboToNaira(r.amount_kobo), description: r.description || undefined, paidBy: r.spent_by || '', paymentMethod: r.payment_method || 'Cash', date: r.date, createdAt: r.created_at, isHistorical: b(r.is_historical) || undefined, saleId: r.sale_id || undefined })),
    stockMovements: stockRows.map((r: any) => ({ id: r.id, productId: r.product_id, productName: r.product_name, type: r.type, quantity: n(r.qty), previousStock: n(r.prev_stock), newStock: n(r.new_stock), referenceNo: r.ref_id || undefined, notes: r.notes || undefined, performedBy: r.performed_by || '', createdAt: r.created_at })),
    pricingHistory: pricingRows.map((r: any) => ({ id: r.id, productId: r.product_id, productName: r.product_name, oldPrice: KoboToNaira(r.old_price_kobo), newPrice: KoboToNaira(r.new_price_kobo), priceType: r.price_type || 'Retail', changedBy: r.changed_by || '', reason: r.reason || '', createdAt: r.created_at })),
    moneyMovements: moneyRows.map((r: any) => ({ id: r.id, date: r.date, type: r.type, subtype: r.subtype || undefined, sourceAccount: r.source_account || undefined, destinationAccount: r.dest_account || undefined, amount: KoboToNaira(r.amount_kobo), notes: r.notes || undefined, referenceNo: r.ref_no || undefined, referenceId: r.ref_id || undefined, performedBy: r.performed_by || '', createdAt: r.created_at })),
    settings: settingsRows.map((r: any) => {
      try {
        const v = JSON.parse(r.value_json);
        return typeof v === 'object' && v !== null ? v : { id: r.key, value: v };
      } catch { return { id: r.key, value: r.value_json }; }
    }),
    notifications: notifRows.map((r: any) => ({ id: r.id, title: r.title, message: r.message, type: r.type, read: b(r.is_read), createdAt: r.created_at })),
    auditLogs: auditRows.map((r: any) => ({ id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id || undefined, performedBy: r.actor_id || '', details: r.details || '', createdAt: r.created_at })),
    deliveryOrders: deliveryRows.map((r: any) => ({ id: r.id, deliveryNo: r.delivery_no, saleId: r.sale_id || '', invoiceNo: r.invoice_no || '', customerId: r.customer_id || undefined, customerName: r.customer_name || '', deliveryAddress: r.delivery_address || undefined, items: parseJsonArray(r.items_json), deliveryFee: KoboToNaira(r.delivery_fee_kobo), status: r.status || 'Pending Pickup', isPickupConfirmed: b(r.is_pickup_confirmed), createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at || undefined })),
    heldOrders: heldRows.map((r: any) => {
      try {
        const cart = JSON.parse(r.cart_json || '{}');
        return { id: r.id, ...(cart as object), heldBy: r.held_by, createdAt: r.created_at };
      } catch { return { id: r.id, heldBy: r.held_by, createdAt: r.created_at }; }
    }),
    whatsAppPreOrders: wapoRows.map((r: any) => ({ id: r.id, preOrderNo: r.preorder_no, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || '', items: parseJsonArray(r.items_json), subtotal: KoboToNaira(r.subtotal_kobo), totalAmount: KoboToNaira(r.total_kobo), status: r.status || 'Pending Review', convertedSaleId: r.converted_sale_id || undefined, createdBy: r.created_by || '', createdAt: r.created_at, updatedAt: r.updated_at || undefined })),
  };
}
