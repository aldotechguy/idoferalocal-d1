import { writeD1SnapshotToIndexedDB, getAllLocalStores } from '../db/indexedDB';
import { safeSetLocalStorage } from '../utils/localStorage';
import { setUnsyncedLocalChangesCount } from './googleDriveService';
import { migrateSnapshot } from '../utils/dataMigration';

export type D1Record = Record<string, any>;
export type D1Snapshot = Record<string, D1Record[]>;

type SnapshotResponse = {stores: D1Snapshot; hasData: boolean; revision: number; backend?: string; notModified?: boolean; bounds?: {capped?: string[]}};

const REVISION_KEY = 'idofera_d1_revision';
/**
 * Revalidation token for the whole-store snapshot: `<revision>-<backend>` exactly
 * as the server builds it. Re-sending it lets the server answer `304` instead of
 * returning ~1,600 documents on every Dashboard boot.
 */
const SNAPSHOT_GUARD_KEY = 'idofera_d1_snapshot_guard';
const DIRTY_KEY = 'idofera_d1_dirty';
const REMOTE_PENDING_KEY = 'idofera_d1_remote_pending';
const DELETIONS_KEY = 'idofera_d1_deletions';
const UNSYNCED_KEYS_KEY = 'idofera_unsynced_item_keys';
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let latestSnapshot: D1Snapshot | undefined;
let mergeHandler: ((snapshot: D1Snapshot) => void) | undefined;
let syncing = false;

