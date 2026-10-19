import { loadNativeModule } from './nativeLoader.js';
import { isNativeBridgeEnabled, reportNativeBridgeEvent } from './telemetry.js';
import type { MoneyMovement, TreasuryBalances } from '../types';

const nativeModule = loadNativeModule();

function computeTreasuryBalancesFallback(movements: MoneyMovement[]): TreasuryBalances {
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
}

export const isNativeLedgerAvailable = (): boolean =>
  nativeModule !== null && typeof nativeModule.nativeComputeTreasuryBalances === 'function';

export const computeTreasuryBalances = (
  moneyMovements: MoneyMovement[]
): TreasuryBalances => {
  if (isNativeLedgerAvailable() && isNativeBridgeEnabled()) {
    try {
      const rustPayload = moneyMovements.map((mv) => {
        const amount = Number(mv.amount) || 0;
        const amountCents = Math.round(amount * 100);
        if (!Number.isSafeInteger(amountCents)) throw new RangeError('Ledger amounts must convert to safe integer kobo.');
        return {
          id: mv.id,
          type: mv.type,
          subtype: mv.subtype ?? null,
          sourceAccount: mv.sourceAccount ?? null,
          destinationAccount: mv.destinationAccount ?? null,
          amount_cents: amountCents,
        };
      });

      const result = nativeModule.nativeComputeTreasuryBalances(JSON.stringify(rustPayload));
      reportNativeBridgeEvent({ bridge: 'ledger', outcome: 'native' });
      return {
        bizAccountBalance: result.bizAccountBalance,
        physicalCashBalance: result.physicalCashBalance,
        totalLiquidCash: result.totalLiquidCash,
        totalOwnerDrawings: result.totalOwnerDrawings,
        totalOwnerLoans: result.totalOwnerLoans,
      };
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'ledger', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  }

  reportNativeBridgeEvent({ bridge: 'ledger', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable' : 'native rollout disabled' });
  return computeTreasuryBalancesFallback(moneyMovements);
};
