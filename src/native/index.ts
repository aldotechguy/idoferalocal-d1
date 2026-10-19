/**
 * Native Rust bridge — typed wrappers around the napi-rs compiled binary.
 *
 * The `.node` addon is loaded lazily so that the rest of the app can still
 * import this module even when the Rust binary hasn't been built yet (e.g.
 * during local TS-only dev).  In that case every call falls back to a
 * `null` return value and throws a clear error message.
 *
 * Build the binary first:
 *   cd native && cargo build --release -p binding_napi
 * Then copy / symlink:
 *   native/target/release/binding_napi.dll  →  src/native/binding_napi.node
 */

import { loadNativeModule } from '../native-bridge/nativeLoader.js';

// ---------------------------------------------------------------------------
// Types mirroring the Rust structs
// ---------------------------------------------------------------------------

export interface TreasuryBalances {
  bizAccountBalance: number;
  physicalCashBalance: number;
  totalLiquidCash: number;
  totalOwnerDrawings: number;
  totalOwnerLoans: number;
}

export interface MoneyMovementInput {
  id: string;
  type: string;          // MoneyMovementType serde rename
  subtype?: string | null;
  sourceAccount?: string | null;
  destinationAccount?: string | null;
  /** Integer cents / kobo — no floats */
  amount_cents: number;
}

export interface SqlStmt {
  sql: string;
  params: unknown[];     // deserialized from params_json
}

export interface OrderTransitionResult {
  allowed: boolean;
  isIdempotent: boolean;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Lazy native module loader
// ---------------------------------------------------------------------------

const _native = loadNativeModule();

function native(): Record<string, (...args: unknown[]) => unknown> {
  if (_native) return _native;
  throw new Error(
    '[native/index.ts] Rust addon not found. Run `npm run build:native` or set IDOFERA_NATIVE_ADDON.',
  );
}

// ---------------------------------------------------------------------------
// Public typed API
// ---------------------------------------------------------------------------

/**
 * Computes treasury balances from an array of money movements.
 * All arithmetic is done in integer kobo/cents inside Rust — zero float error.
 */
export function computeTreasuryBalances(
  movements: MoneyMovementInput[]
): TreasuryBalances {
  const raw = native().nativeComputeTreasuryBalances(
    JSON.stringify(movements)
  ) as {
    bizAccountBalance: number;
    physicalCashBalance: number;
    totalLiquidCash: number;
    totalOwnerDrawings: number;
    totalOwnerLoans: number;
  };

  return {
    bizAccountBalance: raw.bizAccountBalance,
    physicalCashBalance: raw.physicalCashBalance,
    totalLiquidCash: raw.totalLiquidCash,
    totalOwnerDrawings: raw.totalOwnerDrawings,
    totalOwnerLoans: raw.totalOwnerLoans,
  };
}

/**
 * Plans the SQL batch (INSERT … ON CONFLICT DO UPDATE) for a Firestore
 * document write.  Returns null for unknown collections.
 */
export function planCoreUpsert(
  collection: string,
  document: Record<string, unknown>,
  now: string
): SqlStmt[] | null {
  const raw = native().nativePlanCoreUpsert(
    collection,
    JSON.stringify(document),
    now
  ) as Array<{ sql: string; paramsJson: string }> | null;

  if (!raw) return null;
  return raw.map((s) => ({
    sql: s.sql,
    params: JSON.parse(s.paramsJson) as unknown[],
  }));
}

/**
 * Plans the SQL batch for a Firestore document delete (cascade aware).
 * Returns null for unknown collections.
 */
export function planCoreDelete(
  collection: string,
  documentId: string
): SqlStmt[] | null {
  const raw = native().nativePlanCoreDelete(
    collection,
    documentId
  ) as Array<{ sql: string; paramsJson: string }> | null;

  if (!raw) return null;
  return raw.map((s) => ({
    sql: s.sql,
    params: JSON.parse(s.paramsJson) as unknown[],
  }));
}

/**
 * Validates a mall order status transition using the Rust finite state machine.
 */
export function validateOrderTransition(
  from: string,
  to: string
): OrderTransitionResult {
  const raw = native().nativeValidateOrderTransition(from, to) as {
    allowed: boolean;
    isIdempotent: boolean;
    errorMessage: string | null;
  };
  return {
    allowed: raw.allowed,
    isIdempotent: raw.isIdempotent,
    errorMessage: raw.errorMessage ?? null,
  };
}

/**
 * Calculates remaining kobo due on an order.  Always returns 0 for
 * cancelled / refunded orders.
 */
export function calculateAmountDue(
  totalKobo: number,
  paidKobo: number,
  status: string
): number {
  return native().nativeCalculateAmountDue(totalKobo, paidKobo, status) as number;
}

/**
 * Verifies the order total invariant:
 *   total === subtotal − discount + deliveryFee
 * Throws if the invariant is violated.
 */
export function verifyOrderTotals(
  subtotalKobo: number,
  discountKobo: number,
  deliveryFeeKobo: number,
  totalKobo: number
): void {
  native().nativeVerifyOrderTotals(subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo);
}