const recordTime = (record: D1Record) => {
  const value = record.updatedAt || record._lastSyncedAt || record.createdAt || record.date;
  const parsed = value ? Date.parse(String(value)) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

function mergeCollections(local: D1Record[] = [], remote: D1Record[] = []) {
  const merged = new Map<string, D1Record>();
  remote.forEach((record, index) => merged.set(String(record.id || `remote-${index}`), record));
  local.forEach((record, index) => {
    const id = String(record.id || `local-${index}`);
    const cloudRecord = merged.get(id);
    if (!cloudRecord || recordTime(record) >= recordTime(cloudRecord)) merged.set(id, record);
  });
  return [...merged.values()];
}

export function mergeSnapshots(local: D1Snapshot, remote: D1Snapshot): D1Snapshot {
  const merged: D1Snapshot = {};
  for (const store of new Set([...Object.keys(remote), ...Object.keys(local)])) {
    merged[store] = mergeCollections(local[store], remote[store]);
  }
  return merged;
}

function getUnsyncedKeys(): Set<string> {
  try {
    const aliases: Record<string, string> = {
      deliveries: 'deliveryOrders',
      whatsapp: 'whatsAppPreOrders',
    };
    const keys: string[] = JSON.parse(localStorage.getItem(UNSYNCED_KEYS_KEY) || '[]');
    return new Set<string>(keys.map((rawKey) => {
      const separator = String(rawKey).lastIndexOf(':');
      if (separator <= 0) return rawKey;
      const collection = String(rawKey).slice(0, separator);
      return `${aliases[collection] || collection}:${String(rawKey).slice(separator + 1)}`;
    }));
  } catch {
    return new Set<string>();
  }
}

export function mergeRemoteWithPendingLocal(local: D1Snapshot, remote: D1Snapshot, capped?: ReadonlySet<string>): D1Snapshot {
  const unsyncedKeys = getUnsyncedKeys();
  const pendingDeletions = new Set(getDeletions().map(({collection, documentId}) => `${collection}:${documentId}`));
  const merged: D1Snapshot = {};

  const allStores = new Set([...Object.keys(remote || {}), ...Object.keys(local || {})]);

  for (const store of allStores) {
    const remoteRecords = remote?.[store] || [];
    const localRecords = local?.[store] || [];
    const records = new Map<string, D1Record>();

    // 1. First add remote records (unless marked as locally deleted)
    for (const record of remoteRecords) {
      if (!record) continue;
      const id = String(record.id || 'singleton');
      const itemKey = `${store}:${id}`;
      if (!pendingDeletions.has(itemKey)) {
        records.set(id, record);
      }
    }

    // 2. Process local records - ensure NEW local records and local updates are NEVER wiped off
    for (const record of localRecords) {
      if (!record) continue;
      const id = String(record.id || 'singleton');
      const itemKey = `${store}:${id}`;

      // Respect explicit user deletion on this device
      if (pendingDeletions.has(itemKey)) {
        continue;
      }

      const remoteRecord = records.get(id);

      if (!remoteRecord) {
        // Preserve records explicitly queued by saveDocument. A missing local
        // record must not be inferred as pending after D1 has acknowledged it.
        // A capped response is not exhaustive: rows the server cap omitted must
        // survive locally instead of being inferred as deleted elsewhere.
        if (unsyncedKeys.has(itemKey) || capped?.has(store)) {
          records.set(id, record);
        }
      } else if (unsyncedKeys.has(itemKey)) {
        // An explicitly pending local edit wins over the remote copy.
        // (Timestamp-only inference caused acknowledged records to reappear as
        // unsynced when clients had incomplete/legacy timestamps.)
        records.set(id, record);
      }
    }

    merged[store] = [...records.values()];
  }

  // Keep pending metadata aligned with the explicit local mutation queue.
  if (unsyncedKeys.size > 0) {
    try {
      safeSetLocalStorage(UNSYNCED_KEYS_KEY, JSON.stringify(Array.from(unsyncedKeys)));
      localStorage.setItem(DIRTY_KEY, 'true');
      setUnsyncedLocalChangesCount(unsyncedKeys.size);
    } catch (e) {
      console.warn('Failed to update unsynced keys tracking in localStorage:', e);
    }
  } else {
    localStorage.setItem(DIRTY_KEY, 'false');
    setUnsyncedLocalChangesCount(0);
  }

  return migrateSnapshot(merged);
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {};
  const token = localStorage.getItem('idofera_session_token') || sessionStorage.getItem('idofera_session_token');
  if (token) {
    headers['authorization'] = `Bearer ${token}`;
    headers['x-session-token'] = token;
  }
  return headers;
}

const snapshotGuardValue = (revision: number, backend: string) => `${revision}-${backend}`;

function rememberSnapshotGuard(revision: number, backend: string) {
  try { localStorage.setItem(SNAPSHOT_GUARD_KEY, snapshotGuardValue(revision, backend)); }
  catch { /* storage unavailable: the next read is simply a full read */ }
}

export function forgetSnapshotGuard() {
  try { localStorage.removeItem(SNAPSHOT_GUARD_KEY); }
  catch { /* storage unavailable */ }
}

/**
 * Bump when the sync engine's contract changes in a way that makes previously
 * persisted snapshot state unsafe. The old delta-replace engine could leave
 * wholesale-truncated IndexedDB stores behind; on a version mismatch every
 * browser forces one clean full relational re-read on its next boot, rebuilding
 * local stores from D1 (which was never damaged).
 */
const SYNC_ENGINE_VERSION = 1;
const SYNC_ENGINE_VERSION_KEY = 'idofera_sync_engine_version';

export function enforceSyncEngineVersion() {
  try {
    const stored = localStorage.getItem(SYNC_ENGINE_VERSION_KEY);
    if (stored === String(SYNC_ENGINE_VERSION)) return;
    localStorage.setItem(SYNC_ENGINE_VERSION_KEY, String(SYNC_ENGINE_VERSION));
    forgetSnapshotGuard();
    // A legacy delta watermark must never bound a read on the new engine.
    localStorage.removeItem('idofera_d1_delta_cursor');
  } catch { /* storage unavailable: nothing persisted to invalidate */ }
}

async function readCloudSnapshot(fresh = false): Promise<SnapshotResponse> {
  const authHeaders = await getAuthHeaders();
  const url = fresh ? '/api/storage/snapshot?fresh=true' : '/api/storage/snapshot';
  const headers: Record<string, string> = { ...(authHeaders as Record<string, string>), 'cache-control': 'no-cache' };
  const knownGuard = localStorage.getItem(SNAPSHOT_GUARD_KEY);
  if (knownGuard) headers['if-none-match'] = `"${knownGuard}"`;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (response.status === 304) {
    // Unchanged since this browser's last read; IndexedDB already holds it.
    return { stores: {}, hasData: true, revision: Number(localStorage.getItem(REVISION_KEY) || 0), notModified: true };
  }
  if (!response.ok) throw new Error(`D1 restore failed (${response.status})`);
  const cloud = await response.json() as SnapshotResponse;
  rememberSnapshotGuard(cloud.revision, cloud.backend || 'documents');
  return cloud;
}

async function writeSnapshot(snapshot: D1Snapshot, expectedRevision: number, force = false) {
  const authHeaders = await getAuthHeaders();
  const response = await fetch('/api/storage/snapshot', {
    method: 'PUT',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({stores: snapshot, expectedRevision, force}),
  });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`D1 sync failed (${response.status})`);
  const result = await response.json() as {revision: number; relationalSynced?: boolean};
  // Keep the revalidation token honest: a relational mirror failure means the
  // live catalog may not match these documents, so force a full read next boot.
  if (result.relationalSynced === false) forgetSnapshotGuard();
  else rememberSnapshotGuard(result.revision, 'relational');
  return result;
}

