import test from 'node:test';
import assert from 'node:assert/strict';
import { isNativeRelationalAvailable, planCoreUpsert, planCoreDelete } from '../src/native-bridge';
import { coreDelete as coreDeleteTS, coreUpsert as coreUpsertTS } from '../src/server/relationalWritesCore';

test('native relational planner is built and active when rollout is enabled', () => {
  if (process.env.IDOFERA_NATIVE_ENABLED === 'true') {
    assert.equal(isNativeRelationalAvailable(), true, 'Native relational addon must be active for the opt-in run');
  }
});

test('planCoreUpsert generates correct statements for customers', () => {
  const customerDoc = {
    id: 'cust-parity-1',
    name: 'Ada Lovelace',
    phone: '+2348011112222',
    email: 'ada@example.com',
    outstandingBalance: 1250.75,
    loyaltyPoints: 100,
    lifetimeValue: 50000.0,
    createdAt: '2026-10-19T00:00:00.000Z',
  };

  const stmts = planCoreUpsert('customers', customerDoc, '2026-10-19T00:00:00.000Z');
  assert.ok(stmts && stmts.length === 1);
  assert.ok(stmts[0].sql.includes('INSERT INTO customers'));
  assert.ok(stmts[0].sql.includes('ON CONFLICT(id) DO UPDATE SET'));
  assert.equal(stmts[0].params[0], 'cust-parity-1');
  console.log('Customer upsert planned successfully via Rust:', stmts[0].sql.slice(0, 80) + '...');
});

test('sales and purchases use native planner with TypeScript-identical SQL and parameters', async () => {
  const { upsertToStatements } = await import('../src/server/relationalWrites');
  const now = '2026-10-19T00:00:00Z';
  const documents = [
    ['products', {
      id: 'product-parity', name: 'Item', sku: 'A', category: ' Groceries & Food ',
      costPrice: 10, retailPrice: 20, images: [' https://img.test/a ', 'data:image/png;base64,drop'],
      mallFeatured: true, createdAt: now, updatedAt: now,
    }],
    ['customers', {
      id: 'customer-parity', name: 'Ada', outstandingBalance: 12.5, lifetimeValue: 200,
      overageBalance: 1, createdAt: now,
    }],
    ['suppliers', {
      id: 'supplier-parity', name: 'Supplier', outstandingBalance: 45, paymentTerms: 'Net 30', createdAt: now,
    }],
    ['sales', {
      id: 'sale-parity', invoiceNo: 'N/A', customerId: 'cust-1', customerName: 'Ada',
      subtotal: 30, discount: 0, tax: 0, deliveryFee: 0, totalAmount: 30, paidAmount: 10,
      paymentMethod: 'Cash', createdAt: now, updatedAt: now,
      items: [{ productId: 'prod-1', productName: 'Item', sku: 'A', quantity: 2, unitPrice: 15, costPrice: 10, total: 30, returnedQuantity: 1 }],
    }],
    ['purchases', {
      id: 'purchase-parity', poNumber: 'PO-1', supplierId: 'sup-1', supplierName: 'Acme',
      deliveryFee: 2, localLogisticsFee: 1, totalAmount: 53, paidAmount: 10, createdAt: now,
      items: [{ productId: 'prod-1', productName: 'Item', sku: 'A', quantity: 2, unitCost: 25, total: 50, receivedQuantity: 2, acceptedQuantity: 1, damagedQuantity: 1, shortageQuantity: 1, excessQuantity: 0 }],
      receivingHistory: [{ grnNumber: 'GRN-1', receivedBy: 'Admin', receivedAt: now, itemsReceived: [{ productId: 'prod-1', quantityReceived: 2 }] }],
    }],
  ] as const;
  for (const [collection, document] of documents) {
    const expected = coreUpsertTS(collection, document);
    const actual = upsertToStatements(collection, document, now);
    assert.deepEqual(actual, expected, `${collection} SQL/parameters must retain exact TS parity`);
  }
});

test('planCoreDelete matches TypeScript cascade delete SQL', () => {
  const collections = ['products', 'customers', 'suppliers', 'sales', 'purchases'];
  for (const col of collections) {
    const tsStmts = coreDeleteTS(col, 'test-id-123');
    const nativeStmts = planCoreDelete(col, 'test-id-123');
    assert.deepEqual(nativeStmts, tsStmts, `Delete statement mismatch for collection: ${col}`);
  }
  console.log('All delete cascades verified with 100% parity across products, customers, suppliers, sales, purchases!');
});
