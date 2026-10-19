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
import { computeTreasuryBalances as computeTreasuryBalancesRust } from '../native-bridge/ledgerBridge.js';

/**
 * Derive the treasury balances and owner position from the full money-movement
 * ledger. Each movement's amount is credited to its destination account and
 * debited from its source account. Owner Drawing increases drawings (and loans
 * when its subtype is 'Owner Loan'); Owner Repayment nets off those positions.
 * Balances are rounded to 2dp exactly as the AppContext ledger does.
 *
 * Uses Rust when the native rollout flag is enabled; TypeScript remains active
 * by default as the compatibility path.
 */
export const computeTreasuryBalances = (
  moneyMovements: MoneyMovement[],
): TreasuryBalances => computeTreasuryBalancesRust(moneyMovements);
