import { useState, useEffect, useRef, useCallback } from 'react';
import {
  uploadD1BackupToDrive,
  restoreFromLatestDriveBackup,
  hasUnsyncedLocalChanges,
  getGoogleDriveApiKey,
  subscribeGoogleDriveSync,
  getLastBackupFileName,
  getLastBackupTime,
  getUnsyncedLocalChangesCount,
  isHeaderSyncActivated,
  REQUIRED_HEADER_SYNC_RECORDS,
  clearUnsyncedLocalChanges,
  getUnsyncedItemKeys,
  captureUnsyncedItemVersions,
  acknowledgeUnsyncedItemKeys,
  previewLatestDriveBackup,
  type DriveRestorePreview,
  getGoogleDriveAccessToken,
  getGoogleDriveConnectedEmail,
  getGoogleDriveAuthStatus,
  disconnectGoogleDrive,
  requestGoogleDriveAuthorization,
} from '../services/googleDriveService';
import { useToast } from '../context/ToastContext';
import { ALL_STORES, getAllItems, getItem, type StoreName } from '../db/indexedDB';
import {
  syncLocalRecordsToD1,
  checkD1Health,
  autoSyncChangedRecords,
  registerAutoSyncFlush,
  flushAutoSyncNow,
  scheduleAutoSync,
  readDeltaCursor,
  saveDeltaCursor,
  getD1PendingDeletions,
  type D1Snapshot,
  type D1HealthStatus,
  type ChangedRecord,
} from '../services/d1StorageService';

/**
 * Health polling cadence. This hook is mounted by more than one component (the
 * always-present Header, Settings, and the unsynced-changes modal), so the gate
 * below makes the *first* caller do the work and lets the others reuse its
 * result. Without it, three instances would triple every probe.
 */
const AUTO_PING_INTERVAL_MS = 15 * 60 * 1000;

let lastHealthPingAt = 0;
let lastHealthStatus: D1HealthStatus | null = null;
let healthInFlight: Promise<D1HealthStatus> | null = null;

function readJsonHealth(detail: boolean): Promise<D1HealthStatus> {
  if (healthInFlight && !detail) return healthInFlight;
  const pending = checkD1Health(detail);
  if (detail) return pending;
  healthInFlight = pending;
  return pending.finally(() => {
    healthInFlight = null;
    lastHealthPingAt = Date.now();
  });
}

/** Coalesces concurrent probes and honours the interval across all instances. */
async function sharedD1Health(detail: boolean, force: boolean): Promise<D1HealthStatus> {
  if (!detail && !force && lastHealthStatus && Date.now() - lastHealthPingAt < AUTO_PING_INTERVAL_MS) {
    return lastHealthStatus;
  }
  const status = await readJsonHealth(detail);
  lastHealthStatus = status;
  if (!detail) lastHealthPingAt = Date.now();
  return status;
}

const isStoreName = (name: string): name is StoreName => (ALL_STORES as readonly string[]).includes(name);

