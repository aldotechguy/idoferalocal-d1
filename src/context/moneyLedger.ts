/**
 * Pure money-ledger derivations, extracted from AppContext's TreasuryBalances
 * useMemo (the only money math in a 5,500-line React component) so mutation
 * testing can target the money functions in isolation.
 *
 * SCOPE: this is the "money functions of src/context/AppContext.tsx" slice of the
 * Stryker configuration (docs/test-setup-runbook.md Step 10). Behaviour is
 * identical to the AppContext useMemo it replaces: a movement's amount is
 * credited to its destination account and debited from its source, and the owner
 * position sums drawings/loans/repayments the same way. Every mutant here is
 * exercised via src/context/moneyLedger.test.ts plus the shared
 * money-invariants / money-flow suites.
 */
import type { MoneyMovement, TreasuryBalances } from '../types';

/**
 * Derive the treasury balances and owner position from the full money-movement
 * ledger. Each movement's amount is credited to its destination account and
 * debited from its source account. Owner Drawing increases drawings (and loans
 * when its subtype is 'Owner Loan'); Owner Repayment nets off those positions.
 * Balances are rounded to 2dp exactly as the AppContext ledger does.
 */
export const computeTreasuryBalances = (
  moneyMovements: MoneyMovement[],
): TreasuryBalances => {
  let biz = 0;
  let cash = 0;
  let grossOwnerDrawings = 0;
  let grossOwnerLoans = 0;
  let ownerRepayments = 0;

  moneyMovements.forEach((mv) => {
    const amt = Number(mv.amount) || 0;
    if (mv.destinationAccount === 'Biz Account') {
      biz += amt;
    } else if (mv.destinationAccount === 'Physical Cash') {
      cash += amt;
    }

    if (mv.sourceAccount === 'Biz Account') {
      biz -= amt;
    } else if (mv.sourceAccount === 'Physical Cash') {
      cash -= amt;
    }

    if (mv.type === 'Owner Drawing') {
      grossOwnerDrawings += amt;
      if (mv.subtype === 'Owner Loan') {
        grossOwnerLoans += amt;
      }
    } else if (mv.type === 'Owner Repayment') {
      ownerRepayments += amt;
    }
  });

  const netOwnerDrawings = Math.max(0, grossOwnerDrawings - ownerRepayments);
  const netOwnerLoans = Math.max(0, grossOwnerLoans - ownerRepayments);

  return {
    bizAccountBalance: Number(biz.toFixed(2)),
    physicalCashBalance: Number(cash.toFixed(2)),
    totalLiquidCash: Number((biz + cash).toFixed(2)),
    totalOwnerDrawings: Number(netOwnerDrawings.toFixed(2)),
    totalOwnerLoans: Number(netOwnerLoans.toFixed(2)),
  };
};
