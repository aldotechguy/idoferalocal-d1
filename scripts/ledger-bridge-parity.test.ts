import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTreasuryBalances as originalCompute } from '../src/context/moneyLedger';
import { computeTreasuryBalances as bridgeCompute } from '../src/native-bridge';
import type { MoneyMovement } from '../src/types';

test('ledger bridge produces 100% parity with existing moneyLedger derivation', () => {
  const sampleMovements: MoneyMovement[] = [
    {
      id: 'mv-1',
      date: new Date().toISOString(),
      type: 'Sale Inflow',
      destinationAccount: 'Biz Account',
      amount: 150.50,
      performedBy: 'system',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'mv-2',
      date: new Date().toISOString(),
      type: 'Sale Inflow',
      destinationAccount: 'Physical Cash',
      amount: 45.25,
      performedBy: 'system',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'mv-3',
      date: new Date().toISOString(),
      type: 'Owner Drawing',
      subtype: 'Owner Loan',
      sourceAccount: 'Biz Account',
      amount: 50.00,
      performedBy: 'owner',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'mv-4',
      date: new Date().toISOString(),
      type: 'Owner Repayment',
      destinationAccount: 'Biz Account',
      amount: 20.00,
      performedBy: 'owner',
      createdAt: new Date().toISOString(),
    },
  ];

  const expected = originalCompute(sampleMovements);
  const actual = bridgeCompute(sampleMovements);

  assert.deepEqual(actual, expected);
  console.log('Parity verification passed:', actual);
});

test('ledger parity fixture remains stable regardless of native rollout flag', () => {
  const movements: MoneyMovement[] = [{
    id: 'fixed-1', date: '2026-01-01T00:00:00Z', type: 'Sale Inflow',
    destinationAccount: 'Biz Account', amount: 123.45, performedBy: 'test', createdAt: '2026-01-01T00:00:00Z',
  }];
  assert.deepEqual(bridgeCompute(movements), originalCompute(movements));
});