export function useCloudSync() {
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [hasDriveUnsynced, setHasDriveUnsynced] = useState<boolean>(hasUnsyncedLocalChanges());
  const [unsyncedRecordsCount, setUnsyncedRecordsCount] = useState<number>(getUnsyncedLocalChangesCount());
  const [isHeaderSyncActive, setIsHeaderSyncActive] = useState<boolean>(isHeaderSyncActivated());
  const [lastDriveBackupFile, setLastDriveBackupFile] = useState<string | null>(getLastBackupFileName());
  const [lastDriveBackupTime, setLastDriveBackupTime] = useState<string | null>(getLastBackupTime());
  const [driveRestorePreview, setDriveRestorePreview] = useState<DriveRestorePreview | null>(null);
  const [driveAuthStatus, setDriveAuthStatus] = useState(getGoogleDriveAuthStatus());
  const [isDriveAuthModalOpen, setIsDriveAuthModalOpen] = useState<boolean>(false);

  // Network health monitoring to Cloudflare D1 (every 15 minutes or on-demand)
  const [d1Health, setD1Health] = useState<D1HealthStatus | null>(null);
  const d1HealthRef = useRef<D1HealthStatus | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  const { showToast } = useToast();

  const pingD1Health = async (options?: {detail?: boolean; force?: boolean}): Promise<D1HealthStatus> => {
    const detail = Boolean(options?.detail);
    const force = Boolean(options?.force);
    setIsCheckingHealth(true);
    try {
      const health = await sharedD1Health(detail, force);
      d1HealthRef.current = health;
      setD1Health(health);
      setIsOnline(health.connected);
      return health;
    } catch (err: any) {
      const fallback: D1HealthStatus = {
        connected: false,
        latencyMs: 0,
        lastChecked: Date.now(),
        databaseId: '3e95a550-a091-490b-819d-f0acb7ea8dd8',
        revision: 0,
        totalDocuments: 0,
        endpoint: 'Cloudflare D1 Storage API',
        error: err?.message || 'Network check failed',
        status: 'offline',
      };
      d1HealthRef.current = fallback;
      setD1Health(fallback);
      return fallback;
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    const unsub = subscribeGoogleDriveSync(() => {
      setHasDriveUnsynced(hasUnsyncedLocalChanges());
      setUnsyncedRecordsCount(getUnsyncedLocalChangesCount());
      setIsHeaderSyncActive(isHeaderSyncActivated());
      setLastDriveBackupFile(getLastBackupFileName());
      setLastDriveBackupTime(getLastBackupTime());
      setDriveAuthStatus(getGoogleDriveAuthStatus());
    });

    const handleOnline = () => {
      setIsOnline(true);
      pingD1Health();
    };
    const handleOffline = () => {
      setIsOnline(false);
      pingD1Health();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const lastChecked = d1HealthRef.current?.lastChecked || 0;
        if (Date.now() - lastChecked >= AUTO_PING_INTERVAL_MS) {
          pingD1Health();
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Initial ping on mount. Non-forced, so a second component mounting the hook
    // reuses this result instead of issuing its own probe.
    pingD1Health();

    // Automatic health ping, but only while the tab is actually visible: a hidden
    // tab polls nothing, and returning to it re-checks via the listener above.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') pingD1Health();
    }, AUTO_PING_INTERVAL_MS);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  /**
   * Automatic save. A local edit marks only its own key, so this sends just those
   * records in one micro-batch and then merges back only what changed since the
   * last confirmed read. It deliberately avoids the full-store push, the ~1,900
   * row snapshot pull and the health read that the manual Sync path performs.
   */
  const flushAutoSync = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const keys = getUnsyncedItemKeys();
    const changes: ChangedRecord[] = [];
    for (const key of keys) {
      const separator = key.lastIndexOf(':');
      if (separator <= 0) continue;
      changes.push({collection: key.slice(0, separator), documentId: key.slice(separator + 1)});
    }
    const deps = {
      readRecord: async (collection: string, documentId: string) => (
        isStoreName(collection) ? getItem<Record<string, unknown>>(collection, documentId) : null
      ),
      readCursor: async () => readDeltaCursor(),
      saveCursor: async (cursor: string | null) => saveDeltaCursor(cursor),
    };
    try {
      if (!changes.length) {
        // Nothing edited, but a deletion may still be pending. Deletions travel on
        // the records endpoint, so an empty upsert set is a valid request.
        if (getD1PendingDeletions().length) await syncLocalRecordsToD1({});
        return;
      }
      const versions = captureUnsyncedItemVersions(keys);
      const result = await autoSyncChangedRecords(changes, deps);
      if (result.pushed || result.skipped === 'not-newer') acknowledgeUnsyncedItemKeys(versions);
    } catch (error) {
      console.warn('Automatic save failed:', error);
    }
  }, []);

  useEffect(() => {
    const unregister = registerAutoSyncFlush(() => { void flushAutoSync(); });
    // `pagehide`/hidden cannot await, so the save is fire-and-forget; the debounce
    // already collapsed rapid edits into one batch before this point.
    const handleLeaving = () => { flushAutoSyncNow(); };
    const handleOnline = () => { scheduleAutoSync(0); };
    window.addEventListener('pagehide', handleLeaving);
    document.addEventListener('visibilitychange', handleLeaving);
    window.addEventListener('online', handleOnline);
    return () => {
      unregister();
      window.removeEventListener('pagehide', handleLeaving);
      document.removeEventListener('visibilitychange', handleLeaving);
      window.removeEventListener('online', handleOnline);
    };
  }, [flushAutoSync]);
  const triggerDriveSync = async () => {
    if (isSyncing) return;

    if (!navigator.onLine) {
      showToast({
        title: 'Offline Mode',
        message: 'Cannot sync to Google Drive while offline. Connect to the internet to back up.',
        type: 'warning',
      });
      return;
    }

    setIsSyncing(true);
    try {
      const file = await uploadD1BackupToDrive();
      showToast({
        title: 'D1 Backup Uploaded to Drive',
        message: `Uploaded the current authoritative D1 snapshot as "${file.name}".`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Google Drive sync error:', err);
      showToast({
        title: 'Google Drive Backup Failed',
        message: err?.message || 'An error occurred while creating backup in Google Drive.',
        type: 'error',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const triggerD1Sync = async (forceFull = false) => {
    if (isSyncing) return;
    if (!navigator.onLine) {
      showToast({title: 'Offline Mode', message: 'Cannot synchronize with Cloudflare D1 while offline.', type: 'warning'});
      return;
    }
    setIsSyncing(true);
    try {
      const d1Stores = ALL_STORES.filter((store) => store !== 'users');
      const changedKeys = new Set(getUnsyncedItemKeys());
      const submittedVersions = captureUnsyncedItemVersions(changedKeys);
      const hasLocalChanges = changedKeys.size > 0;

      // Step 1: If there are pending local changes (or full sync requested), push to D1
      if (hasLocalChanges || forceFull) {
        const entries = await Promise.all(d1Stores.map(async (store) => {
          const records = await getAllItems<any>(store);
          if (forceFull || changedKeys.size === 0) {
            return [store, records] as const;
          }
          return [store, records.filter((record) => changedKeys.has(`${store}:${record.id}`))] as const;
        }));
        await syncLocalRecordsToD1(Object.fromEntries(entries) as D1Snapshot);
        if (forceFull && changedKeys.size === 0) {
          clearUnsyncedLocalChanges();
        } else {
          acknowledgeUnsyncedItemKeys(submittedVersions);
        }
      }

      // Step 2: Pull latest authoritative records from D1 into the app state & IndexedDB
      window.dispatchEvent(new CustomEvent('idofera_pull_d1'));

      await pingD1Health();
    } catch (err: any) {
      await pingD1Health();
      showToast({title: 'Cloudflare D1 Sync Failed', message: err?.message || 'Could not synchronize with Cloudflare D1.', type: 'error'});
    } finally {
      setIsSyncing(false);
    }
  };

  const triggerD1Pull = async () => {
    if (isSyncing) return;
    if (!navigator.onLine) {
      showToast({title: 'Offline Mode', message: 'Cannot pull from Cloudflare D1 while offline.', type: 'warning'});
      return;
    }
    setIsSyncing(true);
    try {
      window.dispatchEvent(new CustomEvent('idofera_pull_d1'));
      await pingD1Health();
    } catch (err: any) {
      showToast({title: 'D1 Pull Failed', message: err?.message || 'Could not pull from Cloudflare D1.', type: 'error'});
    } finally {
      setIsSyncing(false);
    }
  };

  // Trigger Google Drive Backup Restore
  const prepareDriveRestore = async (): Promise<DriveRestorePreview | null> => {
    if (isSyncing) return null;
    if (!navigator.onLine) {
      showToast({title: 'Offline Mode', message: 'Cannot inspect a Drive backup while offline.', type: 'warning'});
      return null;
    }
    setIsSyncing(true);
    try {
      const preview = await previewLatestDriveBackup();
      setDriveRestorePreview(preview);
      if (!preview) {
        showToast({title: 'No Backups Found', message: 'No backup JSON files were found in the dedicated Drive folder.', type: 'info'});
      }
      return preview;
    } catch (err: any) {
      showToast({title: 'Backup Inspection Failed', message: err?.message || 'Could not inspect the latest Drive backup.', type: 'error'});
      return null;
    } finally {
      setIsSyncing(false);
    }
  };

  const restoreDriveBackup = async () => {
    if (isSyncing) return;

    if (!navigator.onLine) {
      showToast({
        title: 'Offline Mode',
        message: 'Cannot restore backup from Google Drive while offline.',
        type: 'warning',
      });
      return;
    }

    setIsSyncing(true);
    try {
      const res = await restoreFromLatestDriveBackup();
      if (res.success) {
        pingD1Health();
        showToast({
          title: 'Records Restored from Drive',
          message: `Successfully restored ${res.recordCount || 0} records from "${res.fileName}". Cloudflare D1 and local database are now up to date.`,
          type: 'success',
        });
      } else {
        showToast({
          title: 'No Backups Found',
          message: 'No backup JSON files found in the dedicated Google Drive folder.',
          type: 'info',
        });
      }
    } catch (err: any) {
      console.error('Google Drive restore error:', err);
      showToast({
        title: 'Restore Backup Failed',
        message: err?.message || 'Failed to download or parse backup file from Google Drive.',
        type: 'error',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return {
    isOnline,
    isNetworkGood: Boolean(d1Health ? d1Health.connected : isOnline),
    d1Health,
    isCheckingHealth,
    pingD1Health,
    syncMode: 'manual',
    isSyncing,
    syncProgress: null,
    stats: {
      totalLocalRecords: 0,
      unsyncedRecordsCount: unsyncedRecordsCount,
      lastSyncTime: lastDriveBackupTime,
      hasUnsynced: hasDriveUnsynced,
    },
    conflicts: [],
    isConflictModalOpen: false,
    setIsConflictModalOpen: (_open?: boolean) => {},
    resolveConflict: () => {},
    resolveAllConflicts: () => {},
    createSimulatedConflict: () => {},
    isSyncButtonActive: isHeaderSyncActive,
    isHeaderSyncActive,
    unsyncedRecordsCount,
    requiredRecordsForHeaderSync: REQUIRED_HEADER_SYNC_RECORDS,
    isLiveSyncActive: false,
    isQuotaExceeded: false,
    hasDriveUnsynced,
    lastDriveBackupFile,
    lastDriveBackupTime,
    driveAuthStatus,
    isDriveAuthModalOpen,
    setIsDriveAuthModalOpen,
    disconnectDrive: disconnectGoogleDrive,
    authorizeDrive: requestGoogleDriveAuthorization,
    triggerSync: triggerD1Sync,
    triggerSyncAll: () => triggerD1Sync(true),
    triggerD1Pull,
    triggerDriveSync,
    restoreDriveBackup,
    prepareDriveRestore,
    driveRestorePreview,
    pullCentralRecords: triggerD1Pull,
    toggleSyncMode: () => {},
    refreshStats: async () => {},
  };
}
