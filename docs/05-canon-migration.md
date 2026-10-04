# Canon migration — consolidate `idofera-d1` into `idofera` (100% relational)

Status: **EXECUTED 2026-10-04** — `idofera` is now the single, 100% relational canon.

## Result (executed 2026-10-04)

| Step | Outcome |
| --- | --- |
| Snapshots | `backups/idofera-pre-migration-2026-10-04.sql` (target rollback), `backups/idofera-d1-final-2026-10-04.sql` (stale D1 source) |
| **Canon source** | The true canon was the **device's app backup** (`idofera_backup_2026-10-04_17-29-14.json`), not D1 — D1 held a stale subset (152 sales). |
| Convert | `scripts/etl/convert-backup-json.ts` — 197 sales / 108 products / 94 customers, receipt collisions resolved (197 unique receipt_no) |
| Gate | `CANON-IMPORT VERIFY OK` — 197 sales / **NGN 1,562,790** / 0 clearance / 0 orphans / 0 base64 |
| Load | canon pushed to `idofera` — 4,532 changes, 12,631 rows written; blob tables remain DROPPED |
| Verify (live) | products 108, sales 197, **sales_kobo 156,279,000 (NGN 1,562,790)**, customers 94, suppliers 10, sale_items 376, money_movements 120, audit_logs 1,083, users 2, **0 clearance / 0 base64 / 0 orphans / 0 blob tables** |
| Watermark | `settings.sync_watermark` set to the backup revision `1791130894129` so the app recognises this canon |
| Deploy | `idomall` Worker redeployed (relational-only, placeholder-receipt fix) — Version `1fa2226e` |
| Local | `data/d1_storage.db` rebuilt from the canon (197 sales / NGN 1,562,790) |

Rollback artifacts: `idofera-pre-migration-2026-10-04.sql` (pre-wipe target),
`idofera-d1-final-2026-10-04.sql` (untouched stale source),
`idofera_backup_2026-10-04_17-29-14.json` (the true canon).

> Lesson: the D1 databases held only a **stale subset** — the authoritative canon
> for this shop lives in the **device's app backup** (Drive/IndexedDB). Always
> confirm the record counts against the app's own totals before a cutover.
>
> Auth note: the super-admin account carries `idofera-d1`'s credentials
> (`username: idofera`). Rotate if it differs from the rotated `idofera` password
> (see `docs/mall-launch-safety.md`).

## Goal

* `idofera` becomes the ONE canonical, **100% relational** store.
* The `app_documents` / `sync_revisions` JSON blob is gone — dropped from the schema
  and removed from both runtimes (`server.ts`, `sites-worker.ts`).
* Every business record that lives in `idofera-d1`'s `app_documents` blob is present
  in `idofera`'s relational tables, optimized to the live schema.
* Clearance / non-inventory products and historical-sale hygiene are preserved
  (see below).

## What "100% relational" means in code

| Concern | Before | After |
| --- | --- | --- |
| Snapshot read | relational, fallback to `app_documents` | relational only (`buildSnapshot`) |
| Snapshot PUT | relational + document mirror | relational only |
| PATCH records | relational (+ legacy mirror when `VITE_USE_RELATIONAL=false`) | relational only |
| Sync revision | `sync_revisions(owner_id, revision, updated_at)` | `settings` row `key='sync_watermark'` (`src/server/syncWatermark.ts`) |
| Owner migration | `app_documents` copied to `idofera-business` | removed (store is owner-less) |
| Backfill bridge | documents → relational on first boot | removed (no-op) |
| Schema | `drizzle/0000_unified-relational.sql` (+ blob tables) | blob tables removed; `relationalDdl.ts` regenerated (28 tables) |

The revision contract is unchanged for clients: the same monotonic INTEGER is
returned as `revision` and used as the `"<revision>-<backend>"` ETag guard.

## Clearance & historical product policy

* **Clearance / non-inventory lines** (`productId` starts `clearance-`, or
  `sku === 'CLEARANCE'`, or `isClearance`) are **never** created as catalogue
  products. The line item keeps `product_name`/`sku` and a **NULL** `product_id`
  with `is_clearance = 1`. Rule lives in `src/shared/productStatus.ts`
  (`isClearanceItem`) and is applied by the ETL, the runtime mapper and the
  backfill bridge identically.