export async function initializeD1Storage(local?: D1Snapshot): Promise<D1Snapshot | null> {
  // One-time engine self-heal: a version mismatch drops the guard (and any
  // legacy delta watermark) so this boot forces one clean full re-read and
  // rebuilds IndexedDB from D1.
  enforceSyncEngineVersion();
  // Read current local state from IndexedDB to guarantee 100% of offline/unsynced records are included
  let localSnapshot: D1Snapshot = local || {};
  try {
    const idbStores = await getAllLocalStores();
    localSnapshot = mergeSnapshots(localSnapshot, idbStores);
  } catch (err) {
    console.warn('IndexedDB read during initializeD1Storage:', err);
  }
  latestSnapshot = localSnapshot;

  const cloud = await readCloudSnapshot(true);
  // 304: the server store already matches this browser's last read, so there is
  // nothing to merge and IndexedDB stays authoritative for offline use.
  if (cloud.notModified) return null;
  localStorage.setItem(REVISION_KEY, String(cloud.revision));
  if (!cloud.hasData) return null;

  // Capped append-only collections arrive truncated: the merge must union them
  // by id instead of treating rows the cap omitted as deleted elsewhere.
  const capped = new Set(cloud.bounds?.capped || []);
  const merged = mergeRemoteWithPendingLocal(localSnapshot, cloud.stores, capped);
  latestSnapshot = merged;
  // Write merged snapshot back to IndexedDB so all new local records are preserved alongside remote data
  await writeD1SnapshotToIndexedDB(merged);
  return merged;
}

export async function pullLatestFromD1(): Promise<D1Snapshot | null> {
  // Option B: convergence is one guarded full relational read — there is no
  // backend-side pull to trigger (the old /api/storage/d1/pull route was a
  // Node-only legacy of the pre-Worker REST bridge and 404s on the Worker).
  const cloud = await readCloudSnapshot(true);
  if (cloud.notModified) return null;
  if (!cloud.hasData) return null;

  // Retrieve current local state from memory and IndexedDB to protect unsynced records
  let localSnapshot: D1Snapshot = latestSnapshot || {};
  try {
    const idbStores = await getAllLocalStores();
    localSnapshot = mergeSnapshots(localSnapshot, idbStores);
  } catch (err) {
    console.warn('IndexedDB read during pullLatestFromD1:', err);
  }

  const capped = new Set(cloud.bounds?.capped || []);
  const merged = mergeRemoteWithPendingLocal(localSnapshot, cloud.stores, capped);
  latestSnapshot = merged;
  localStorage.setItem(REVISION_KEY, String(cloud.revision));

  // When remote data is received from D1, write merged data directly to local IndexedDB stores
  await writeD1SnapshotToIndexedDB(merged);
  return merged;
}

