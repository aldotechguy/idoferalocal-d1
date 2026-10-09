/**
 * Customer's Hub ledger — the single source of truth for how a customer's
 * money and loyalty numbers move.
 *
 * WHY THIS EXISTS (audit 2026-10-09)
 * ----------------------------------
 * The customer metrics used to be computed inline in three different places
 * (AppContext for sale/refund/edit/delete, CustomersView for display) and the
 * formulas had drifted apart:
 *
 *   - Loyalty was `floor(lifetimeValue * rate)` in the Hub but
 *     `floor(saleAmount * rate)` per sale in the ledger, so the two never
 *     agreed and repeated partial refunds ratcheted points upward.
 *   - Settling more than owed minted hidden store credit that the modal never
 *     showed.
 *   - Deleting a customer dropped outstanding debt / store credit with no
 *     audit and no guard.
 *   - Refunding an unpaid invoice could leave phantom debt for returned stock.
 *
 * Every one of those is now a pure function here, so it can be asserted in
 * tests and can only have one implementation. Callers pass plain objects; this
 * module never touches React, storage, or the network.
 */

export interface LedgerCustomer {
  id: string;
  name: string;
  outstandingBalance: number;
  overageBalance?: number;
  loyaltyPoints: number;
  lifetimeValue: number;
  purchaseHistoryCount: number;
}

export interface LedgerSale {
  id: string;
  invoiceNo?: string;
  totalAmount: number;
  paidAmount?: number;
  createdAt?: string;
  status?: string;
}

export type PaymentSettlementMethod = 'Refund to Customer' | 'Debt Reduction' | 'Store Credit';

/** Round to kobo so floating point never leaks into stored money. */
export const round2 = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/**
 * The ONE loyalty formula. A per-sale floor, summed by the caller, is the
 * convention: `floor(a) + floor(b)` must equal the total the customer was
 * promised. Never round() — that would over-credit.
 */
export const loyaltyPointsForAmount = (amount: number, pointsPerCurrency: number): number => {
  const rate = Number(pointsPerCurrency) > 0 ? Number(pointsPerCurrency) : 0.01;
  return Math.floor(Math.max(0, Number(amount) || 0) * rate);
};

/** Walk-in / cash / guest sales are not a directory identity. */
const GUEST_NAMES = new Set(['walk-in customer', 'cash customer', 'guest customer', 'walk-in']);
export const isGuestCustomerName = (name?: string): boolean => {
  const normalized = String(name || '').trim().toLowerCase();
  return normalized === '' || GUEST_NAMES.has(normalized);
};

const paidOf = (sale: LedgerSale): number =>
  sale.paidAmount !== undefined && sale.paidAmount !== null ? Number(sale.paidAmount) || 0 : Number(sale.totalAmount) || 0;

export const unpaidOf = (sale: LedgerSale): number => Math.max(0, round2((Number(sale.totalAmount) || 0) - paidOf(sale)));

// ---------------------------------------------------------------------------
// Display aggregate — read stored truth, reconcile against the sales ledger.
// ---------------------------------------------------------------------------

export interface CustomerMetrics {
  purchaseHistoryCount: number;
  outstandingBalance: number;
  overageBalance: number;
  loyaltyPoints: number;
  lifetimeValue: number;
}

/**
 * Metrics for the Hub table. Deliberately returns the STORED values when the
 * sales ledger cannot prove a larger number: the directory must never show a
 * figure the customer does not actually hold. Sales are used only to backfill
 * legacy records whose stored counters are missing (0) — never to compete
 * with the ledger by recomputing a different formula.
 */
