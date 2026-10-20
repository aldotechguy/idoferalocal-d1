export type NativeBridgeName = 'ledger' | 'relational-upsert' | 'relational-delete' | 'mall-transition' | 'mall-amount-due' | 'mall-total-check';
export type NativeBridgeOutcome = 'native' | 'fallback' | 'error';

export type NativeBridgeEvent = {
  bridge: NativeBridgeName;
  outcome: NativeBridgeOutcome;
  reason?: string;
};

export type EngineTarget = 'local-addon' | 'remote-service';

export type NativeBridgeTelemetry = (event: NativeBridgeEvent) => void;

let telemetry: NativeBridgeTelemetry = (event) => {
  if (typeof process !== 'undefined' && process.env.IDOFERA_NATIVE_TELEMETRY === 'true') {
    console.info('[native-bridge]', JSON.stringify(event));
  }
};
const eventCounts = new Map<string, number>();

/** Install app-level telemetry; it must never interfere with core business logic. */
export function setNativeBridgeTelemetry(callback?: NativeBridgeTelemetry): void {
  telemetry = callback ?? ((event) => {
    if (typeof process !== 'undefined' && process.env.IDOFERA_NATIVE_TELEMETRY === 'true') {
      console.info('[native-bridge]', JSON.stringify(event));
    }
  });
}

export function reportNativeBridgeEvent(event: NativeBridgeEvent): void {
  const key = `${event.bridge}:${event.outcome}`;
  eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1);
  try {
    telemetry(event);
  } catch {
    // Telemetry failures must never affect a domain operation.
  }
}

/** Snapshot counters for health/metrics endpoints; keys contain no request data. */
export function getNativeBridgeEventCounts(): Record<string, number> {
  return Object.fromEntries(eventCounts.entries());
}

export function resetNativeBridgeEventCounts(): void {
  eventCounts.clear();
}

export function isNativeBridgeTelemetryEnabled(): boolean {
  return typeof process !== 'undefined' && process.env.IDOFERA_NATIVE_TELEMETRY === 'true';
}

/** Explicit opt-in, disabled by default so rollout can remain TS-first. */
export function isNativeBridgeEnabled(): boolean {
  return typeof process !== 'undefined' && process.env.IDOFERA_NATIVE_ENABLED === 'true';
}