export function queueD1Snapshot(snapshot: D1Snapshot, onMerge?: (snapshot: D1Snapshot) => void) {
  latestSnapshot = snapshot;
  mergeHandler = onMerge;
  localStorage.setItem(DIRTY_KEY, 'true');
  // Manual sync boundary: device changes are sent only by Sync Now.
}

export async function replaceD1FromRecovery(snapshot: D1Snapshot) {
  latestSnapshot = snapshot;
  localStorage.setItem(DIRTY_KEY, 'true');
  const cloud = await readCloudSnapshot().catch(() => ({ revision: -1 }));
  const result = await writeSnapshot(snapshot, cloud.revision, true);
  if (result) {
    localStorage.setItem(REVISION_KEY, String(result.revision));
    localStorage.setItem(REMOTE_PENDING_KEY, 'false');
    localStorage.setItem(DIRTY_KEY, 'false');
    return result.revision;
  }
  throw new Error('D1 snapshot restore could not be saved. Please try again.');
}

type D1Deletion = {collection: string; documentId: string};

function getDeletions(): D1Deletion[] {
  try { return JSON.parse(localStorage.getItem(DELETIONS_KEY) || '[]'); } catch { return []; }
}

export function getD1PendingDeletions(): D1Deletion[] {
  return getDeletions();
}

const D1_CATEGORY_ALIASES: Record<string, string[]> = {
  deliveries: ['deliveries', 'deliveryOrders'],
  deliveryOrders: ['deliveries', 'deliveryOrders'],
  whatsapp: ['whatsapp', 'whatsAppPreOrders'],
  whatsAppPreOrders: ['whatsapp', 'whatsAppPreOrders'],
};

// Group every pending D1 key (explicit unsynced keys + deletion intents) by
// canonical IndexedDB store so Discard deletes exactly the unsynced records.
export function groupPendingD1KeysByStore(
  pendingKeys: string[],
  pendingDeletions: D1Deletion[],
  validStores: Set<string>,
): Map<string, Set<string>> {
  const byStore = new Map<string, Set<string>>();
  const queueKey = (collection: string, id: string) => {
    const aliases = D1_CATEGORY_ALIASES[collection] || [collection];
    const canonical = aliases.find((alias) => validStores.has(alias)) || collection;
    if (!validStores.has(canonical) || !id) return;
    if (!byStore.has(canonical)) byStore.set(canonical, new Set<string>());
    byStore.get(canonical)!.add(String(id));
  };
  pendingKeys.forEach((rawKey) => {
    const separator = String(rawKey).lastIndexOf(':');
    if (separator <= 0) return;
    queueKey(String(rawKey).slice(0, separator), String(rawKey).slice(separator + 1));
  });
  pendingDeletions.forEach(({ collection, documentId }) => {
    if (documentId) queueKey(String(collection), String(documentId));
  });
  return byStore;
}

export function markD1RecordDeleted(collection: string, documentId: string) {
  const deletions = getDeletions().filter((item) => !(item.collection === collection && item.documentId === documentId));
  deletions.push({collection, documentId});
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(deletions));
  localStorage.setItem(DIRTY_KEY, 'true');
  scheduleAutoSync();
}

export function markD1RecordChanged(collection: string, documentId: string) {
  const deletions = getDeletions().filter((item) => !(item.collection === collection && item.documentId === documentId));
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(deletions));
  localStorage.setItem(DIRTY_KEY, 'true');
  // Every explicit record mutation opts into the debounced automatic save.
  scheduleAutoSync();
}

export function clearD1PendingSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = undefined;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DIRTY_KEY, 'false');
    localStorage.removeItem(REMOTE_PENDING_KEY);
    localStorage.removeItem(DELETIONS_KEY);
  }
}

