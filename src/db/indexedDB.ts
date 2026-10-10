// IndexedDB Local Storage Manager for IdoferaLabs Offline WebApp

import { safeSetLocalStorage } from '../utils/localStorage';
import { migrateRecord, migrateSnapshot } from '../utils/dataMigration';

const DB_NAME = 'IdoferaLabs_OfflineDB';
const DB_VERSION = 3;

export const ALL_STORES = [
  'products',
  'customers',
  'suppliers',
  'sales',
  'purchases',
  'expenses',
  'notifications',
  'auditLogs',
  'stockMovements',
  'pricingHistory',
  'settings',
  'heldOrders',
  'whatsAppPreOrders',
  'deliveryOrders',
  'users',
  'moneyMovements',
] as const;

export type StoreName = (typeof ALL_STORES)[number];

export const LOCAL_BUSINESS_STORES = ALL_STORES.filter((storeName) => storeName !== 'users');

let dbPromise: Promise<IDBDatabase> | null = null;

export function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser environment.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      ALL_STORES.forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      });
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = (event) => {
      console.warn('IndexedDB open warning:', (event.target as IDBOpenDBRequest).error);
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error || new Error('IndexedDB open error'));
    };
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

export async function getItem<T>(storeName: StoreName, id: string): Promise<T | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve((request.result as T) || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`IndexedDB getItem error on ${storeName}/${id}:`, err);
    return null;
  }
}

export async function getAllItems<T>(storeName: StoreName): Promise<T[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve((request.result as T[]) || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`IndexedDB getAllItems error on ${storeName}:`, err);
    return [];
  }
}

export async function getAllLocalStores(): Promise<Record<string, any[]>> {
  const stores: Record<string, any[]> = {};
  await Promise.all(
    LOCAL_BUSINESS_STORES.map(async (name) => {
      stores[name] = await getAllItems(name);
    })
  );
  return stores;
}

export async function putItem<T extends { id: string }>(storeName: StoreName, item: T): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`IndexedDB putItem error on ${storeName}/${item?.id}:`, err);
  }
}

export async function putManyItems<T extends { id: string }>(storeName: StoreName, items: T[]): Promise<void> {
  if (!items.length) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      items.forEach((item) => {
        if (item && item.id) store.put(item);
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`IndexedDB putManyItems error on ${storeName}:`, err);
  }
}

export async function replaceStoreItems<T extends { id: string }>(storeName: StoreName, items: T[]): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      items.forEach((item) => {
        if (item && item.id) store.put(item);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`IndexedDB replaceStoreItems error on ${storeName}:`, err);
  }
}

export async function deleteItem(storeName: StoreName, id: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`IndexedDB deleteItem error on ${storeName}/${id}:`, err);
  }
}

export async function clearStore(storeName: StoreName): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn(`IndexedDB clearStore error on ${storeName}:`, err);
  }
}

export async function getStoreRecordCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  try {
    const db = await getDB();
    for (const storeName of ALL_STORES) {
      const count = await new Promise<number>((resolve) => {
        try {
          if (!db.objectStoreNames.contains(storeName)) {
            resolve(0);
            return;
          }
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const req = store.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(0);
        } catch (err) {
          resolve(0);
        }
      });
      counts[storeName] = count;
    }
  } catch (err) {
    console.warn('IndexedDB getStoreRecordCounts error:', err);
  }
  return counts;
}

export async function exportDatabaseJSON(): Promise<string> {
  // One transaction per store, all in flight together: the sequential loop
  // serialized 15 round-trips before the export could start.
  const entries = await Promise.all(ALL_STORES.map(async (storeName) => {
    const items = await getAllItems(storeName);
    return [storeName, items] as const;
  }));
  const exportData: Record<string, any[]> = Object.fromEntries(entries);
  return JSON.stringify(
    {
      app: 'IdoferaLabs POS',
      version: '2.5',
      exportedAt: new Date().toISOString(),
      data: exportData,
    },
    null,
    2
  );
}

export async function clearAllStores(): Promise<void> {
  for (const storeName of ALL_STORES) {
    await clearStore(storeName);
  }
}

