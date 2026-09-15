/** ETL 2d-i: expenses, stock, pricing, money. */
import { toKobo, str, num, bool01, nowIso } from './lib.js';
import type { DocRow, Stmt } from './lib.js';
import type { Ctx } from './ctx.js';
import { parsePayload } from './ctx.js';
import { placeholder } from './part2b.js';

export function loadFinance(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  for (const d of byCol.get('expenses') || []) {
    const e = parsePayload(ctx, d); if (!e) continue;
    stmts.push({ sql: `INSERT INTO expenses (id, title, category, amount_kobo, description, spent_by, payment_method, date, is_historical, sale_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(e.id || d.docId), str(e.title, 'Expense'), str(e.category, 'Miscellaneous'), toKobo(e.amount), e.description ? str(e.description) : null, str(e.paidBy), str(e.paymentMethod, 'Cash'), str(e.date, nowIso()), bool01(e.isHistorical), e.saleId ? str(e.saleId) : null, str(e.createdAt, nowIso())] });
  }
  for (const d of byCol.get('stockMovements') || []) {
    const m = parsePayload(ctx, d); if (!m) continue;
    placeholder(stmts, ctx, str(m.productId), str(m.productName));
    stmts.push({ sql: `INSERT INTO stock_movements (id, product_id, product_name, type, qty, prev_stock, new_stock, ref_id, notes, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(m.id || d.docId), str(m.productId) || null, str(m.productName), str(m.type, 'Adjustment'), num(m.quantity), num(m.previousStock), num(m.newStock), m.referenceNo ? str(m.referenceNo) : null, m.notes ? str(m.notes) : null, str(m.performedBy), str(m.createdAt, nowIso())] });
  }
  for (const d of byCol.get('pricingHistory') || []) {
    const ph = parsePayload(ctx, d); if (!ph) continue;
    stmts.push({ sql: `INSERT INTO pricing_history (id, product_id, product_name, old_price_kobo, new_price_kobo, price_type, changed_by, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(ph.id || d.docId), str(ph.productId) || null, str(ph.productName), toKobo(ph.oldPrice), toKobo(ph.newPrice), str(ph.priceType, 'Retail'), str(ph.changedBy), str(ph.reason), str(ph.createdAt, nowIso())] });
  }
  for (const d of byCol.get('moneyMovements') || []) {
    const m = parsePayload(ctx, d); if (!m) continue;
    stmts.push({ sql: `INSERT INTO money_movements (id, date, type, subtype, source_account, dest_account, amount_kobo, notes, ref_no, ref_id, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING;`, params: [str(m.id || d.docId), str(m.date, nowIso()), str(m.type, 'Balance Adjustment'), m.subtype ? str(m.subtype) : null, m.sourceAccount ? str(m.sourceAccount) : null, m.destinationAccount ? str(m.destinationAccount) : null, toKobo(m.amount), m.notes ? str(m.notes) : null, m.referenceNo ? str(m.referenceNo) : null, m.referenceId ? str(m.referenceId) : null, str(m.performedBy), str(m.createdAt, nowIso())] });
  }
}
