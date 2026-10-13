/**
 * Regression tag helper.
 *
 * Every test that locks a bug from docs/regressions.md must be tagged
 * `@regression:` + the incident id in its name, e.g.
 *
 *   test(`@regression:F1 — mall refund books 'Sale Refund', never 'Refund Outflow'`, ...)
 *
 * The tag convention is enforced by scripts/regression/tag-coverage.test.ts,
 * which asserts the ledger's Repro-test column matches a test in this folder.
 */

export const regressionTag = (incident: string, message: string): string =>
  `@regression:${incident} — ${message}`;
