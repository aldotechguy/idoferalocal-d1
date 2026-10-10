/** ETL 2a: categories + suppliers + products. */
import { toKobo, str, num, nowIso, slugify, cleanImages } from './lib.js';
import type { DocRow, Stmt } from './lib.js';
import type { Ctx } from './ctx.js';
import { parsePayload } from './ctx.js';

export function loadCategories(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  for (const d of byCol.get('products') || []) {
    const p = parsePayload(ctx, d); if (!p) continue;
    const name = str(p.category, '').trim() || 'Uncategorized';
    if (!ctx.categoryByName.has(name)) ctx.categoryByName.set(name, `cat-${slugify(name)}`);
  }
  for (const [name, id] of ctx.categoryByName)
    stmts.push({ sql: `INSERT INTO categories (id, name, slug, parent_id, image_url) VALUES (?, ?, ?, NULL, NULL) ON CONFLICT(id) DO UPDATE SET name=excluded.name;`, params: [id, name, slugify(name)] });
}

export function loadSuppliers(byCol: Map<string, DocRow[]>, stmts: Stmt[], ctx: Ctx) {
  for (const d of byCol.get('suppliers') || []) {
    const s = parsePayload(ctx, d); if (!s) continue;
    stmts.push({
      sql: `INSERT INTO suppliers (id, name, contact_person, email, phone, address, payment_terms, products_count, opening_balance_kobo, outstanding_balance_kobo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET outstanding_balance_kobo=excluded.outstanding_balance_kobo;`,
      params: [str(s.id || d.docId), str(s.name, 'Unknown Supplier'), str(s.contactPerson), str(s.email), str(s.phone), s.address ? str(s.address) : null, str(s.paymentTerms, 'Due on Receipt'), num(s.productsCount), toKobo(s.openingBalance ?? 0), toKobo(s.outstandingBalance ?? 0), str(s.createdAt, nowIso())],
    });
  }
}
