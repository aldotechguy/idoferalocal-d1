import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDelimitedLine,
  detectDelimiter,
  importKey,
  findExistingCustomerIndex,
  findExistingSupplierIndex,
  isDuplicateSaleInvoice,
} from '../src/shared/importGuards.ts';

// ---------------------------------------------------------------------------
// I1: quoted commas and apostrophes must never corrupt a row
// ---------------------------------------------------------------------------
test('I1: a comma inside quotes stays in the field', () => {
  assert.deepEqual(
    parseDelimitedLine('"12 Marina Street, Lagos",Sarah,50000'),
    ['12 Marina Street, Lagos', 'Sarah', '50000'],
  );
});

test('I1: an escaped double-quote becomes a literal quote', () => {
  assert.deepEqual(
    parseDelimitedLine('"She said ""hi""",ok'),
    ['She said "hi"', 'ok'],
  );
});

test('I1: apostrophes cannot unbalance the parser', () => {
  assert.deepEqual(
    parseDelimitedLine("O'Brien,St. John's,12"),
    ["O'Brien", "St. John's", '12'],
  );
});

test('I1: quotes are stripped and empty fields preserved', () => {
  assert.deepEqual(parseDelimitedLine('"a",,"c"'), ['a', '', 'c']);
});

// ---------------------------------------------------------------------------
// I8: tab-delimited files parse; CR line endings are handled
// ---------------------------------------------------------------------------
test('I8: a tab header selects the tab delimiter', () => {
  assert.equal(detectDelimiter('Name\tPhone\tAmount'), '\t');
  assert.equal(detectDelimiter('Name,Phone,Amount'), ',');
  assert.deepEqual(parseDelimitedLine('a\tb\tc', '\t'), ['a', 'b', 'c']);
});

// ---------------------------------------------------------------------------
// I3: re-importing the same file must not duplicate records
// ---------------------------------------------------------------------------
const customers = [
  { id: 'cust-1', name: 'Sarah Jenkins', phone: '+2348012345678', email: '', address: '', purchaseHistoryCount: 0, outstandingBalance: 0, loyaltyPoints: 0, lifetimeValue: 0, createdAt: '' },
  { id: 'cust-2', name: 'Walk-in Customer', phone: '', email: '', address: '', purchaseHistoryCount: 0, outstandingBalance: 0, loyaltyPoints: 0, lifetimeValue: 0, createdAt: '' },
];

test('I3: a customer row with a known phone matches the existing row', () => {
  assert.equal(findExistingCustomerIndex(customers as any, { name: 'Someone Else', phone: '+2348012345678' }), 0);
});

test('I3: a customer row with no phone matches by name (case-insensitive)', () => {
  assert.equal(findExistingCustomerIndex(customers as any, { name: 'sarah jenkins', phone: '' }), 0);
  assert.equal(findExistingCustomerIndex(customers as any, { name: 'Walk-In Customer', phone: '' }), 1);
});

test('I3: an unknown customer is new (-1)', () => {
  assert.equal(findExistingCustomerIndex(customers as any, { name: 'New Person', phone: '+2348000000000' }), -1);
});

const suppliers = [
  { id: 'sup-1', name: 'Global Tech', contactPerson: '', email: '', phone: '+2348033445566', paymentTerms: 'Net 30', productsCount: 0, outstandingBalance: 0, createdAt: '' },
];

test('I3: a supplier row with a known phone matches the existing row', () => {
  assert.equal(findExistingSupplierIndex(suppliers as any, { name: 'Other', phone: '+2348033445566' }), 0);
  assert.equal(findExistingSupplierIndex(suppliers as any, { name: 'Brand New Co', phone: '+2348000000001' }), -1);
});

const sales = [{ invoiceNo: 'INV-2026-901' }, { invoiceNo: 'inv-2026-902' }];

test('I3: a known invoice (any case) is a duplicate that must be skipped', () => {
  assert.equal(isDuplicateSaleInvoice(sales as any, 'INV-2026-901'), true);
  assert.equal(isDuplicateSaleInvoice(sales as any, 'INV-2026-902'), true);
  assert.equal(isDuplicateSaleInvoice(sales as any, 'INV-2026-903'), false);
  assert.equal(isDuplicateSaleInvoice(sales as any, ''), false);
  assert.equal(isDuplicateSaleInvoice(sales as any, 'N/A'), false);
  assert.equal(isDuplicateSaleInvoice(sales as any, undefined), false);
});

// ---------------------------------------------------------------------------
// importKey: the comparison primitive behind every dedup rule
// ---------------------------------------------------------------------------
test('importKey trims and case-folds', () => {
  assert.equal(importKey('  INV-2026-901  '), 'inv-2026-901');
  assert.equal(importKey(undefined), '');
  assert.equal(importKey(null), '');
});
