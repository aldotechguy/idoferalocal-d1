import { writeD1SnapshotToIndexedDB, getAllLocalStores } from '../db/indexedDB';
import { safeSetLocalStorage } from '../utils/localStorage';
import { setUnsyncedLocalChangesCount } from './googleDriveService';
import { migrateSnapshot } from '../utils/dataMigration';

export type D1Record = Record<string, any>;
export type D1Snapshot = Record<string, D1Record[]>;

type SnapshotResponse = {stores: D1Snapshot; hasData: boolean; revision: number};

const REVISION_KEY = 'idofera_d1_revision';
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
    return new Set<string>(JSON.parse(localStorage.getItem(UNSYNCED_KEYS_KEY) || '[]'));
  } catch {
    return new Set<string>();
  }
}

export function mergeRemoteWithPendingLocal(local: D1Snapshot, remote: D1Snapshot): D1Snapshot {
  const unsyncedKeys = getUnsyncedKeys();
  const pendingDeletions = new Set(getDeletions().map(({collection, documentId}) => `${collection}:${documentId}`));
  const merged: D1Snapshot = {};
  let hasPendingLocalChanges = false;

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
        // NEW LOCAL RECORD! D1 does not have this record yet.
        // Must be preserved so it is not wiped off during refresh / pre-snapshot sync.
        records.set(id, record);
        unsyncedKeys.add(itemKey);
        hasPendingLocalChanges = true;
      } else {
        // Record exists in both remote D1 and local.
        // Keep local if it was modified locally or is newer than the remote version.
        const isLocallyModified = unsyncedKeys.has(itemKey);
        const isLocalNewer = recordTime(record) > recordTime(remoteRecord);

        if (isLocallyModified || isLocalNewer) {
          records.set(id, record);
          unsyncedKeys.add(itemKey);
          hasPendingLocalChanges = true;
        }
      }
    }

    merged[store] = [...records.values()];
  }

  // Ensure unsynced changes metadata reflects any retained local records
  if (hasPendingLocalChanges || unsyncedKeys.size > 0) {
    try {
      safeSetLocalStorage(UNSYNCED_KEYS_KEY, JSON.stringify(Array.from(unsyncedKeys)));
      localStorage.setItem(DIRTY_KEY, 'true');
      setUnsyncedLocalChangesCount(unsyncedKeys.size);
    } catch (e) {
      console.warn('Failed to update unsynced keys tracking in localStorage:', e);
    }
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

async function readCloudSnapshot(fresh = false): Promise<SnapshotResponse> {
  const authHeaders = await getAuthHeaders();
  const url = fresh ? '/api/storage/snapshot?fresh=true' : '/api/storage/snapshot';
  const response = await fetch(url, {
    headers: { ...authHeaders, 'cache-control': 'no-cache' },
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`D1 restore failed (${response.status})`);
  return response.json();
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
  return response.json() as Promise<{revision: number}>;
}

export async function initializeD1Storage(local?: D1Snapshot): Promise<D1Snapshot | null> {
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
  localStorage.setItem(REVISION_KEY, String(cloud.revision));
  if (!cloud.hasData) return null;

  const merged = mergeRemoteWithPendingLocal(localSnapshot, cloud.stores);
  latestSnapshot = merged;
  // Write merged snapshot back to IndexedDB so all new local records are preserved alongside remote data
  await writeD1SnapshotToIndexedDB(merged);
  return merged;
}

export async function pullLatestFromD1(): Promise<D1Snapshot | null> {
  try {
    await fetch('/api/storage/d1/pull', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (err) {
    console.warn('D1 backend pull warning:', err);
  }

  const cloud = await readCloudSnapshot(true);
  if (!cloud.hasData) return null;

  // Retrieve current local state from memory and IndexedDB to protect unsynced records
  let localSnapshot: D1Snapshot = latestSnapshot || {};
  try {
    const idbStores = await getAllLocalStores();
    localSnapshot = mergeSnapshots(localSnapshot, idbStores);
  } catch (err) {
    console.warn('IndexedDB read during pullLatestFromD1:', err);
  }

  const merged = mergeRemoteWithPendingLocal(localSnapshot, cloud.stores);
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

export function markD1RecordDeleted(collection: string, documentId: string) {
  const deletions = getDeletions().filter((item) => !(item.collection === collection && item.documentId === documentId));
  deletions.push({collection, documentId});
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(deletions));
  localStorage.setItem(DIRTY_KEY, 'true');
}

export function markD1RecordChanged(collection: string, documentId: string) {
  const deletions = getDeletions().filter((item) => !(item.collection === collection && item.documentId === documentId));
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(deletions));
  localStorage.setItem(DIRTY_KEY, 'true');
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

export async function syncLocalRecordsToD1(snapshot: D1Snapshot) {
  const upserts = Object.entries(snapshot).flatMap(([collection, records]) =>
    records.map((document) => ({collection, document})),
  );
  const deletes = getDeletions();
  const authHeaders = await getAuthHeaders();
  const response = await fetch('/api/storage/records', {
    method: 'PATCH',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({upserts, deletes}),
  });
  if (!response.ok) throw new Error(`D1 record sync failed (${response.status})`);
  const result = await response.json() as {revision: number; upserted: number; deleted: number};
  localStorage.setItem(REVISION_KEY, String(result.revision));
  localStorage.setItem(DIRTY_KEY, 'false');
  localStorage.removeItem(REMOTE_PENDING_KEY);
  localStorage.removeItem(DELETIONS_KEY);
  return result;
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
  totalDocuments: number;
  endpoint: string;
  error?: string;
  status: 'healthy' | 'degraded' | 'offline' | 'error';
}

export async function checkD1Health(): Promise<D1HealthStatus> {
  const fallbackDbId = '3e95a550-a091-490b-819d-f0acb7ea8dd8';
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
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const response = await fetch('/api/storage/d1/health', {
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
        totalDocuments: Number(data.totalDocuments || 0),
        endpoint: data.endpoint || 'Cloudflare D1 Primary Edge',
        status: latencyMs > 2000 ? 'degraded' : 'healthy',
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
    return {
      connected: false,
      latencyMs,
      lastChecked: Date.now(),
      databaseId: fallbackDbId,
      revision: Number(localStorage.getItem(REVISION_KEY) || 0),
      totalDocuments: 0,
      endpoint: 'Cloudflare D1 Storage API',
      error: isTimeout ? 'D1 Endpoint connection timed out (>7s)' : (err?.message || 'Network unreachable'),
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
