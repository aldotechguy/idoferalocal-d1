import { loadNativeModule } from './nativeLoader.js';
import { isNativeBridgeEnabled, reportNativeBridgeEvent } from './telemetry.js';

const nativeModule = loadNativeModule();

export const isNativeMallEngineAvailable = (): boolean =>
  nativeModule !== null
    && typeof nativeModule.nativeValidateOrderTransition === 'function'
    && typeof nativeModule.nativeCalculateAmountDue === 'function'
    && typeof nativeModule.nativeVerifyOrderTotals === 'function';

export interface OrderTransitionResult {
  allowed: boolean;
  isIdempotent: boolean;
  errorMessage?: string;
}

export function validateOrderTransition(
  from: string,
  to: string
): OrderTransitionResult {
  if (isNativeMallEngineAvailable() && isNativeBridgeEnabled()) {
    try {
      const res = nativeModule.nativeValidateOrderTransition(from, to);
      reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'native' });
      return {
        allowed: res.allowed,
        isIdempotent: res.isIdempotent ?? res.is_idempotent,
        errorMessage: res.errorMessage ?? res.error_message ?? undefined,
      };
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  } else {
    reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable' : 'native rollout disabled' });
  }
  // TypeScript fallback
  if (from === to) return { allowed: true, isIdempotent: true };
  const allowed = (from === 'pending' && to === 'confirmed') ||
    (['pending', 'confirmed'].includes(from) && to === 'processing') ||
    (from === 'processing' && to === 'packed') ||
    (from === 'processing' && to === 'completed') ||
    (from === 'packed' && ['ready_for_pickup', 'out_for_delivery'].includes(to)) ||
    (['ready_for_pickup', 'out_for_delivery'].includes(from) && to === 'completed') ||
    (['pending', 'confirmed'].includes(from) && to === 'cancelled');

  return {
    allowed,
    isIdempotent: false,
    errorMessage: allowed ? undefined : `An order in ${from} state cannot move to ${to}.`,
  };
}

export function calculateAmountDueKobo(
  totalKobo: number,
  paidKobo: number,
  status: string
): number {
  if (!Number.isSafeInteger(totalKobo) || !Number.isSafeInteger(paidKobo)
    || totalKobo < 0 || paidKobo < 0) {
    throw new RangeError('Order amounts must be non-negative safe integer kobo values.');
  }
  if (isNativeMallEngineAvailable() && isNativeBridgeEnabled()) {
    try {
      const due = Number(nativeModule.nativeCalculateAmountDue(totalKobo, paidKobo, status));
      reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'native' });
      return due;
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  } else {
    reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable' : 'native rollout disabled' });
  }
  if (['cancelled', 'refunded'].includes(status)) return 0;
  if (!['pending', 'confirmed', 'processing', 'packed', 'ready_for_pickup', 'out_for_delivery', 'completed'].includes(status)) {
    throw new RangeError(`Unknown order status: ${status}`);
  }
  return Math.max(0, totalKobo - paidKobo);
}

export function verifyOrderTotals(
  subtotalKobo: number,
  discountKobo: number,
  deliveryFeeKobo: number,
  totalKobo: number
): boolean {
  if (![subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo].every(Number.isSafeInteger)
    || subtotalKobo < 0 || discountKobo < 0 || deliveryFeeKobo < 0 || totalKobo < 0
    || discountKobo > subtotalKobo) {
    reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'error', reason: 'invalid monetary invariant input' });
    return false;
  }
  if (isNativeMallEngineAvailable() && isNativeBridgeEnabled()) {
    try {
      const valid = nativeModule.nativeVerifyOrderTotals(
        subtotalKobo,
        discountKobo,
        deliveryFeeKobo,
        totalKobo
      );
      reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'native' });
      return valid;
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  } else {
    reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable' : 'native rollout disabled' });
  }
  return (subtotalKobo - discountKobo + deliveryFeeKobo) === totalKobo;
}