export async function clearLocalBusinessStores(): Promise<void> {
  for (const storeName of LOCAL_BUSINESS_STORES) {
    await clearStore(storeName);
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number; jsonSizeBytes: number }> {
  let usage = 0;
  let quota = 0;

  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage || 0;
      quota = estimate.quota || 0;
    } catch (err) {
      console.warn('Storage estimate error:', err);
    }
  }

  let jsonSizeBytes = 0;
  try {
    const jsonStr = await exportDatabaseJSON();
    jsonSizeBytes = new Blob([jsonStr]).size;
  } catch (err) {
    console.warn('JSON estimate calculation warning:', err);
  }

  return { usage, quota, jsonSizeBytes };
}

export async function importDatabaseJSON(jsonString: string): Promise<boolean> {
  try {
    if (!jsonString || typeof jsonString !== 'string') {
      console.error('importDatabaseJSON: empty or invalid JSON string provided.');
      return false;
    }

    const trimmed = jsonString.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      console.error('importDatabaseJSON: input string does not appear to be valid JSON.');
      return false;
    }

    const parsed = JSON.parse(trimmed);
    const data = parsed.data || parsed;

    if (!data || typeof data !== 'object') {
      console.error('importDatabaseJSON: parsed JSON missing root data object.');
      return false;
    }

    // Remove the cleared_empty flag so the application reads the restored data on boot
    localStorage.removeItem('idofera_cleared_empty');

    const migratedData = migrateSnapshot(data);

    for (const storeName of ALL_STORES) {
      const storeItems = migratedData[storeName];

      if (Array.isArray(storeItems)) {
        // Ensure every item has a valid 'id' property and normalize schema
        const validatedItems = storeItems
          .map((item: any, idx: number) => {
            if (!item || typeof item !== 'object') return null;
            return item.id ? item : { ...item, id: `${storeName}-${Date.now()}-${idx}` };
          })
          .filter(Boolean);

        // Put into IndexedDB
        await clearStore(storeName);
        await putManyItems(storeName, validatedItems);

        // Settings remain a small local preference. Business collections stay
        // in IndexedDB and the restore event updates the active UI below.
        if (storeName === 'settings') {
          if (validatedItems.length > 0) {
            safeSetLocalStorage('idofera_settings', JSON.stringify(validatedItems[0]));
          }
        }
      } else if (storeItems && typeof storeItems === 'object') {
        // Single object store format
        if (storeName === 'settings') {
          const rawObj = storeItems as any;
          const settingsObj = migrateRecord('settings', { ...rawObj, id: rawObj.id || 'store_settings' });
          await clearStore('settings');
          await putItem('settings', settingsObj);
          safeSetLocalStorage('idofera_settings', JSON.stringify(settingsObj));
        }
      }
    }

    // Special handling for users store in localStorage
    if (Array.isArray(data.users) && data.users.length > 0) {
      const activeUser = data.users.find((u: any) => u && u.id && u.role === 'SuperAdmin') ||
        data.users.find((u: any) => u && u.id) ||
        data.users[0];
      if (activeUser && activeUser.id) {
        safeSetLocalStorage('idofera_current_user_id', activeUser.id);
      }
    }

    // Dispatch global event so active React Contexts update immediately in memory
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('idofera_db_restored', { detail: data }));
    }

    return true;
  } catch (err) {
    console.error('Failed to import IndexedDB JSON backup:', err);
    return false;
  }
}

export async function writeD1SnapshotToIndexedDB(stores: Record<string, any[]>): Promise<void> {
  if (!stores || typeof stores !== 'object') return;
  const migratedStores = migrateSnapshot(stores);
  const storeNames = [
    'products',
    'customers',
    'suppliers',
    'sales',
    'purchases',
    'expenses',
    'notifications',
    'auditLogs',
    'stockMovements',
    'pricingHistory',
    'heldOrders',
    'whatsAppPreOrders',
    'deliveryOrders',
    'moneyMovements',
  ] as const;

  try {
    await Promise.all([
      ...storeNames.map((name) => {
        if (Array.isArray(migratedStores[name])) {
          return replaceStoreItems(name, migratedStores[name]);
        }
        return Promise.resolve();
      }),
      migratedStores.settings && Array.isArray(migratedStores.settings) && migratedStores.settings.length > 0
        ? putItem('settings', migrateRecord('settings', { ...migratedStores.settings[0], id: 'store_settings' }))
        : Promise.resolve(),
    ]);
  } catch (err) {
    console.warn('writeD1SnapshotToIndexedDB warning:', err);
  }
}