export async function syncLocalRecordsToD1(snapshot: D1Snapshot, requestedDeletions?: D1Deletion[]) {
  const upserts = Object.entries(snapshot).flatMap(([collection, records]) =>
    records.map((document) => ({collection, document})),
  );
  const deletes = requestedDeletions ?? getDeletions();
  const authHeaders = await getAuthHeaders();
  const response = await fetch('/api/storage/records', {
    method: 'PATCH',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({upserts, deletes}),
  });
  if (!response.ok) throw Object.assign(new Error(`D1 record sync failed (${response.status})`), {status: response.status});
  const result = await response.json() as {revision: number; upserted: number; deleted: number; skippedUnchanged?: number; relationalSynced?: boolean};
  if (result.relationalSynced === false) {
    throw new Error('Records reached storage, but the live catalog update failed. Pending changes have been retained. Retry Sync Now; if it fails again, contact support.');
  }
  localStorage.setItem(REVISION_KEY, String(result.revision));
  rememberSnapshotGuard(result.revision, 'relational');
  localStorage.removeItem(REMOTE_PENDING_KEY);
  const submittedDeletionKeys = new Set(deletes.map(({collection, documentId}) => `${collection}:${documentId}`));
  const remainingDeletions = getDeletions().filter(
    ({collection, documentId}) => !submittedDeletionKeys.has(`${collection}:${documentId}`),
  );
  if (remainingDeletions.length > 0) {
    localStorage.setItem(DELETIONS_KEY, JSON.stringify(remainingDeletions));
    localStorage.setItem(DIRTY_KEY, 'true');
  } else {
    localStorage.removeItem(DELETIONS_KEY);
    localStorage.setItem(DIRTY_KEY, 'false');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Automatic save: coalesced micro-batches
//
// A local edit only marks its own key dirty. The flush below sends just those
// records as one PATCH and skips the ~2,185-row health read that the manual
// path performs. Cost per edit is a handful of relational rows; convergence on
// other devices' writes rides the revision-guarded full snapshot (refresh or
// manual Pull) — there is no delta read anymore (Option B).
// ---------------------------------------------------------------------------
export const AUTO_SYNC_DEBOUNCE_MS = 2000;

let autoSyncTimer: ReturnType<typeof setTimeout> | undefined;
let autoSyncFlush: (() => void) | undefined;
let autoSyncRunning = false;

/** Register the provider's flush so lifecycle events can force a save. */
export function registerAutoSyncFlush(flush: (() => void) | undefined) {
  autoSyncFlush = flush;
  // Only the currently registered owner may clear the slot; a second provider
  // that unmounts later must not silently disable automatic saving.
  return () => { if (autoSyncFlush === flush) autoSyncFlush = undefined; };
}

/** `pagehide`/`visibilitychange` cannot await, so this is fire-and-forget. */
export function flushAutoSyncNow() {
  autoSyncFlush?.();
}

/** Debounced local edits collapse into a single micro-batch. */
export function scheduleAutoSync(delayMs = AUTO_SYNC_DEBOUNCE_MS) {
  if (!autoSyncFlush) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = undefined;
    autoSyncFlush?.();
  }, delayMs);
}

export function cancelAutoSync() {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = undefined;
  }
}

/** One changed (`updatedAt` is absent/unparseable) record in one collection. */
export interface ChangedRecord {
  collection: string;
  documentId: string;
  updatedAt?: string;
}