* **Historical-sale line products** are kept as-is (they feed the Investment
  Analysis System), flagged by `sales.is_historical`.

## Tooling

| Script | Purpose |
| --- | --- |
| `scripts/etl/export-d1.ts` | export a D1 to SQL (rollback + canon input) |
| `scripts/etl/inspect-clearance.ts` | report clearance/historical lines in a dump |
| `scripts/etl/dump.ts` | blob dump → relational import SQL (`--source=`) |
| `scripts/etl/verify-canon-import.ts` | dry-load the import into `:memory:` + assert invariants |
| `scripts/etl/emit-wipe-sql.ts` | emit the full-wipe SQL file for the target |
| `scripts/etl/wipe-target.ts` | clear `idofera` completely (all tables, REST) |
| `scripts/etl/move-canon.ts` | table-to-table move `idofera-d1` → `idofera` |
| `scripts/etl/push-import.ts` | push an import SQL file to a D1 (REST) |
| `scripts/rebuild-local-from-idofera.ts` | rebuild the local dev DB from the migrated export |

The executed run used `wrangler d1 export/execute` (OAuth) rather than the REST
scripts (which need `CLOUDFLARE_API_TOKEN`); both paths are equivalent.

npm: `etl:export-d1`, `etl:inspect-clearance`, `etl:dump`, `etl:verify-canon`,
`canon:wipe`, `canon:move`.

## Procedure

> Requires `CLOUDFLARE_API_TOKEN` (uncomment in `.env`). Export the target first —
> every step is destructive after that.

1. **Snapshot both databases** (rollback artifacts):
   ```powershell
   npx tsx scripts/etl/export-d1.ts --db=3a3eb157-5aa5-419a-a8ce-2eade2afc436 --out=backups/idofera-pre-migration.sql
   npx tsx scripts/etl/export-d1.ts --db=3e95a550-a091-490b-819d-f0acb7ea8dd8 --out=backups/idofera-d1-final.sql
   ```
2. **Export `idofera-d1`'s BLOB canon** to a document dump (Stage A input). `idofera-d1`
   is the source of truth; its `app_documents` blob is the canonical data.
3. **Inspect clearance/historical** before loading:
   ```powershell
   npx tsx scripts/etl/inspect-clearance.ts --source=backups/<idofera-d1-export>.sql
   ```
4. **Stage A — blob → relational** (produces the import SQL):
   ```powershell
   npx tsx scripts/etl/dump.ts --source=backups/<idofera-d1-export>.sql --full-refresh
   npx tsx scripts/etl/verify-canon-import.ts   # dry-load + invariant gate
   ```
5. **Wipe `idofera` completely**:
   ```powershell
   npx tsx scripts/etl/wipe-target.ts --db=3a3eb157-5aa5-419a-a8ce-2eade2afc436        # dry plan
   npx tsx scripts/etl/wipe-target.ts --db=3a3eb157-5aa5-419a-a8ce-2eade2afc436 --yes    # execute
   ```
6. **Stage B — load the canon into `idofera`** (choose one):
   * Push the Stage-A file directly:
     ```powershell
     npx tsx scripts/etl/push-import.ts --file=backups/idofera-relational-import.sql --db=3a3eb157-5aa5-419a-a8ce-2eade2afc436
     ```
   * Or move table-to-table from `idofera-d1`:
     ```powershell
     npx tsx scripts/etl/move-canon.ts --from=3e95a550-a091-490b-819d-f0acb7ea8dd8 --to=3a3eb157-5aa5-419a-a8ce-2eade2afc436 --yes
     ```
   Both include `app_users` → `users` (accounts + password hashes) so login works.
7. **Verify**:
   ```powershell
   npm run verify            # relational parity + write path
   ```
   plus a live check on `idofera` (counts, sales money total, 0 clearance products,
   0 base64, 0 orphan line items) — see the `VERIFY:` block of `push-import.ts`.

## Excluded from the move

`app_documents`, `sync_revisions` (the blob — deliberately dropped), and the
transient/operational Mall tables (`mall_outbox`, `mall_webhook_deliveries`,
`mall_order_events`, `mall_metrics`, `mall_rate_limits`, `mall_job_runs`,
`mall_checkout_attempts`, `mall_write_guards`, `mall_schema_versions`,
`staff_entrances`). These are regenerated by the running app.
