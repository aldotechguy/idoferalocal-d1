# Phase 4 — Relational Backend (DAL Swap Without Touching the UI)

Status: **COMPLETE** (branch `feature/unified-mall`, D1 `idofera`).

## Goal

Make the *same* relational tables the source of truth for the running POS/Biz app,
without changing a single screen. The frontend still speaks its snapshot/`stores`
contract; only the server's storage engine changed.

## Architecture

```
React UI (unchanged: AppContext -> /api/storage/*)
        |
        v
sites-worker.ts (Cloudflare)        server.ts (local dev)
        |                                    |
        v                                    v
   D1 `idofera` (relational)      data/d1_storage.db (node:sqlite, same schema)
        <---- shared modules ---->
   src/server/relationalDdl.ts    DDL + indexes (auto-generated from drizzle migration)
   src/server/relationalMapper.ts rows  <-> frontend document shape
   src/server/relationalSnapshot.ts  SELECTs -> `stores` payload
   src/server/relationalWrites.ts    document -> INSERT/DELETE statements
   src/server/nodeAdapter.ts         node:sqlite adapter + bootstrap
```

Both runtimes import the *same* modules — there is no second copy of the mapping
logic, so local dev and the edge worker cannot drift apart.

## What each route does now

| Route | Before | After |
| --- | --- | --- |
| `GET /api/storage/snapshot` | `app_documents` scan | relational `SELECT`s -> same `stores` shape (`backend: "relational"`), append-only history tables capped (`SNAPSHOT_ROW_CAPS`) |
| `PATCH /api/storage/records` | document upsert/delete | relational upsert/delete only — **mirror-less** (option B, schema v9) |
| `PUT /api/storage/snapshot` | full document replace | full relational replace (child-first) **+** document mirror (the only mirror writer) |
| `GET /api/storage/d1/health` | doc counts | doc counts **+** relational counts per table |

### Mirror writes: snapshot PUTs only (option B)

D1 bills a row written for every index entry a write touches, and the old PATCH paid
twice for every staff edit: a mirror upsert into `app_documents` (row + its indexes)
on top of the relational rows, plus 50-row probe pages that pre-read every candidate
from the mirror for the unchanged re-push guard. After the D1 row-cost pass:

* **`PUT /api/storage/snapshot`** still writes the mirror — a full replace is the
  repair/restore path, so it keeps `app_documents` current.
* **`PATCH /api/storage/records`** is mirror-less in relational mode (the default in
  both runtimes): it writes only the relational rows it changes. The mirror probe
  and the no-op guard went with it — the probe compared against mirror payloads
  that PATCHes no longer refresh, so it could never make a correct skip decision
  again. `skippedUnchanged` stays in the response (always 0) so older clients keep
  parsing it. Node keeps the dual-write only while `VITE_USE_RELATIONAL=false`,
  because the documents backend still owns its store there.
* **Delta reads** (`GET /api/storage/snapshot?since=…`) read the mirror, so they
  see PUT-driven rows only. Clients still converge on PATCH changes through the
  revision bump and the full relational snapshot read, which are unchanged.
* **Rollback** — `VITE_USE_RELATIONAL=false` still restores the document path, but
  the mirror is now only as current as the last snapshot PUT: run a full snapshot
  restore first if the relational store has moved on. There is no separate
  `D1_MIRROR_MODE` flag; the toggle is `VITE_USE_RELATIONAL` (Node), and the
  deployed Worker is always relational-first with a document fallback.
* **Auto-heal** — a fresh local DB (or a pre-ETL DB) is still backfilled once from
  `app_documents` instead of starting empty.

Reads prefer relational; the mirror is a repair input and rollback snapshot, not the
primary path.

## The legacy bridge

`ensureRelationalBackfill()` exists in both runtimes and uses the shared
`backfillStatementsFromDocumentRows()`:

1. If `products`/`sales` are non-empty -> do nothing (idempotent).
2. Otherwise read `app_documents ORDER BY updated_at` and project every document
   into relational tables, **last write wins** per `(collection, id)`.
3. Malformed payloads and unknown collections (`test_coll`) are counted and skipped.

Previously the PATCH route returned early in relational mode, so rows written by an
older build were invisible; the bridge closes that gap.
## Money and images

* **Money** is stored as INTEGER **kobo** in every table (`*_kobo`). The mapper
  converts on read/write (`KoboToNaira` / `NairaToKobo`) so the UI keeps using naira
  floats exactly as before.
* **Images** follow a storage-safe policy single-sourced in
  `relationalMapper.cleanImageList()`: hosted URLs are kept verbatim (up to
  `IMAGE_CAP = 8`), while `data:` base64 uploads are kept out of the relational
  tables. 11 of 106 legacy products carry a multi-MB base64 primary photo, and D1
  rejects oversized statements (`SQLITE_TOOBIG`) while base64 would bloat every
  snapshot push. Those originals are extracted once to `backups/images/` +
  `manifest.json` by `scripts/etl/extract-images.ts` and re-pointed at R2 in
  **Phase 4.5 (gate before cutover)**, so no product photo is lost. Mall queries use
  `imageUrlList()` so a storefront never ships a base64 blob to a customer.
  Policy is asserted byte-identical between the ETL and the running app by
  `scripts/verify-relational.ts`.