export function computeCustomerMetrics(
  customer: LedgerCustomer,
  sales: LedgerSale[],
  pointsPerCurrency: number,
): CustomerMetrics {
  const relevant = (sales || []).filter(
    (s) =>
      s &&
      s.status !== 'Refunded' &&
      ((s as { customerId?: string }).customerId
        ? (s as { customerId?: string }).customerId === customer.id
        : !isGuestCustomerName((s as { customerName?: string }).customerName ?? customer.name)),
  );

  const countedOrders = relevant.length;
  const storedOrders = Number(customer.purchaseHistoryCount) || 0;
  const purchaseHistoryCount = Math.max(storedOrders, countedOrders);

  const ledgerLtv = round2(relevant.reduce((sum, s) => sum + (Number(s.totalAmount) || 0), 0));
  const storedLtv = round2(Number(customer.lifetimeValue) || 0);
  const lifetimeValue = Math.max(storedLtv, ledgerLtv);

  // Points: trust the stored balance. Only a record that has never been
  // tallied (stored 0) is backfilled — and then with the shared formula.
  const storedPoints = Number(customer.loyaltyPoints) || 0;
  const backfilledPoints =
    storedPoints > 0
      ? storedPoints
      : relevant.reduce((sum, s) => sum + loyaltyPointsForAmount(Number(s.totalAmount) || 0, pointsPerCurrency), 0);
  const loyaltyPoints = Math.max(storedPoints, backfilledPoints);

  const rawBalance = Number(customer.outstandingBalance);
  const hasStoredBalance = Number.isFinite(rawBalance);
  const ledgerUnpaid = round2(relevant.reduce((sum, s) => sum + unpaidOf(s), 0));
  // Stored truth wins; the sales ledger is only a fallback for a record whose
  // stored balance is missing entirely (legacy/migrated rows).
  const outstandingBalance = hasStoredBalance ? Math.max(0, round2(rawBalance)) : ledgerUnpaid;

  return {
    purchaseHistoryCount,
    outstandingBalance,
    overageBalance: Math.max(0, round2(Number(customer.overageBalance) || 0)),
    loyaltyPoints,
    lifetimeValue,
  };
}

// ---------------------------------------------------------------------------
// C1 — deletion guard.
// ---------------------------------------------------------------------------

export type DeleteBlockReason = 'OUTSTANDING_DEBT' | 'STORE_CREDIT' | null;

export interface CustomerDeleteGuard {
  canDelete: boolean;
  reason: DeleteBlockReason;
  writtenOffDebt: number;
  writtenOffCredit: number;
}

/**
 * A customer may only be hard-deleted when the account is fully settled. Any
 * live debt or store credit must be resolved first, so the Hub can never erase
 * money the business is owed or owes.
 */
export function customerDeleteGuard(customer: LedgerCustomer): CustomerDeleteGuard {
  const debt = Math.max(0, round2(Number(customer.outstandingBalance) || 0));
  const credit = Math.max(0, round2(Number(customer.overageBalance) || 0));
  if (debt > 0) {
    return { canDelete: false, reason: 'OUTSTANDING_DEBT', writtenOffDebt: debt, writtenOffCredit: credit };
  }
  if (credit > 0) {
    return { canDelete: false, reason: 'STORE_CREDIT', writtenOffDebt: 0, writtenOffCredit: credit };
  }
  return { canDelete: true, reason: null, writtenOffDebt: 0, writtenOffCredit: 0 };
}

// ---------------------------------------------------------------------------
// C2 — settlement.
// ---------------------------------------------------------------------------

export interface ReconciledSale {
  id: string;
  invoiceNo?: string;
  newPaid: number;
  credited: number;
}

export interface SettlementResult {
  customer: LedgerCustomer;
  blocked: boolean;
  reason: 'EXCEEDS_OUTSTANDING_BALANCE' | 'NOTHING_TO_SETTLE' | null;
  appliedToDebt: number;
  creditCreated: number;
  reconciledSales: ReconciledSale[];
}

/**
 * Apply a debt payment. The payment is CLAMPED to the outstanding balance:
 * an overpayment is refused rather than quietly becoming store credit. Sales
 * are reconciled oldest-first so the invoice ledger and the customer balance
 * cannot diverge.
 */
