import {
  getAllItems,
  putItem,
  deleteItem,
  StoreName,
} from '../db/indexedDB';
import { markItemUnsyncedKey } from '../services/googleDriveService';
import { markD1RecordChanged, markD1RecordDeleted } from '../services/d1StorageService';

const TAB_ID = typeof window !== 'undefined' ? Math.random().toString(36).substring(2, 9) : 'srv';
let tabChannel: BroadcastChannel | null = null;

try {
  if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
    tabChannel = new BroadcastChannel('idofera_tab_sync_channel');
  }
} catch (e) {
  tabChannel = null;
}

export function broadcastTabChange(storeName: string, data: any, action: 'save' | 'remove'): void {
  if (tabChannel) {
    try {
      tabChannel.postMessage({
        storeName,
        data,
        action,
        senderTabId: TAB_ID,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.warn('Tab sync broadcast error:', e);
    }
  }
}

export function subscribeTabSync(
  callback: (event: { storeName: string; data: any; action: 'save' | 'remove' }) => void
): () => void {
  if (!tabChannel) return () => {};
  const handler = (msgEvent: MessageEvent) => {
    const data = msgEvent.data;
    if (data && data.senderTabId !== TAB_ID && data.storeName) {
      callback({ storeName: data.storeName, data: data.data, action: data.action });
    }
  };
  tabChannel.addEventListener('message', handler);
  return () => {
    tabChannel?.removeEventListener('message', handler);
  };
}

export async function saveDocument<T extends { id: string }>(
  collectionName: string,
  data: T
): Promise<void> {
  const localData = { ...data, _lastSyncedAt: new Date().toISOString() };
  markD1RecordChanged(collectionName, data.id);

  // 1. Save locally in IndexedDB
  try {
    await putItem(collectionName as StoreName, localData);
    markItemUnsyncedKey(collectionName, data.id);
  } catch (err) {
    console.warn(`IndexedDB save error on ${collectionName}/${data.id}:`, err);
  }

  // 2. Broadcast change across browser tabs instantly
  broadcastTabChange(collectionName, localData, 'save');
}

export async function removeDocument(collectionName: string, id: string): Promise<void> {
  const strId = String(id);
  markD1RecordDeleted(collectionName, strId);

  // 1. Remove locally from IndexedDB
  try {
    await deleteItem(collectionName as StoreName, strId);
    markItemUnsyncedKey(collectionName, strId);
  } catch (err) {
    console.warn(`IndexedDB delete error on ${collectionName}/${strId}:`, err);
  }

  // 2. Broadcast change across browser tabs instantly
  broadcastTabChange(collectionName, { id: strId }, 'remove');
}

export async function fetchCollection<T>(collectionName: string): Promise<T[]> {
  try {
    const items = await getAllItems<T>(collectionName as StoreName);
    return items;
  } catch (err) {
    console.warn(`IndexedDB fetch error on ${collectionName}:`, err);
    return [];
  }
}

export function subscribeCollection<T>(
  collectionName: string,
  callback: (data: T[]) => void
) {
  try {
    getAllItems<T>(collectionName as StoreName)
      .then((items) => {
        callback(items || []);
      })
      .catch((err) => {
        console.warn(`IndexedDB subscribe warning on ${collectionName}:`, err);
        callback([]);
      });
  } catch (err) {
    console.warn(`IndexedDB subscribe warning on ${collectionName}:`, err);
    callback([]);
  }
  return () => {};
}
