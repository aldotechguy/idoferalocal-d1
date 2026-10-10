/**
 * Canon migration helper — inspect a document dump's clearance / historical lines.
 *
 * Reports, for a given dump file, the collection counts plus how many sales carry
 * clearance (non-inventory) line items and how many are historical (so the ETL's
 * "exclude clearance from the catalogue" rule can be validated before a load).
 *
 * Usage: npx tsx scripts/etl/inspect-clearance.ts [--source=backups/<file>.sql]
 */
import fs from 'node:fs';
import { SOURCE_FILE, parseDump } from './lib.js';
import { isClearanceItem } from '../../src/shared/productStatus.js';

const src = fs.readFileSync(SOURCE_FILE, 'utf8');
const { docs, userInserts } = parseDump(src);
const byCol: Record<string, number> = {};
for (const d of docs) byCol[d.collection] = (byCol[d.collection] || 0) + 1;

let clearanceLines = 0;
let salesWithClearance = 0;
let historical = 0;
let catalogCandidates = new Set<string>();
const declaredProducts = new Set<string>();
const clearanceIds = new Set<string>();

for (const d of docs) {
  if (d.collection === 'products') {
    try { declaredProducts.add(String(JSON.parse(d.payload)?.id || '')); } catch { /* malformed */ }
    continue;
  }
  if (d.collection !== 'sales') continue;
  let p: any;
  try { p = JSON.parse(d.payload); } catch { continue; }
  if (p?.isHistorical) historical += 1;
  const items = Array.isArray(p?.items) ? p.items : [];
  let hasClearance = false;
  for (const it of items) {
    if (isClearanceItem(it)) {
      clearanceLines += 1;
      hasClearance = true;
      if (it?.productId) clearanceIds.add(String(it.productId));
      continue;
    }
    if (it?.productId) catalogCandidates.add(String(it.productId));
  }
  if (hasClearance) salesWithClearance += 1;
}

console.log(`source: ${SOURCE_FILE}`);
console.log(`docs=${docs.length} users=${userInserts.length}`);
console.log(`collections: ${JSON.stringify(byCol)}`);
console.log(`declared products=${declaredProducts.size}`);
console.log(`sales with clearance lines=${salesWithClearance}  clearance line items=${clearanceLines}  historical sales=${historical}`);
console.log(`distinct clearance ids=${clearanceIds.size} (must NOT become catalogue products)`);
const orphans = [...catalogCandidates].filter((id) => !declaredProducts.has(id));
console.log(`non-clearance line products missing from catalogue=${orphans.length} (become placeholders)`);
const leaked = [...clearanceIds].filter((id) => declaredProducts.has(id));
console.log(`clearance ids that ALSO appear as declared products=${leaked.length}${leaked.length ? ': ' + leaked.slice(0, 5).join(', ') : ''}`);
