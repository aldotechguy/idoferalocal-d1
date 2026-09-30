/**
 * Readiness scoring for the collapsible staff panel. Collapsed, the panel must
 * state the score (`Ready (14/14)` / `Not Ready (9/14)`) without a round trip.
 *
 * The denominator is the number of checks the server actually reported, never a
 * hard-coded 14: `mallReadiness` gains and drops checks over time and a stale
 * constant would print a fraction that cannot be reconciled with the check list
 * shown when the panel is expanded.
 */
export function mallReadinessSummary(checks: Record<string, boolean> | null | undefined) {
  const entries = checks ? Object.entries(checks) : [];
  const total = entries.length;
  // A missing or empty payload is UNKNOWN, never healthy. The server computes
  // ready as `Object.values(checks).every(Boolean)`, which is vacuously true for
  // `{}`, and a failed fetch yields no payload at all — trusting `ready` here
  // would report a broken store as a passing one, the exact mistake the staff
  // help docs warn about ("treat unavailable as unknown, not as healthy").
  if (!total) return { ready: false, passing: 0, total: 0, label: 'Unavailable' };
  // `ok === true`, not truthiness: the server emits booleans, so a stray
  // undefined from a partial payload must not score as a passing check.
  const passing = entries.filter(([, ok]) => ok === true).length;
  // The word is derived from the same count as the fraction, so the label and
  // the score can never contradict each other.
  const ready = passing === total;
  return { ready, passing, total, label: `${ready ? 'Ready' : 'Not Ready'} (${passing}/${total})` };
}