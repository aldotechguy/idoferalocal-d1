/**
 * Ledger integrity: every incident in docs/regressions.md must be locked by a
 * test in scripts/regression/ carrying the matching `@regression:<ID>` tag.
 *
 * This is the enforcement mechanism for the regression rule (see the top of
 * docs/regressions.md): a row without a test here fails the PR gate, so a bug
 * cannot quietly lose its lock.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const REGRESSION_DIR = path.resolve(import.meta.dirname ?? '.');
const LEDGER = path.resolve(REGRESSION_DIR, '..', '..', 'docs', 'regressions.md');

test('regression ledger integrity: every incident row maps to a tagged @regression test', () => {
  assert.ok(fs.existsSync(LEDGER), 'docs/regressions.md must exist');

  const ledger = fs.readFileSync(LEDGER, 'utf8');
  // Incident ids: table rows like "| F1 | ... |" (skip header/separator rows).
  const incidentIds = [...ledger.matchAll(/^\|\s*([A-Z]+\d+)\s*[—\|]/gm)].map((m) => m[1]);
  assert.ok(incidentIds.length >= 8, `the ledger must list at least the eight seeded incidents (found ${incidentIds.length})`);

  // Collect @regression:<ID> tags from every test file in scripts/regression/.
  const tags = new Set<string>();
  for (const file of fs.readdirSync(REGRESSION_DIR).filter((f) => f.endsWith('.test.ts'))) {
    const source = fs.readFileSync(path.join(REGRESSION_DIR, file), 'utf8');
    for (const m of source.matchAll(/@regression:([A-Z]+\d+)/g)) tags.add(m[1]);
  }
  assert.ok(tags.size > 0, 'at least one @regression tag must exist in scripts/regression/');

  for (const id of incidentIds) {
    assert.ok(tags.has(id), `incident ${id} is in the ledger but has no @regression:${id} test in scripts/regression/`);
  }

  // No orphaned tags either: a tag without a ledger row means the ledger drifted.
  for (const tag of tags) {
    assert.ok(incidentIds.includes(tag), `@regression:${tag} exists but has no row in docs/regressions.md`);
  }

  // The "never delete or weaken" rule must be stated at the top of the ledger.
  assert.match(ledger, /never\s+(be\s+)?deleted\s+or\s+weakened/i,
    'docs/regressions.md must state the never-delete/weaken rule');
  assert.match(ledger, /fails? before the fix/i, 'docs/regressions.md must state the fails-before-fixes-after rule');
});
