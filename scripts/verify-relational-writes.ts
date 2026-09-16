/**
 * Phase 4d — relational write-path verification.
 * Proves the SAME code server.ts and sites-worker.ts call produces a matching
 * frontend snapshot, and that delete / full-replace / document-backfill behave.
 */
import { DatabaseSync } from 'node:sqlite';
import { makeNodeAdapter, ensureRelationalSchemaNode } from '../src/server/nodeAdapter.js';
import { buildSnapshot } from '../src/server/relationalSnapshot.js';
import {
  upsertToStatements,
  deleteToStatements,
  replaceCollectionStatements,
  backfillStatementsFromDocumentRows,
} from '../src/server/relationalWrites.js';
import { cleanImageList, imageUrlList, rawImageList, base64ImageCount } from '../src/server/relationalMapper.js';

const db = new DatabaseSync(':memory:');
ensureRelationalSchemaNode(db);
const tx = makeNodeAdapter(db);
const apply = (stmts: { sql: string; params?: any[] }[]) => {
  db.exec('BEGIN;');
  try {
    for (const st of stmts) tx.run(st.sql, st.params || []);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
};

const now = new Date().toISOString();
const product = {
  id: 'prod-1', name: 'Test Bag', sku: 'SKU-1', category: 'Packaging', supplierId: 'sup-1',
  costPrice: 100.5, retailPrice: 150.25, wholesalePrice: 120, minimumSellingPrice: 110,
  currentStock: 42, minimumStockLevel: 5, unit: 'pcs', status: 'Active',
  images: ['data:image/png;base64,AAA', 'https://cdn.example.com/bag.png'], createdAt: now, updatedAt: now,
};
const customer = { id: 'cust-1', name: 'Ada', phone: '08030000000', outstandingBalance: 2500, loyaltyPoints: 12 };
const supplier = { id: 'sup-1', name: 'Acme', contactPerson: 'Ngozi', outstandingBalance: 9000, openingBalance: 5000 };
const sale = {
  id: 'sale-1', invoiceNo: 'INV-TEST-1', customerId: 'cust-1', status: 'Completed',
  subtotal: 300.5, discount: 0.5, tax: 0, totalAmount: 300, paidAmount: 300, paymentMethod: 'Cash',
  createdAt: now,
  items: [
    { productId: 'prod-1', qty: 2, unitPrice: 150.25, costPrice: 100.5, total: 300.5 },
    { productId: 'missing-prod', qty: 1, unitPrice: 10, costPrice: 5, total: 10 },
  ],
};
const purchase = {
  id: 'po-1', poNumber: 'PO-TEST-1', supplierId: 'sup-1', status: 'Received', paymentStatus: 'Partial',
  subtotal: 1000, totalAmount: 1000, paidAmount: 400, createdAt: now,
  items: [{ productId: 'prod-1', qty: 10, unitCost: 100, total: 1000, received: 10 }],
  receivingHistory: [{ id: 'rh-1', receivedAt: now, receivedBy: 'Admin', items: [] }],
};

const cases: [string, any][] = [
  ['products', product], ['customers', customer], ['suppliers', supplier],
  ['sales', sale], ['purchases', purchase],
  ['expenses', { id: 'exp-1', category: 'Transport', amount: 55.5, date: now }],
  ['stockMovements', { id: 'sm-1', productId: 'prod-1', type: 'sale', quantity: -2, createdAt: now }],
  ['pricingHistory', { id: 'ph-1', productId: 'prod-1', oldPrice: 140, newPrice: 150.25, createdAt: now }],
  ['moneyMovements', { id: 'mm-1', type: 'deposit', amount: 1000, createdAt: now }],
  ['notifications', { id: 'n-1', title: 'Low stock', message: 'SKU-1', read: false, createdAt: now }],
  ['auditLogs', { id: 'al-1', action: 'create', entity: 'sale', entityId: 'sale-1', createdAt: now }],
  ['settings', { id: 'singleton', businessName: 'Idofera', currency: 'NGN' }],
  ['heldOrders', { id: 'ho-1', items: [product], createdAt: now }],
  ['deliveryOrders', { id: 'do-1', deliveryNo: 'DLV-1', customerId: 'cust-1', status: 'Pending', createdAt: now }],
  ['whatsAppPreOrders', { id: 'wp-1', preOrderNo: 'WP-1', customerName: 'Ada', status: 'Pending', createdAt: now }],
];
for (const [collection, document] of cases) apply(upsertToStatements(collection, document, now));
console.log(`wrote ${cases.length} collections`);
const snap = await buildSnapshot(tx.queryAll);
const expectCollections = [
  'products', 'customers', 'suppliers', 'sales', 'purchases', 'expenses',
  'stockMovements', 'pricingHistory', 'moneyMovements', 'notifications',
  'auditLogs', 'settings', 'heldOrders', 'deliveryOrders', 'whatsAppPreOrders',
];
const missing = expectCollections.filter((c) => !(snap as any)[c] || !(snap as any)[c].length);
if (missing.length) throw new Error(`snapshot missing collections: ${missing.join(', ')}`);

const roundProduct = (snap.products as any[])[0];
const roundSale = (snap.sales as any[])[0];
console.log('product name/stock:', roundProduct.name, roundProduct.currentStock);
console.log('sale total/paid:', roundSale.totalAmount, roundSale.paidAmount, 'items:', roundSale.items.length);
if (roundProduct.currentStock !== 42) throw new Error('product stock mismatch');
if (Math.abs(roundSale.totalAmount - 300) > 0.001) throw new Error(`sale total mismatch: ${roundSale.totalAmount}`);
if (roundSale.items.length !== 2) throw new Error('sale items not preserved');

// Image policy (single-sourced in relationalMapper.cleanImageList):
// `data:` base64 uploads CANNOT enter relational storage — D1 rejects oversized
// statements (SQLITE_TOOBIG) and base64 would bloat every snapshot push. The POS
// thumbnail for the 11 legacy base64 products is restored in Phase 4.5 by uploading
// the originals (extracted to backups/images/ by scripts/etl/extract-images.ts) to
// R2 and rewriting products.images_json. Hosted URLs are preserved verbatim.
const roundImages: string[] = roundProduct.images || [];
console.log('images after write:', JSON.stringify(roundImages).slice(0, 120));
if (roundImages.some((u) => u.startsWith('data:'))) throw new Error('base64 leaked into relational products');
if (!roundImages.includes('https://cdn.example.com/bag.png')) throw new Error('hosted image URL lost');
const urlOnly = imageUrlList(['data:image/png;base64,AAA', 'https://cdn.example.com/bag.png', '/local/x.png']);
if (urlOnly.length !== 2 || urlOnly[0] !== 'https://cdn.example.com/bag.png') {
  throw new Error(`mall image projection wrong: ${JSON.stringify(urlOnly)}`);
}
if (cleanImageList(['  ', null, 7, 'https://a/b.png', 'data:image/png;base64,AAA']).length !== 1) {
  throw new Error('cleanImageList should drop non-strings, blanks and base64');
}
const rawImages = rawImageList(['data:image/png;base64,AAA', 'https://a/b.png']);
if (rawImages.length !== 2 || base64ImageCount(rawImages) !== 1) {
  throw new Error('rawImageList/base64ImageCount must see the extracted originals');
}
console.log('image policy:', JSON.stringify(roundImages), '| mall projection:', JSON.stringify(urlOnly));

const raw = await tx.queryAll('SELECT total_kobo, subtotal_kobo, discount_kobo FROM sales WHERE id = ?', ['sale-1']);
console.log('sale kobo:', JSON.stringify(raw[0]));
if ((raw[0] as any).total_kobo !== 30000) throw new Error('kobo conversion mismatch');

// Full-replace semantics (the PUT /api/storage/snapshot path).
apply(replaceCollectionStatements('sales', [{ ...sale, id: 'sale-2', invoiceNo: 'INV-TEST-2', totalAmount: 111 }], now));
const afterReplace = await tx.queryAll('SELECT COUNT(*) AS n FROM sales');
const afterItems = await tx.queryAll('SELECT COUNT(*) AS n FROM sale_items');
if ((afterReplace[0] as any).n !== 1) throw new Error('full replace did not clear old rows');
if ((afterItems[0] as any).n !== 2) throw new Error('full replace left stray sale_items');
console.log('full-replace sales rows:', (afterReplace[0] as any).n, 'sale_items:', (afterItems[0] as any).n);
const replaced = await tx.queryAll('SELECT total_kobo FROM sales WHERE id = ?', ['sale-2']);
if ((replaced[0] as any).total_kobo !== 11100) throw new Error('replaced sale total mismatch');

// Delete semantics (the PATCH deletes path).
apply(deleteToStatements('sales', 'sale-2'));
const afterDelete = await tx.queryAll('SELECT (SELECT COUNT(*) FROM sales) AS s, (SELECT COUNT(*) FROM sale_items) AS i');
if ((afterDelete[0] as any).s !== 0 || (afterDelete[0] as any).i !== 0) throw new Error('delete left orphan child rows');
console.log('delete cascaded: sales=0 sale_items=0');

// Document -> relational backfill (legacy bridge; same helper in both runtimes).
const backfillDb = new DatabaseSync(':memory:');
ensureRelationalSchemaNode(backfillDb);
const btx = makeNodeAdapter(backfillDb);
const { stmts, skipped } = backfillStatementsFromDocumentRows(
  [
    { collection: 'products', payload: JSON.stringify(product) },
    { collection: 'products', payload: JSON.stringify({ ...product, currentStock: 99 }) },
    { collection: 'test_coll', payload: JSON.stringify({ id: 'junk' }) },
    { collection: 'sales', payload: '{not json' },
    { collection: 'sales', payload: JSON.stringify({ id: 'sale-bf-1', invoiceNo: 'INV-BF-1', totalAmount: 10, createdAt: now, items: [{ productId: 'missing-prod', qty: 1, unitPrice: 10, total: 10 }] }) },
  ],
  now,
);
backfillDb.exec('BEGIN;');
for (const st of stmts) btx.run(st.sql, st.params);
backfillDb.exec('COMMIT;');
const bSnap = await buildSnapshot(btx.queryAll);
const bProducts = bSnap.products as any[];
const bProd1 = bProducts.find((p) => p.id === 'prod-1');
console.log('backfill stmts:', stmts.length, 'skipped:', skipped, 'stock(last wins):', bProd1?.currentStock);
if (bProd1?.currentStock !== 99) throw new Error('backfill last-write-wins failed');
const bPlaceholder = bProducts.find((p) => p.name === 'Archived missing-prod');
if (!bPlaceholder) throw new Error('backfill did not synthesize Archived-* placeholder for orphan line item');
if (skipped !== 1) throw new Error(`expected 1 skipped malformed payload, got ${skipped}`);

console.log('PHASE4-WRITE-VERIFY OK');