function asChangedRecords(records: ChangedRecord[]): ChangedRecord[] {
  const seen = new Set<string>();
  const unique: ChangedRecord[] = [];
  for (const record of records) {
    const key = `${record.collection}:${record.documentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}

export interface AutoSyncDeps {
  /** Read exactly one record; returning null (locally deleted) skips it. */
  readRecord: (collection: string, documentId: string) => Promise<D1Record | null>;
  now?: () => string;
}

export interface AutoSyncResult {
  changedCount: number;
  pushed: boolean;
  skipped?: 'no-changes' | 'not-newer';
}

/**
 * Push only the changed documents. A push is rejected with 409 only when the row
 * exists elsewhere with a newer `updatedAt`, which means this device has nothing
 * newer to send; convergence on that copy rides the revision-guarded full
 * snapshot (refresh or manual Pull) — there is no delta pull anymore (Option B).
 */

export async function autoSyncChangedRecords(
  records: ChangedRecord[],
  deps: AutoSyncDeps,
): Promise<AutoSyncResult> {
  const unique = asChangedRecords(records);
  if (!unique.length) return {changedCount: 0, pushed: false, skipped: 'no-changes'};

  if (autoSyncRunning) {
    // A flush is already in flight; fold this batch into a follow-up run so two
    // consumers can never write the same records concurrently.
    scheduleAutoSync();
    return {changedCount: unique.length, pushed: false, skipped: 'no-changes'};
  }
  autoSyncRunning = true;
  try {
    return await pushChangedRecords(unique, deps);
  } finally {
    autoSyncRunning = false;
  }
}

async function pushChangedRecords(
  unique: ChangedRecord[],
  deps: AutoSyncDeps,
): Promise<AutoSyncResult> {

  const upserts: {collection: string; document: D1Record}[] = [];
  for (const record of unique) {
    const document = await deps.readRecord(record.collection, record.documentId);
    if (!document) continue;
    const stamp = deps.now ? deps.now() : new Date().toISOString();
    upserts.push({collection: record.collection, document: {...document, updatedAt: stamp}});
  }
  if (!upserts.length) return {changedCount: unique.length, pushed: false, skipped: 'no-changes'};

  const grouped: D1Snapshot = {};
  for (const {collection, document} of upserts) {
    (grouped[collection] ||= []).push(document);
  }

  try {
    await syncLocalRecordsToD1(grouped);
    return {changedCount: unique.length, pushed: true};
  } catch (error) {
    if ((error as {status?: number})?.status !== 409) throw error;
    // Another device already stored a newer copy; do not overwrite it. Option B
    // has no delta pull here — the next guarded full read converges this device.
    return {changedCount: unique.length, pushed: false, skipped: 'not-newer'};
  }
}

export async function readD1ForBackup(): Promise<{stores: D1Snapshot; revision: number}> {
  const cloud = await readCloudSnapshot();
  return {stores: cloud.stores || {}, revision: Number(cloud.revision || 0)};
}

export interface D1HealthStatus {
  connected: boolean;
  latencyMs: number;
  lastChecked: number;
  databaseId: string;
  revision: number;
  /** Absent unless the probe requested `detail`; counting costs a full scan. */
  totalDocuments?: number;
  /**
   * Live per-table relational counts, `detail` probes only. This is the store
   * the app reads; `totalDocuments` counts the document mirror, which PATCHes
   * no longer refresh (option B) and therefore drifts until the next snapshot
   * PUT, so UIs should prefer these counts.
   */
  relational?: {
    products?: number; sales?: number; customers?: number; suppliers?: number; saleItems?: number;
    tables?: number; error?: string;
  };
  endpoint: string;
  error?: string;
  status: 'healthy' | 'degraded' | 'offline' | 'error';
}

export async function checkD1Health(detail = false): Promise<D1HealthStatus> {
  const fallbackDbId = '3e95a550-a091-490b-819d-f0acb7ea8dd8';
  // Counts are opt-in: the default probe reads one revision row, whereas asking
  // for counts scans every document plus five relational tables (~2,185 rows).
  const healthUrl = detail ? '/api/storage/d1/health?detail=1' : '/api/storage/d1/health';
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      connected: false,
      latencyMs: 0,
      lastChecked: Date.now(),
      databaseId: fallbackDbId,
      revision: Number(localStorage.getItem(REVISION_KEY) || 0),
      totalDocuments: 0,
      endpoint: 'Cloudflare D1 Storage API',
      error: 'Device is offline. No internet connectivity.',
      status: 'offline',
    };
  }

  const start = performance.now();
  try {
    const authHeaders = await getAuthHeaders();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(healthUrl, {
      headers: { ...authHeaders, 'cache-control': 'no-cache' },
      credentials: 'include',
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Math.max(1, Math.round(performance.now() - start));

    if (response.ok) {
      const data = (await response.json()) as any;
      return {
        connected: Boolean(data.connected),
        latencyMs: data.latencyMs || latencyMs,
        lastChecked: Date.now(),
        databaseId: data.databaseId || fallbackDbId,
        revision: Number(data.revision || 0),
        totalDocuments: data.totalDocuments === undefined ? undefined : Number(data.totalDocuments),
        relational: data.relational,
        endpoint: data.endpoint || 'Cloudflare D1 Primary Edge',
        status: latencyMs > 3000 ? 'degraded' : 'healthy',
      };
    } else {
      return {
        connected: false,
        latencyMs,
        lastChecked: Date.now(),
        databaseId: fallbackDbId,
        revision: Number(localStorage.getItem(REVISION_KEY) || 0),
        totalDocuments: 0,
        endpoint: 'Cloudflare D1 Storage API',
        error: `Endpoint returned HTTP ${response.status}`,
        status: 'error',
      };
    }
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    const isTimeout = err?.name === 'AbortError';

    // Quick lightweight retry to prevent transient cold-boot timeout false-positives
    if (isTimeout) {
      try {
        const retryStart = performance.now();
        // Same 12s bound as the first attempt: without a signal this retry could
        // hang on the browser default timeout and keep isCheckingHealth stuck.
        const retryRes = await fetch(healthUrl, {
          headers: { 'cache-control': 'no-cache' },
          credentials: 'include',
          signal: AbortSignal.timeout(12000),
        });
        if (retryRes.ok) {
          const data = (await retryRes.json()) as any;
          return {
            connected: Boolean(data.connected),
            latencyMs: Math.max(1, Math.round(performance.now() - retryStart)),
            lastChecked: Date.now(),
            databaseId: data.databaseId || fallbackDbId,
            revision: Number(data.revision || 0),
            totalDocuments: Number(data.totalDocuments || 0),
            relational: data.relational,
            endpoint: data.endpoint || 'Cloudflare D1 Primary Edge',
            status: 'healthy',
          };
        }
      } catch {
        // Fall through to offline error reporting below
      }
    }

    return {
      connected: false,
      latencyMs,
      lastChecked: Date.now(),
      databaseId: fallbackDbId,
      revision: Number(localStorage.getItem(REVISION_KEY) || 0),
      totalDocuments: 0,
      endpoint: 'Cloudflare D1 Storage API',
      error: isTimeout ? 'D1 Endpoint connection timed out (>12s)' : (err?.message || 'Network unreachable'),
      status: 'offline',
    };
  }
}

async function flushD1Snapshot() {
  if (syncing || !latestSnapshot) return;
  syncing = true;
  try {
    let candidate = latestSnapshot;
    let expectedRevision = Number(localStorage.getItem(REVISION_KEY) || 0);
    let result = await writeSnapshot(candidate, expectedRevision);
    if (!result) {
      const cloud = await readCloudSnapshot();
      candidate = mergeSnapshots(candidate, cloud.stores);
      expectedRevision = cloud.revision;
      mergeHandler?.(candidate);
      result = await writeSnapshot(candidate, expectedRevision);
    }
    if (!result) throw new Error('D1 changed again while resolving a conflict.');
    latestSnapshot = candidate;
    localStorage.setItem(REVISION_KEY, String(result.revision));
    localStorage.setItem(DIRTY_KEY, 'false');
  } catch (error) {
    console.warn('D1 background sync warning:', error);
  } finally {
    syncing = false;
  }
}

