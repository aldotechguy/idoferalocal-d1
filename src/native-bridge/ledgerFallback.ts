import type { MoneyMovement, TreasuryBalances } from '../types';

/** Web-safe implementation used when the frontend bundles the shared ledger module. */
export const computeTreasuryBalances = (movements: MoneyMovement[]): TreasuryBalances => {
  let biz = 0;
  let cash = 0;
  let drawings = 0;
  let loans = 0;
  let repayments = 0;
  for (const movement of movements) {
    const amount = Number(movement.amount) || 0;
    if (movement.destinationAccount === 'Biz Account') biz += amount;
    if (movement.destinationAccount === 'Physical Cash') cash += amount;
    if (movement.sourceAccount === 'Biz Account') biz -= amount;
    if (movement.sourceAccount === 'Physical Cash') cash -= amount;
    if (movement.type === 'Owner Drawing') {
      drawings += amount;
      if (movement.subtype === 'Owner Loan') loans += amount;
    }
    if (movement.type === 'Owner Repayment') repayments += amount;
  }
  return {
    bizAccountBalance: Number(biz.toFixed(2)),
    physicalCashBalance: Number(cash.toFixed(2)),
    totalLiquidCash: Number((biz + cash).toFixed(2)),
    totalOwnerDrawings: Number(Math.max(0, drawings - repayments).toFixed(2)),
    totalOwnerLoans: Number(Math.max(0, loans - repayments).toFixed(2)),
  };
};