export function settleCustomerBalance(
  customer: LedgerCustomer,
  paymentAmount: number,
  sales: LedgerSale[] = [],
): SettlementResult {
  const balance = Math.max(0, round2(Number(customer.outstandingBalance) || 0));
  const payment = round2(Number(paymentAmount) || 0);

  if (balance <= 0 || payment <= 0) {
    return {
      customer: { ...customer, outstandingBalance: balance },
      blocked: true,
      reason: 'NOTHING_TO_SETTLE',
      appliedToDebt: 0,
      creditCreated: 0,
      reconciledSales: [],
    };
  }

  const exceeds = payment > balance;
  const appliedToDebt = Math.min(payment, balance);
  const newBalance = round2(balance - appliedToDebt);

  const reconciledSales: ReconciledSale[] = [];
  let remaining = appliedToDebt;
  const ordered = [...(sales || [])]
    .filter((s) => s && unpaidOf(s) > 0)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const s of ordered) {
    if (remaining <= 0) break;
    const unpaid = unpaidOf(s);
    const credited = Math.min(remaining, unpaid);
    remaining = round2(remaining - credited);
    reconciledSales.push({
      id: s.id,
      invoiceNo: s.invoiceNo,
      newPaid: round2(paidOf(s) + credited),
      credited,
    });
  }

  return {
    customer: {
      ...customer,
      outstandingBalance: newBalance,
      // Store credit is never created by a debt settlement.
      overageBalance: Math.max(0, round2(Number(customer.overageBalance) || 0)),
    },
    blocked: exceeds,
    reason: exceeds ? 'EXCEEDS_OUTSTANDING_BALANCE' : null,
    appliedToDebt,
    creditCreated: 0,
    reconciledSales,
  };
}

// ---------------------------------------------------------------------------
// H1 — refund adjustments.
// ---------------------------------------------------------------------------

export interface RefundMetricInput {
  customer: LedgerCustomer;
  refundAmount: number;
  isFullyRefunded: boolean;
  unpaidOnSale: number;
  refundedUnpaidPortion?: number;
  overageAppliedOnSale?: number;
  pointsRate: number;
  settlementMethod: PaymentSettlementMethod;
}

export interface RefundMetricResult {
  outstandingBalance: number;
  overageBalance: number;
  lifetimeValue: number;
  purchaseHistoryCount: number;
  loyaltyPoints: number;
}

/**
 * Correct the customer's metrics for a refund. The debt correction is driven
 * by the portion of the refunded invoice that was actually unpaid — so a
 * returned, unpaid item always removes its debt instead of leaving phantom
 * balance behind.
 */
export function refundCustomerMetrics(input: RefundMetricInput): RefundMetricResult {
  const {
    customer,
    refundAmount,
    isFullyRefunded,
    unpaidOnSale,
    refundedUnpaidPortion,
    pointsRate,
    settlementMethod,
  } = input;

  const amount = Math.max(0, round2(Number(refundAmount) || 0));
  let balance = Math.max(0, round2(Number(customer.outstandingBalance) || 0));
  let overage = Math.max(0, round2(Number(customer.overageBalance) || 0));

  // How much unpaid debt does this refund erase?
  let debtRelief = 0;
  if (settlementMethod === 'Store Credit') {
    // Credit settlement deliberately does NOT reduce debt.
    overage = round2(overage + amount);
  } else if (settlementMethod === 'Debt Reduction') {
    debtRelief = Math.min(balance, amount);
    balance = round2(balance - debtRelief);
  } else if (isFullyRefunded) {
    debtRelief = Math.min(balance, Math.max(0, round2(Number(unpaidOnSale) || 0)));
    balance = round2(balance - debtRelief);
  } else {
    const returnedUnpaid = Math.max(0, round2(Number(refundedUnpaidPortion) || 0));
    debtRelief = Math.min(balance, returnedUnpaid);
    balance = round2(balance - debtRelief);
  }

  const pointsDeducted = loyaltyPointsForAmount(amount, pointsRate);

  return {
    outstandingBalance: balance,
    overageBalance: overage,
    lifetimeValue: Math.max(0, round2((Number(customer.lifetimeValue) || 0) - amount)),
    purchaseHistoryCount: isFullyRefunded
      ? Math.max(0, (Number(customer.purchaseHistoryCount) || 0) - 1)
      : Number(customer.purchaseHistoryCount) || 0,
    loyaltyPoints: Math.max(0, (Number(customer.loyaltyPoints) || 0) - pointsDeducted),
  };
}
