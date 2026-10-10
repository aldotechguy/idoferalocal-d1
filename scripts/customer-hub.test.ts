import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  computeCustomerMetrics,
  settleCustomerBalance,
  customerDeleteGuard,
  loyaltyPointsForAmount,
  refundCustomerMetrics,
  isGuestCustomerName,
} from '../src/shared/customerLedger.ts';

/**
 * Customer's Hub regression suite (docs: audit of 2026-10-09).
 *
 * Every case below encodes a defect that shipped: it fails against the old
 * inline logic in AppContext/CustomersView and passes only once the shared
 * ledger is the single source of truth. Kept pure so it can run without a DOM.
 */

const customer = (over: Record<string, unknown> = {}) => ({
  id: 'cust-1', name: 'Apex Ltd', phone: '0803', email: '', address: '',
  purchaseHistoryCount: 0, outstandingBalance: 0, overageBalance: 0,
  loyaltyPoints: 0, lifetimeValue: 0, createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const sale = (over: Record<string, unknown> = {}) => ({
  id: 'sale-1', invoiceNo: 'INV-1', customerId: 'cust-1', customerName: 'Apex Ltd',
  type: 'Retail', items: [], subtotal: 0, discount: 0, tax: 0, deliveryFee: 0,
  totalAmount: 0, paidAmount: 0, paymentMethod: 'Cash', status: 'Completed',
  createdBy: 'tester', createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

// ---------------------------------------------------------------------------
// C1 — deleting a customer must never silently erase debt or store credit.
// ---------------------------------------------------------------------------

test('C1: a customer with outstanding debt cannot be hard-deleted without settlement', () => {
  const guard = customerDeleteGuard(customer({ outstandingBalance: 2500 }));
  assert.equal(guard.canDelete, false);
  assert.equal(guard.reason, 'OUTSTANDING_DEBT');
  assert.equal(guard.writtenOffDebt, 2500);
});

test('C1: a customer holding store credit cannot be hard-deleted without settlement', () => {
  const guard = customerDeleteGuard(customer({ overageBalance: 1000 }));
  assert.equal(guard.canDelete, false);
  assert.equal(guard.reason, 'STORE_CREDIT');
  assert.equal(guard.writtenOffCredit, 1000);
});

test('C1: a settled, zero-balance customer may still be deleted', () => {
  const guard = customerDeleteGuard(customer());
  assert.equal(guard.canDelete, true);
  assert.equal(guard.writtenOffDebt, 0);
  assert.equal(guard.writtenOffCredit, 0);
});

test('C1: deleteCustomer is wired to the guard instead of dropping the record blindly', () => {
  const source = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  assert.match(source, /customerDeleteGuard\(/, 'deleteCustomer must consult customerDeleteGuard');
  assert.match(source, /WRITE_OFF_CUSTOMER_BALANCE|writtenOffDebt/, 'delete must audit the written-off amount');
});

// ---------------------------------------------------------------------------
// C2 — settling more than owed must surface the store credit it creates.
// ---------------------------------------------------------------------------

test('C2: an exact settlement clears the debt and creates no credit', () => {
  const result = settleCustomerBalance(customer({ outstandingBalance: 1000 }), 1000);
  assert.equal(result.blocked, false);
  assert.equal(result.customer.outstandingBalance, 0);
  assert.equal(result.customer.overageBalance, 0);
  assert.equal(result.creditCreated, 0);
  assert.equal(result.appliedToDebt, 1000);
});

test('C2: an over-settlement is clamped — it must not silently mint store credit', () => {
  const result = settleCustomerBalance(customer({ outstandingBalance: 500 }), 5000);
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'EXCEEDS_OUTSTANDING_BALANCE');
  assert.equal(result.appliedToDebt, 500);
  assert.equal(result.creditCreated, 0, 'an overpayment must never become hidden store credit');
  assert.equal(result.customer.overageBalance, 0);
  assert.equal(result.customer.outstandingBalance, 0);
});

test('C2: a partial settlement leaves the remainder and creates no credit', () => {
  const result = settleCustomerBalance(customer({ outstandingBalance: 900 }), 400);
  assert.equal(result.blocked, false);
  assert.equal(result.customer.outstandingBalance, 500);
  assert.equal(result.creditCreated, 0);
});

test('C2: settlement reconciles the oldest unpaid invoices first, bounded by the payment', () => {
  const sales = [
    sale({ id: 's1', invoiceNo: 'INV-1', totalAmount: 600, paidAmount: 0, createdAt: '2026-01-01T00:00:00.000Z' }),
    sale({ id: 's2', invoiceNo: 'INV-2', totalAmount: 400, paidAmount: 0, createdAt: '2026-02-01T00:00:00.000Z' }),
  ];
  const result = settleCustomerBalance(customer({ outstandingBalance: 1000 }), 750, sales);
  assert.equal(result.appliedToDebt, 750);
  assert.equal(result.reconciledSales.length, 2);
  assert.equal(result.reconciledSales[0].newPaid, 600);
  assert.equal(result.reconciledSales[1].newPaid, 150);
  assert.equal(result.creditCreated, 0);
});

test('C2: the Hub settle modal is capped at the outstanding balance', () => {
  const source = fs.readFileSync('src/components/customers/CustomersView.tsx', 'utf8');
  assert.match(source, /max=\{Number\(settleCustomer\.outstandingBalance\)/, 'the amount input must carry an upper bound');
  assert.match(source, /settlePreview/, 'the modal must show debt vs created credit explicitly');
});

// ---------------------------------------------------------------------------
// C3 — one loyalty formula everywhere; no per-value vs per-sale drift.
// ---------------------------------------------------------------------------

test('C3: loyalty points use a per-sale floor convention, shared by every caller', () => {
  assert.equal(loyaltyPointsForAmount(1000, 0.01), 10);
  assert.equal(loyaltyPointsForAmount(1099, 0.01), 10, 'floor, never round');
  // The convention is FIXED and summable: the caller floors per sale and adds.
  // The bug was never the arithmetic — it was that the Hub recomputed from LTV
  // with a different base. Here we lock the single helper's behaviour so the
  // two call sites can only ever agree.
  const perSale = Array.from({ length: 8 }, () => loyaltyPointsForAmount(137, 0.01))
    .reduce((a, b) => a + b, 0);
  assert.equal(perSale, 8, 'per-sale floor is the authoritative convention');
  // A missing/invalid rate must fall back to the documented default, never NaN.
  assert.equal(loyaltyPointsForAmount(1000, 0), 10);
  assert.equal(loyaltyPointsForAmount(1000, Number.NaN), 10);
  assert.equal(loyaltyPointsForAmount(-500, 0.01), 0, 'a negative amount never earns points');
});

test('C3: the Hub reads the stored point total instead of recomputing a competing one', () => {
  const source = fs.readFileSync('src/components/customers/CustomersView.tsx', 'utf8');
  assert.doesNotMatch(source, /Math\.floor\(lifetimeValue \*/, 'the Hub must not recompute loyalty from LTV');
  assert.match(source, /computeCustomerMetrics\(/, 'the Hub must use the shared metric computer');
});

test('C3: every ledger mutation routes through loyaltyPointsForAmount', () => {
  const source = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  assert.doesNotMatch(source, /Math\.floor\(\s*(totalAmount|oldTotal|calculatedTotal|netRefundAmount)\s*\*\s*\(settings\.pointsPerDollar/,
    'no call site may keep its own points formula');
});

test('C3: the edit-sale previews share the same points helper as the ledger', () => {
  for (const file of ['src/components/sales/SalesView.tsx', 'src/components/sales/EditSaleModal.tsx']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /loyaltyPointsForAmount\(/, `${file} must use the shared helper`);
    assert.doesNotMatch(source, /Math\.floor\(editCalculatedTotal \*/, `${file} must not keep an inline formula`);
  }
});

// ---------------------------------------------------------------------------
// H1 — refunds must correct the debt a returned-but-unpaid invoice left behind.
// ---------------------------------------------------------------------------

test('H1: a full refund of an unpaid invoice clears the customer debt for that sale', () => {
  const result = refundCustomerMetrics({
    customer: customer({ outstandingBalance: 800, lifetimeValue: 800, purchaseHistoryCount: 1, loyaltyPoints: 8 }),
    refundAmount: 800,
    isFullyRefunded: true,
    unpaidOnSale: 800,
    overageAppliedOnSale: 0,
    pointsRate: 0.01,
    settlementMethod: 'Refund to Customer',
  });
  assert.equal(result.outstandingBalance, 0, 'the returned unpaid debt must be removed');
  assert.equal(result.lifetimeValue, 0);
  assert.equal(result.purchaseHistoryCount, 0);
  assert.equal(result.loyaltyPoints, 0);
});

test('H1: a partial refund of a partially-paid invoice reduces debt by the returned unpaid part', () => {
  const result = refundCustomerMetrics({
    customer: customer({ outstandingBalance: 500, lifetimeValue: 1000, purchaseHistoryCount: 1, loyaltyPoints: 10 }),
    refundAmount: 300,
    isFullyRefunded: false,
    unpaidOnSale: 500,
    refundedUnpaidPortion: 300,
    overageAppliedOnSale: 0,
    pointsRate: 0.01,
    settlementMethod: 'Refund to Customer',
  });
  assert.equal(result.outstandingBalance, 200, 'only the returned unpaid portion leaves the balance');
  assert.equal(result.lifetimeValue, 700);
});

test('H1: store-credit settlement adds credit instead of touching debt', () => {
  const result = refundCustomerMetrics({
    customer: customer({ outstandingBalance: 0, overageBalance: 0 }),
    refundAmount: 250,
    isFullyRefunded: false,
    unpaidOnSale: 0,
    overageAppliedOnSale: 0,
    pointsRate: 0.01,
    settlementMethod: 'Store Credit',
  });
  assert.equal(result.overageBalance, 250);
  assert.equal(result.outstandingBalance, 0);
});

// ---------------------------------------------------------------------------
// H2 — delete must unlink every customer reference, not just sales.
// ---------------------------------------------------------------------------

test('H2: deletion unlinks delivery orders and WhatsApp pre-orders, not just sales', () => {
  const source = fs.readFileSync('src/context/AppContext.tsx', 'utf8');
  const deleteFn = source.slice(source.indexOf('const deleteCustomer ='));
  const body = deleteFn.slice(0, deleteFn.indexOf('// Supplier Management'));
  assert.match(body, /setDeliveryOrders\(/, 'delivery orders must be relinked on delete');
  assert.match(body, /setWhatsAppPreOrders\(/, 'WhatsApp pre-orders must be relinked on delete');
  assert.match(body, /customerDeleteGuard\(/, 'the guard must gate the hard delete');
});

// ---------------------------------------------------------------------------
// Guard rails — the Hub's aggregate view must match stored truth.
// ---------------------------------------------------------------------------

test('the Hub aggregate returns the stored balance when sales agree with it', () => {
  const metrics = computeCustomerMetrics(
    customer({ outstandingBalance: 300, loyaltyPoints: 12, lifetimeValue: 1200, purchaseHistoryCount: 2 }),
    [sale({ totalAmount: 600, paidAmount: 300 }), sale({ id: 'sale-2', totalAmount: 600, paidAmount: 600 })],
    0.01,
  );
  assert.equal(metrics.outstandingBalance, 300);
  assert.equal(metrics.lifetimeValue, 1200);
  assert.equal(metrics.loyaltyPoints, 12, 'displayed points equal stored points');
  assert.equal(metrics.purchaseHistoryCount, 2);
});

test('a walk-in / guest sale never accrues loyalty or debt against the directory', () => {
  assert.equal(isGuestCustomerName('Walk-in Customer'), true);
  assert.equal(isGuestCustomerName('cash customer'), true);
  assert.equal(isGuestCustomerName(''), true);
  assert.equal(isGuestCustomerName('Apex Ltd'), false);
});
