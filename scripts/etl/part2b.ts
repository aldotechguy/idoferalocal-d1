/** ETL 2b: products + customers. */
import { toKobo, str, num, nowIso, cleanImages, bool01 } from './lib.js';
import type { DocRow, Stmt } from './lib.js';
import type { Ctx } from './ctx.js';
import { parsePayload } from './ctx.js';
import { catalogStatus } from '../../src/shared/productStatus.js';

export function placeholder(stmts: Stmt[], ctx: Ctx, pid: string, pname: string) {
  if (!pid || ctx.productIds.has(pid)) return;
  ctx.productIds.add(pid);
  ctx.placeholderProducts++;
  stmts.push({ sql: `INSERT INTO products (id, sku, name, category_name, stock_qty, created_at, updated_at) VALUES (?, ?, ?, 'Uncategorized', 0, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [pid, pid.slice(0, 40), pname ? pname.slice(0, 120) : `Archived ${pid.slice(0, 12)}`, nowIso(), nowIso()] });
}

export function loadProducts(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  for (const d of byCol.get('products') || []) {
    const p = parsePayload(ctx, d); if (!p) continue;
    const id = str(p.id || d.docId);
    ctx.productIds.add(id);
    const catName = str(p.category, '').trim() || 'Uncategorized';
    const images = cleanImages(p.images);
    if (Array.isArray(p.images) && p.images.length > images.length) ctx.strippedImages += p.images.length - images.length;
    stmts.push({
      sql: `INSERT INTO products (id, sku, barcode, qr_code, name, description, category_id, category_name, brand, supplier_id, supplier_name, images_json, cost_price_kobo, retail_price_kobo, wholesale_price_kobo, min_wholesale_qty, dealer_price_kobo, promo_price_kobo, min_selling_price_kobo, stock_qty, low_stock_threshold, unit, expiry_date, status, is_mall_listed, mall_price_kobo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET stock_qty=excluded.stock_qty, retail_price_kobo=excluded.retail_price_kobo;`,
      params: [id, str(p.sku || id), str(p.barcode), p.qrCode ? str(p.qrCode) : null, str(p.name, 'Unnamed'), str(p.description), ctx.categoryByName.get(catName) || null, catName, str(p.brand, 'Unbranded'), p.supplierId ? str(p.supplierId) : null, str(p.supplierName, 'General Supplier'), JSON.stringify(images), toKobo(p.costPrice), toKobo(p.retailPrice), toKobo(p.wholesalePrice), num(p.minWholesaleQty, 1), p.dealerPrice != null ? toKobo(p.dealerPrice) : null, p.promotionalPrice != null ? toKobo(p.promotionalPrice) : null, toKobo(p.minimumSellingPrice), num(p.currentStock), num(p.minimumStockLevel, 5), str(p.unit, 'pcs'), p.expiryDate ? str(p.expiryDate) : null, catalogStatus(str(p.status)), bool01(p.isMallListed), p.mallPrice != null ? toKobo(p.mallPrice) : null, str(p.createdAt, nowIso()), str(p.updatedAt || p.createdAt, nowIso())],
    });
  }
}

export function loadCustomers(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  for (const d of byCol.get('customers') || []) {
    const c = parsePayload(ctx, d); if (!c) continue;
    stmts.push({
      sql: `INSERT INTO customers (id, name, phone, email, address, purchase_history_count, outstanding_balance_kobo, loyalty_points, lifetime_value_kobo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET outstanding_balance_kobo=excluded.outstanding_balance_kobo;`,
      params: [str(c.id || d.docId), str(c.name, 'Walk-in'), str(c.phone), str(c.email), c.address ? str(c.address) : null, num(c.purchaseHistoryCount), toKobo(c.outstandingBalance), num(c.loyaltyPoints), toKobo(c.lifetimeValue), str(c.createdAt, nowIso())],
    });
  }
}
