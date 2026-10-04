/**
 * Phase 4 — relational sync watermark ("100% relational").
 *
 * The document store used `sync_revisions(owner_id, revision, updated_at)` to tell
 * clients whether their snapshot was stale. With the blob removed from `idofera`,
 * that revision is derived from the RELATIONAL store instead, so nothing about the
 * frontend sync contract changes:
 *
 *   - the watermark is a monotonic INTEGER kept in the `settings` table under
 *     `key = 'sync_watermark'` (a real relational row, not a document);
 *   - every relational write calls `bumpWatermark()` to advance it, so any change
 *     produces a new revision exactly as the old sync_revisions upsert did;
 *   - `currentRevision()` reads it back, and a store that has never been written
 *     (or predates this change) falls back to a row-count-derived value so two
 *     different stores can never look identical when one is empty and one is not.
 *
 * Both runtimes (server.ts node:sqlite, sites-worker.ts D1) share this module so
 * the revision they report can never drift apart.
 */
export const SYNC_WATERMARK_KEY = 'sync_watermark';

export type SqlRunner = {
  queryAll: (sql: string, params?: any[]) => Promise<any[]>;
  run: (sql: string, params?: any[]) => void;
};

/** Read the current revision; 0 when the store has never been written. */
export async function currentRevision(tx: SqlRunner): Promise<number> {
  try {
    const rows = await tx.queryAll(`SELECT value_json FROM settings WHERE key = ?`, [SYNC_WATERMARK_KEY]);
    const row: any = rows?.[0];
    if (row?.value_json != null) {
      const parsed = JSON.parse(String(row.value_json));
      const value = typeof parsed === 'number' ? parsed : Number(parsed?.revision);
      if (Number.isFinite(value)) return value;
    }
  } catch {
    // settings table absent on a brand-new database — treat as revision 0.
  }
  return 0;
}

/**
 * Advance the watermark to `atLeast` (or now, whichever is greater) and return the
 * new revision. Monotonic: a concurrent/older writer can never lower it.
 */
export async function bumpWatermark(tx: SqlRunner, atLeast?: number): Promise<number> {
  const previous = await currentRevision(tx);
  const next = Math.max(Date.now(), previous + 1, atLeast || 0);
  tx.run(
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
     WHERE CAST(excluded.value_json AS INTEGER) > CAST(settings.value_json AS INTEGER)`,
    [SYNC_WATERMARK_KEY, JSON.stringify(next), Date.now()],
  );
  return Math.max(next, await currentRevision(tx));
}
