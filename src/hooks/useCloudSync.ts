import { useState, useEffect, useRef } from 'react';
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
import { ALL_STORES, getAllItems } from '../db/indexedDB';
import { syncLocalRecordsToD1, checkD1Health, type D1Snapshot, type D1HealthStatus } from '../services/d1StorageService';

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

  // Network health monitoring to Cloudflare D1 (every 5 minutes or on-demand)
  const AUTO_PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const [d1Health, setD1Health] = useState<D1HealthStatus | null>(null);
  const d1HealthRef = useRef<D1HealthStatus | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<boolean>(false);

  const { showToast } = useToast();

  const pingD1Health = async (): Promise<D1HealthStatus> => {
    setIsCheckingHealth(true);
    try {
      const health = await checkD1Health();
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

    // Initial ping on mount
    pingD1Health();

    // Automatic health ping interval strictly every 5 minutes
    const interval = setInterval(() => {
      pingD1Health();
    }, AUTO_PING_INTERVAL_MS);

    return () => {
      unsub();
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Trigger Google Drive Backup Upload
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
