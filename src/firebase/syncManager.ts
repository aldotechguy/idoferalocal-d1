import { broadcastTabChange, subscribeTabSync } from './services';
import { SyncConflict } from '../types';

export { broadcastTabChange, subscribeTabSync };

export interface SyncProgress {
  totalStores: number;
  completedStores: number;
  currentStore: string;
  statusText: string;
}

export interface SyncStats {
  totalLocalRecords: number;
  unsyncedRecordsCount: number;
  hasUnsynced: boolean;
}

export function isQuotaExceeded(): boolean {
  return false;
}

export function isQuotaError(err: any): boolean {
  return false;
}

export function markQuotaExceeded(): void {}

export function markIdDeleted(storeName: string, id: string): void {}

export async function runStartupSyncProtocol(onProgress?: (progress: SyncProgress) => void): Promise<{ success: boolean; syncedCount: number }> {
  return { success: true, syncedCount: 0 };
}

export async function triggerManualSync(onProgress?: (progress: SyncProgress) => void): Promise<{ success: boolean; syncedCount: number }> {
  return { success: true, syncedCount: 0 };
}

export function subscribeCloudDataMerged(callback: (data: any) => void): () => void {
  return () => {};
}

export function subscribeConflicts(callback: (conflicts: SyncConflict[]) => void): () => void {
  return () => {};
}

export function resolveConflict(conflictId: string, choice: 'local' | 'cloud'): void {}
