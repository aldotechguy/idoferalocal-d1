import { loadNativeModule } from './nativeLoader.js';
import { isNativeBridgeEnabled, reportNativeBridgeEvent } from './telemetry.js';
import {
  isRemoteEngineConfigured,
  remoteCalculateAmountDueKobo,
  remoteValidateOrderTransition,
  remoteVerifyOrderTotals,
  type RemoteEngineConfig,
} from './remoteEngine.js';

const nativeModule = loadNativeModule();

let remoteConfig: RemoteEngineConfig | null = null;

/**
 * Whether the remote engine is currently believed to answer. Configured is
 * optimistic: a failed call marks it 'unreachable' and the bridge stays on the
 * TypeScript path until /api/health probes it again. This avoids paying a
 * network timeout on every staff action while the service is down.
 */
let remoteStatus: 'unconfigured' | 'configured' | 'unreachable' = 'unconfigured';

/**
 * Point the bridge at the Rust HTTP service (the Worker's production path).
 * Passing null disables delegation and restores the TypeScript implementation.
 */
export function configureRemoteMoneyEngine(config: RemoteEngineConfig | null | undefined): void {
  remoteConfig = isRemoteEngineConfigured(config) ? config! : null;
  remoteStatus = remoteConfig ? 'configured' : 'unconfigured';
}

export const getRemoteMoneyEngineConfig = (): RemoteEngineConfig | null => remoteConfig;
export const getRemoteEngineStatus = (): typeof remoteStatus => remoteStatus;

/** Health probes call this after a successful round-trip. */
export function markRemoteEngineReachable(): void {
  if (remoteConfig) remoteStatus = 'configured';
}

/** A failed call marks the engine down so later requests use TypeScript directly. */
export function markRemoteEngineUnreachable(): void {
  if (remoteConfig) remoteStatus = 'unreachable';
}

export const isRemoteMoneyEngineAvailable = (): boolean =>
  isNativeBridgeEnabled() && isRemoteEngineConfigured(remoteConfig) && remoteStatus === 'configured';

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

// --- Synchronous, TypeScript-only variants (Workers prohibit I/O after await) ---
// The async functions below call the remote engine. Cloudflare Workers forbid a
// subrequest after any `await`, so code that must write to D1 afterwards uses
// the pure-TS helpers instead of awaiting the engine mid-transaction.

export const validateOrderTransitionSync = (from: string, to: string): OrderTransitionResult =>
  fallbackTransition(from, to);

export const calculateAmountDueKoboPure = (totalKobo: number, paidKobo: number, status: string): number => {
  if (!Number.isSafeInteger(totalKobo) || !Number.isSafeInteger(paidKobo)
    || totalKobo < 0 || paidKobo < 0) {
    throw new RangeError('Order amounts must be non-negative safe integer kobo values.');
  }
  return fallbackAmountDue(totalKobo, paidKobo, status);
};

export const verifyOrderTotalsSync = (
  subtotalKobo: number,
  discountKobo: number,
  deliveryFeeKobo: number,
  totalKobo: number,
): boolean => {
  if (![subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo].every(Number.isSafeInteger)
    || subtotalKobo < 0 || discountKobo < 0 || deliveryFeeKobo < 0 || totalKobo < 0
    || discountKobo > subtotalKobo) return false;
  return (subtotalKobo - discountKobo + deliveryFeeKobo) === totalKobo;
};

function fallbackReason(): string {
  if (!isNativeBridgeEnabled()) return 'native rollout disabled';
  if (nativeModule) return 'native addon unavailable';
  if (!remoteConfig) return 'no native engine configured';
  return 'remote engine unavailable';
}

async function useRemote(): Promise<RemoteEngineConfig | null> {
  if (!isNativeBridgeEnabled() || !isRemoteEngineConfigured(remoteConfig)) return null;
  if (remoteStatus === 'unreachable') return null;
  return remoteConfig;
}

/** Record the outcome of a remote call so a dead service stops costing latency. */
function noteRemoteOutcome(answered: boolean): void {
  if (answered) markRemoteEngineReachable();
  else markRemoteEngineUnreachable();
}


export async function validateOrderTransition(
  from: string,
  to: string
): Promise<OrderTransitionResult> {
  const remote = await useRemote();
  if (remote) {
    const result = await remoteValidateOrderTransition(remote, from, to);
    if (result) {
      noteRemoteOutcome(true);
      reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'native', reason: 'remote-service' });
      return {
        allowed: result.allowed,
        isIdempotent: result.isIdempotent,
        errorMessage: result.errorMessage ?? undefined,
      };
    }
    noteRemoteOutcome(false);
    reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'fallback', reason: 'remote engine failed' });
    return fallbackTransition(from, to);
  }

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
    reportNativeBridgeEvent({ bridge: 'mall-transition', outcome: 'fallback', reason: fallbackReason() });
  }
  return fallbackTransition(from, to);
}

function fallbackTransition(from: string, to: string): OrderTransitionResult {
  // TypeScript fallback (parity-tested against the Rust engine)
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

export async function calculateAmountDueKobo(
  totalKobo: number,
  paidKobo: number,
  status: string
): Promise<number> {
  if (!Number.isSafeInteger(totalKobo) || !Number.isSafeInteger(paidKobo)
    || totalKobo < 0 || paidKobo < 0) {
    throw new RangeError('Order amounts must be non-negative safe integer kobo values.');
  }
  const remote = await useRemote();
  if (remote) {
    const due = await remoteCalculateAmountDueKobo(remote, totalKobo, paidKobo, status);
    if (due !== null) {
      noteRemoteOutcome(true);
      reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'native', reason: 'remote-service' });
      return due;
    }
    noteRemoteOutcome(false);
    reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'fallback', reason: 'remote engine failed' });
    return fallbackAmountDue(totalKobo, paidKobo, status);
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
    reportNativeBridgeEvent({ bridge: 'mall-amount-due', outcome: 'fallback', reason: fallbackReason() });
  }
  return fallbackAmountDue(totalKobo, paidKobo, status);
}

function fallbackAmountDue(totalKobo: number, paidKobo: number, status: string): number {
  if (['cancelled', 'refunded'].includes(status)) return 0;
  if (!['pending', 'confirmed', 'processing', 'packed', 'ready_for_pickup', 'out_for_delivery', 'completed'].includes(status)) {
    throw new RangeError(`Unknown order status: ${status}`);
  }
  return Math.max(0, totalKobo - paidKobo);
}

export async function verifyOrderTotals(
  subtotalKobo: number,
  discountKobo: number,
  deliveryFeeKobo: number,
  totalKobo: number
): Promise<boolean> {
  if (![subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo].every(Number.isSafeInteger)
    || subtotalKobo < 0 || discountKobo < 0 || deliveryFeeKobo < 0 || totalKobo < 0
    || discountKobo > subtotalKobo) {
    reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'error', reason: 'invalid monetary invariant input' });
    return false;
  }
  const remote = await useRemote();
  if (remote) {
    const valid = await remoteVerifyOrderTotals(remote, subtotalKobo, discountKobo, deliveryFeeKobo, totalKobo);
    if (valid !== null) {
      noteRemoteOutcome(true);
      reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'native', reason: 'remote-service' });
      return valid;
    }
    noteRemoteOutcome(false);
    reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'fallback', reason: 'remote engine failed' });
    return (subtotalKobo - discountKobo + deliveryFeeKobo) === totalKobo;
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
    reportNativeBridgeEvent({ bridge: 'mall-total-check', outcome: 'fallback', reason: fallbackReason() });
  }
  return (subtotalKobo - discountKobo + deliveryFeeKobo) === totalKobo;
}