## Remote push efficiency

A full snapshot is thousands of statements. `mergeInsertStatements()` collapses
identical `INSERT`s into multi-row inserts (75 bound vars per query, arity-aware),
so a full push costs hundreds of queries instead of thousands. This applies to the
legacy document inserts *and* the relational ones.

## Drift guard: ETL === backfill

`scripts/verify-relational.ts` seeds one in-memory DB through the ETL loaders and a
second through the runtime backfill (`backfillStatementsFromDocumentRows`) over the
same 2,621 documents, then requires **byte-identical per-collection snapshots**.
That guard forced the backfill to implement the ETL dedup policy exactly:

1. newest `updated_at` per `(owner, collection, id)`;
2. cross-owner copies of one logical record: highest owner rank wins;
3. duplicate receipts / PO numbers (multi-device clones): newest `createdAt` wins;
4. orphan sale/purchase line items get `Archived-*` placeholder products.

The same guard caught two ETL column omissions — `sales.order_taken_by` /
`sales.expense_id` and `products.qr_code` / `description` / `expiry_date` were not
being written by the loaders. After the fix D1 `idofera` must be refreshed:

```powershell
npm run etl:dump -- --full-refresh
npx wrangler d1 execute idofera --remote --yes --file=./backups/idofera-relational-import.sql
```

A local store can be rebuilt from its own mirror with
`npx tsx scripts/rebuild-local-relational.ts`, then checked against the mirror with
`npx tsx scripts/verify-local-parity.ts`.

## Verification

```
npm run verify              # both suites
npm run verify:relational   # ETL vs mapper parity on the real prod backup
npm run verify:writes       # write path, full-replace, delete cascade, backfill
```

`verify-relational.ts` (real data from `backups/idofera-d1-2026-09-15.sql`):

* 2,621 documents parsed, 0 parse errors
* snapshot collections: products=117 customers=72 suppliers=8 sales=131 purchases=8
  expenses=14 stockMovements=296 pricingHistory=15 moneyMovements=59 settings=1
  notifications=57 auditLogs=801 deliveryOrders=5 whatsAppPreOrders=6
* sales total **NGN 1,113,680** — matches the legacy dashboard to the naira
* image policy: 11 source products carry base64 photos -> **0** base64 rows in
  relational storage (originals extracted to `backups/images/` for the R2 re-point)
* write round-trip: `currentStock 777` survives document -> row -> document

`verify-relational-writes.ts` (synthetic 15-collection fixture):

* all 15 collections round-trip through relational tables into the snapshot
* kobo conversion exact (`300` naira -> `30000` kobo)
* image policy: base64 rejected, hosted URL kept, `imageUrlList()` drops `data:`
* full replace clears stale parent **and** child rows
* delete cascades (`sale_items` -> 0, no orphans)
* backfill last-write-wins + 1 malformed payload skipped

## Files

| File | Purpose |
| --- | --- |
| `src/server/relationalDdl.ts` | AUTO-GENERATED tables + indexes (`npm run ddl:gen`) |
| `src/server/relationalMapper.ts` | row <-> document mapping, money/image policy |
| `src/server/relationalSnapshot.ts` | relational reads -> `stores` snapshot |
| `src/server/relationalWrites.ts` | document -> statements, replace/backfill helpers |
| `src/server/relationalWritesCore.ts` | core upsert/delete per collection |
| `src/server/nodeAdapter.ts` | node:sqlite adapter + idempotent bootstrap |
| `scripts/verify-relational.ts` | ETL/mapper parity on the prod backup |
| `scripts/verify-relational-writes.ts` | write-path behaviour suite |

## Regenerating the schema module

`src/server/relationalDdl.ts` is generated — never hand-edit it:

```powershell
npx drizzle-kit generate --name <change>   # produces drizzle/<n>_<name>.sql
npm run ddl:gen                            # regenerates tables + indexes
npm run verify                             # proves nothing drifted
```

## Refreshing D1 `idofera` from the legacy document DB

```powershell
npm run etl:dump -- --full-refresh   # wipes child tables, then re-inserts (users kept)
npx wrangler d1 execute idofera --remote --yes --file=./backups/idofera-relational-import.sql
```

Use `--full-refresh` whenever the mapper changes so the loaded data matches the
current mapping exactly; plain `etl:dump` is for a first-time load into an empty DB.

## Cutover note (Phase 7)

`USE_RELATIONAL` is on by default (`server.ts`), and the edge worker prefers
relational reads with a document fallback. Nothing here deletes legacy data: the
`app_documents` mirror and the `v1-pos-stable` tag remain valid rollback targets.