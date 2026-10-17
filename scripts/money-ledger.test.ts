/**
 * Unit coverage for the extracted AppContext money derivation
 * (src/context/moneyLedger.ts → computeTreasuryBalances). This is the assertion
 * base that lets Stryker's mutation run (docs/test-setup-runbook.md Step 10)
 * kill every mutant in the AppContext money-function slice: it pins each
 * branch — destination credit, source debit, both-account transfer, owner
 * drawing (+/- Owner Loan), repayment netting + zero floor, and 2dp rounding.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTreasuryBalances } from '../src/context/moneyLedger.ts';
import type { MoneyMovement } from '../src/types/index.ts';

let seq = 0;
function movement(partial: Partial<MoneyMovement>): MoneyMovement {
  seq += 1;
  return {
    id: `mm-test-${seq}`,
    date: '2026-01-01T00:00:00.000Z',
    type: 'Sale Inflow',
    amount: 0,
    performedBy: 'Tester',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

test('empty ledger derives zeroes', () => {
  assert.deepEqual(computeTreasuryBalances([]), {
    bizAccountBalance: 0,
    physicalCashBalance: 0,
    totalLiquidCash: 0,
    totalOwnerDrawings: 0,
    totalOwnerLoans: 0,
  });
});

test('a Sale Inflow credits only its destination account', () => {
  const cash = computeTreasuryBalances([movement({ destinationAccount: 'Physical Cash', amount: 500 })]);
  assert.equal(cash.physicalCashBalance, 500);
  assert.equal(cash.bizAccountBalance, 0);
  assert.equal(cash.totalLiquidCash, 500);

  const biz = computeTreasuryBalances([movement({ destinationAccount: 'Biz Account', amount: 700 })]);
  assert.equal(biz.bizAccountBalance, 700);
  assert.equal(biz.physicalCashBalance, 0);
  assert.equal(biz.totalLiquidCash, 700);
});

test('an outflow is debited from its source account', () => {
  const balances = computeTreasuryBalances([
    movement({ destinationAccount: 'Physical Cash', amount: 900 }),
    movement({ type: 'Expense Outflow', sourceAccount: 'Physical Cash', amount: 250 }),
  ]);
  assert.equal(balances.physicalCashBalance, 650);
  assert.equal(balances.totalLiquidCash, 650);
});

test('an Internal Transfer moves value between accounts without changing the total', () => {
  const balances = computeTreasuryBalances([
    movement({ destinationAccount: 'Physical Cash', amount: 1000 }),
    movement({ type: 'Internal Transfer', subtype: 'Till to Bank', sourceAccount: 'Physical Cash', destinationAccount: 'Biz Account', amount: 400 }),
  ]);
  assert.equal(balances.physicalCashBalance, 600);
  assert.equal(balances.bizAccountBalance, 400);
  assert.equal(balances.totalLiquidCash, 1000, 'a transfer nets to zero across both accounts');
});

test('a source-account debit on the Biz Account reduces the business balance', () => {
  const balances = computeTreasuryBalances([
    movement({ destinationAccount: 'Biz Account', amount: 1000 }),
    movement({ type: 'Supplier Payment', sourceAccount: 'Biz Account', amount: 250 }),
  ]);
  assert.equal(balances.bizAccountBalance, 750, 'the biz source debit is applied');
  assert.equal(balances.physicalCashBalance, 0);
  assert.equal(balances.totalLiquidCash, 750);
});

test('Owner Drawing debits the source and only the Owner Loan subtype counts as a loan', () => {
  const balances = computeTreasuryBalances([
    movement({ type: 'Owner Drawing', subtype: 'Owner Loan', sourceAccount: 'Physical Cash', amount: 800 }),
    movement({ type: 'Owner Drawing', subtype: 'Plain Draw', sourceAccount: 'Physical Cash', amount: 300 }),
  ]);
  assert.equal(balances.physicalCashBalance, -1100);
  assert.equal(balances.totalOwnerDrawings, 1100);
  assert.equal(balances.totalOwnerLoans, 800, 'only the Owner Loan drawing is a loan');
});

test('Owner Repayment nets the drawings/loans positions and floors at zero', () => {
  const partial = computeTreasuryBalances([
    movement({ type: 'Owner Drawing', subtype: 'Owner Loan', sourceAccount: 'Biz Account', amount: 1000 }),
    movement({ type: 'Owner Repayment', destinationAccount: 'Biz Account', amount: 400 }),
  ]);
  assert.equal(partial.totalOwnerDrawings, 600, 'drawings = gross - repayment');
  assert.equal(partial.totalOwnerLoans, 600, 'loans = gross loan - repayment');

  const clamped = computeTreasuryBalances([
    movement({ type: 'Owner Drawing', subtype: 'Owner Loan', sourceAccount: 'Biz Account', amount: 1000 }),
    movement({ type: 'Owner Repayment', destinationAccount: 'Biz Account', amount: 1500 }),
  ]);
  assert.equal(clamped.totalOwnerDrawings, 0, 'net never below zero');
  assert.equal(clamped.totalOwnerLoans, 0, 'net never below zero');
});

test('a non-owner movement never nets the owner drawing position', () => {
  // An Internal Transfer is neither an Owner Drawing nor an Owner Repayment, so
  // it must leave the owner totals untouched. A mutant that treats every
  // non-drawing movement as a repayment would silently shrink the drawings.
  const balances = computeTreasuryBalances([
    movement({ type: 'Owner Drawing', subtype: 'Owner Loan', sourceAccount: 'Physical Cash', amount: 1000 }),
    movement({ type: 'Internal Transfer', subtype: 'Till to Bank', sourceAccount: 'Physical Cash', destinationAccount: 'Biz Account', amount: 400 }),
  ]);
  assert.equal(balances.totalOwnerDrawings, 1000);
  assert.equal(balances.totalOwnerLoans, 1000);
});

test('balances are rounded to two decimals exactly as the ledger does', () => {
  // Kobo are integers, so integer sums pass either way; use naira-rate fractions
  // that expose a removed toFixed(): 200.1 + 100.2 = 300.29999999999995 raw,
  // which must round to 300.3.
  const balances = computeTreasuryBalances([
    movement({ destinationAccount: 'Biz Account', amount: 200.1 }),
    movement({ destinationAccount: 'Biz Account', amount: 100.2 }),
  ]);
  assert.equal(balances.bizAccountBalance, 300.3);
  assert.equal(balances.totalLiquidCash, 300.3);
});
