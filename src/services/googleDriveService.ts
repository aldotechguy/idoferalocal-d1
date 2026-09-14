import { exportDatabaseJSON, importDatabaseJSON } from '../db/indexedDB';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from '../firebase/config';
import firebaseConfig from '../../firebase-applet-config.json';
import { readD1ForBackup, replaceD1FromRecovery, type D1Snapshot } from './d1StorageService';
import { safeSetLocalStorage } from '../utils/localStorage';
import { migrateRecord, migrateSnapshot } from '../utils/dataMigration';

export const DEDICATED_DRIVE_FOLDER_ID = '11KHJv7CPD7OLcI5w_1MCc_YO70Re8CV9';
export const DEFAULT_GOOGLE_DRIVE_API_KEY = 'AIzaSyCrJexCUhktsNrT2obqJtqExbukggOqPYQ';

const LOCAL_UNSYNCED_KEY = 'idofera_has_unsynced_local_changes';
const LAST_BACKUP_FILE_KEY = 'idofera_last_drive_backup_file';
const LAST_BACKUP_TIME_KEY = 'idofera_last_drive_backup_time';
const DRIVE_API_KEY_STORAGE_KEY = 'idofera_google_drive_api_key';
const DRIVE_ACCESS_TOKEN_STORAGE_KEY = 'idofera_google_drive_access_token';
const DRIVE_CONNECTED_EMAIL_STORAGE_KEY = 'idofera_google_drive_connected_email';

let syncListeners: (() => void)[] = [];

export function setGoogleDriveAccessToken(token: string | null, email?: string | null) {
  if (token && token.trim()) {
    safeSetLocalStorage(DRIVE_ACCESS_TOKEN_STORAGE_KEY, token.trim());
    if (email && email.trim()) {
      safeSetLocalStorage(DRIVE_CONNECTED_EMAIL_STORAGE_KEY, email.trim());
    }
  } else {
    localStorage.removeItem(DRIVE_ACCESS_TOKEN_STORAGE_KEY);
    if (!email) {
      localStorage.removeItem(DRIVE_CONNECTED_EMAIL_STORAGE_KEY);
    }
  }
  notifyListeners();
}

export function getGoogleDriveAccessToken(): string | null {
  return localStorage.getItem(DRIVE_ACCESS_TOKEN_STORAGE_KEY);
}

export function getGoogleDriveConnectedEmail(): string | null {
  return localStorage.getItem(DRIVE_CONNECTED_EMAIL_STORAGE_KEY);
}

export function disconnectGoogleDrive() {
  localStorage.removeItem(DRIVE_ACCESS_TOKEN_STORAGE_KEY);
  localStorage.removeItem(DRIVE_CONNECTED_EMAIL_STORAGE_KEY);
  notifyListeners();
}

export function setGoogleDriveApiKey(apiKey: string | null) {
  if (apiKey && apiKey.trim()) {
    safeSetLocalStorage(DRIVE_API_KEY_STORAGE_KEY, apiKey.trim());
  } else {
    localStorage.removeItem(DRIVE_API_KEY_STORAGE_KEY);
  }
  notifyListeners();
}

export function getGoogleDriveApiKey(): string {
  const storedKey = localStorage.getItem(DRIVE_API_KEY_STORAGE_KEY);
  if (storedKey) return storedKey;
  
  const envKey = (import.meta as any).env?.VITE_GOOGLE_DRIVE_API_KEY;
  if (envKey) return envKey;

  return DEFAULT_GOOGLE_DRIVE_API_KEY;
}

export function isGoogleDriveConnected(): boolean {
  return Boolean(getGoogleDriveAccessToken() || getGoogleDriveApiKey());
}

export function getGoogleDriveAuthStatus(): {
  isConnected: boolean;
  isAuthorizedWithOAuth: boolean;
  email: string | null;
  hasApiKeyFallback: boolean;
} {
  const token = getGoogleDriveAccessToken();
  const email = getGoogleDriveConnectedEmail();
  const apiKey = getGoogleDriveApiKey();
  return {
    isConnected: Boolean(token || apiKey),
    isAuthorizedWithOAuth: Boolean(token),
    email: email || null,
    hasApiKeyFallback: Boolean(apiKey),
  };
}

const UNSYNCED_COUNT_KEY = 'idofera_unsynced_local_changes_count';
const UNSYNCED_ITEM_KEYS_STORAGE_KEY = 'idofera_unsynced_item_keys';
const DISMISSED_UNSYNCED_KEYS_STORAGE_KEY = 'idofera_dismissed_unsynced_keys';
export const REQUIRED_HEADER_SYNC_RECORDS = 1;

// Inspect Changes categories use short labels while IndexedDB/D1 use store
// names (deliveries <-> deliveryOrders, whatsapp <-> whatsAppPreOrders).
// Both spellings refer to the same pending D1 record, so all helpers below
// resolve every alias variant.
const UNSYNCED_CATEGORY_ALIASES: Record<string, string[]> = {
  sales: ['sales'],
  products: ['products'],
  customers: ['customers'],
  deliveries: ['deliveries', 'deliveryOrders'],
  deliveryOrders: ['deliveries', 'deliveryOrders'],
  whatsapp: ['whatsapp', 'whatsAppPreOrders'],
  whatsAppPreOrders: ['whatsapp', 'whatsAppPreOrders'],
  expenses: ['expenses'],
  suppliers: ['suppliers'],
  purchases: ['purchases'],
  heldOrders: ['heldOrders'],
  moneyMovements: ['moneyMovements'],
};

function getUnsyncedKeyVariants(category: string, id: string): string[] {
  const strId = String(id);
  const aliases = UNSYNCED_CATEGORY_ALIASES[category] || [category];
  return aliases.map((alias) => `${alias}:${strId}`);
}

// Canonical IndexedDB/D1 store name for a category alias. Writers
// (saveDocument/removeDocument) use store names, while Inspect uses short
// labels — both resolve to the same canonical store for sync/discard.
function getCanonicalUnsyncedStore(category: string): string {
  const canonical: Record<string, string> = {
    sales: 'sales',
    products: 'products',
    customers: 'customers',
    deliveries: 'deliveryOrders',
    deliveryOrders: 'deliveryOrders',
    whatsapp: 'whatsAppPreOrders',
    whatsAppPreOrders: 'whatsAppPreOrders',
    expenses: 'expenses',
    suppliers: 'suppliers',
    purchases: 'purchases',
    heldOrders: 'heldOrders',
    moneyMovements: 'moneyMovements',
  };
  return canonical[category] || category;
}

function getUnsyncedCategoryPrefixes(category: string): string[] {
  const aliases = UNSYNCED_CATEGORY_ALIASES[category] || [category];
  return aliases.map((alias) => `${alias}:`);
}

export function getUnsyncedItemKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(UNSYNCED_ITEM_KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function getDismissedUnsyncedKeys(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function dismissItemFromUnsynced(category: string, id: string) {
  if (typeof localStorage === 'undefined' || !id) return;
  const variants = getUnsyncedKeyVariants(category, id);

  // 1. Remove all alias variants from explicit unsynced keys if present
  // Inspect Changes is D1-pending only (explicit keys), so removal hides the row
  // while the IndexedDB record stays intact.
  const unsyncedKeys = new Set(getUnsyncedItemKeys());
  let removed = false;
  variants.forEach((key) => {
    if (unsyncedKeys.has(key)) {
      unsyncedKeys.delete(key);
      removed = true;
    }
  });
  if (removed) {
    safeSetLocalStorage(UNSYNCED_ITEM_KEYS_STORAGE_KEY, JSON.stringify(Array.from(unsyncedKeys)));
    setUnsyncedLocalChangesCount(unsyncedKeys.size);
  }

  // 2. Add all alias variants to dismissed keys so future checks stay hidden
  // until the record is explicitly modified again.
  const dismissedKeys = new Set(getDismissedUnsyncedKeys());
  variants.forEach((key) => dismissedKeys.add(key));
  safeSetLocalStorage(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY, JSON.stringify(Array.from(dismissedKeys)));
  notifyListeners();
}

export function dismissCategoryFromUnsynced(category: string) {
  if (typeof localStorage === 'undefined') return;
  const prefixes = getUnsyncedCategoryPrefixes(category);
  const matches = (k: string) => prefixes.some((prefix) => k.startsWith(prefix));

  // 1. Filter out all alias variants from unsynced keys (record stays in IndexedDB)
  const unsyncedKeys = getUnsyncedItemKeys();
  const filteredUnsynced = unsyncedKeys.filter((k) => !matches(k));
  safeSetLocalStorage(UNSYNCED_ITEM_KEYS_STORAGE_KEY, JSON.stringify(filteredUnsynced));
  setUnsyncedLocalChangesCount(filteredUnsynced.length);

  // 2. Remember dismissed variants so the D1-pending-only filter stays hidden
  // until the record is explicitly modified again.
  const dismissedKeys = new Set(getDismissedUnsyncedKeys());
  unsyncedKeys.filter(matches).forEach((k) => dismissedKeys.add(k));
  safeSetLocalStorage(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY, JSON.stringify(Array.from(dismissedKeys)));
  notifyListeners();
}

export function markItemUnsyncedKey(category: string, id: string) {
  if (typeof localStorage === 'undefined' || !id) return;
  const variants = getUnsyncedKeyVariants(category, id);

  // If item was previously dismissed, un-dismiss all alias variants when a new change happens
  const dismissedKeys = new Set(getDismissedUnsyncedKeys());
  let dismissedChanged = false;
  variants.forEach((key) => {
    if (dismissedKeys.has(key)) {
      dismissedKeys.delete(key);
      dismissedChanged = true;
    }
  });
  if (dismissedChanged) {
    safeSetLocalStorage(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY, JSON.stringify(Array.from(dismissedKeys)));
  }

  const keys = new Set(getUnsyncedItemKeys());
  // Keep the canonical spelling used by D1 writers (first alias, i.e. the
  // IndexedDB store name) so Sync Now, Inspect, and Discard resolve alike.
  const canonicalKey = variants[0];
  if (!variants.some((key) => keys.has(key))) {
    keys.add(canonicalKey);
    safeSetLocalStorage(UNSYNCED_ITEM_KEYS_STORAGE_KEY, JSON.stringify(Array.from(keys)));
    setUnsyncedLocalChangesCount(keys.size);
  }
}

export function removeItemUnsyncedKey(category: string, id: string) {
  dismissItemFromUnsynced(category, id);
}

export function removeCategoryUnsyncedKeys(category: string) {
  dismissCategoryFromUnsynced(category);
}

export function isItemUnsynced(category: string, id: string, _dateOrCreatedAt?: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  const variants = getUnsyncedKeyVariants(category, id);

  // If user explicitly dismissed this item from the unsynced inspector,
  // keep it hidden until the record is modified again.
  const dismissedKeys = new Set(getDismissedUnsyncedKeys());
  if (variants.some((key) => dismissedKeys.has(key))) return false;

  // Inspect Changes shows only local records pending D1 sync (explicit keys).
  // Drive backup timestamps intentionally do not affect this D1-pending state.
  const keys = new Set(getUnsyncedItemKeys());
  return variants.some((key) => keys.has(key));
}

export function markLocalChangesUnsynced(countIncrement: number = 1) {
  const currentCount = getUnsyncedLocalChangesCount();
  const inc = typeof countIncrement === 'number' && countIncrement > 0 ? countIncrement : 1;
  const newCount = currentCount + inc;
  safeSetLocalStorage(UNSYNCED_COUNT_KEY, String(newCount));
  safeSetLocalStorage(LOCAL_UNSYNCED_KEY, 'true');
  notifyListeners();
}

export function decrementUnsyncedLocalChangesCount(amount: number = 1) {
  const currentCount = getUnsyncedLocalChangesCount();
  const newCount = Math.max(0, currentCount - amount);
  safeSetLocalStorage(UNSYNCED_COUNT_KEY, String(newCount));
  if (newCount === 0) {
    localStorage.removeItem(LOCAL_UNSYNCED_KEY);
  }
  notifyListeners();
}

export function setUnsyncedLocalChangesCount(newCount: number) {
  const count = Math.max(0, newCount);
  safeSetLocalStorage(UNSYNCED_COUNT_KEY, String(count));
  if (count === 0) {
    localStorage.removeItem(LOCAL_UNSYNCED_KEY);
  } else {
    safeSetLocalStorage(LOCAL_UNSYNCED_KEY, 'true');
  }
  notifyListeners();
}

export function clearUnsyncedLocalChanges() {
  // Discard resets D1-pending state, so dismissed flags must reset too or
  // they would hide records newly marked unsynced after a future edit.
  safeSetLocalStorage(UNSYNCED_COUNT_KEY, '0');
  localStorage.removeItem(LOCAL_UNSYNCED_KEY);
  localStorage.removeItem(UNSYNCED_ITEM_KEYS_STORAGE_KEY);
  localStorage.removeItem(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY);
  notifyListeners();
}

export function getUnsyncedLocalChangesCount(): number {
  if (typeof localStorage === 'undefined') return 0;
  // Inspect Changes is D1-pending only: explicit keys minus dismissed keys.
  // Drive backup time is excluded, and alias spellings (deliveries/
  // deliveryOrders, whatsapp/whatsAppPreOrders) refer to one record.
  const keys = new Set(getUnsyncedItemKeys());
  try {
    const raw = localStorage.getItem(DISMISSED_UNSYNCED_KEYS_STORAGE_KEY);
    const dismissedList: string[] = raw ? JSON.parse(raw) : [];
    if (dismissedList.length > 0) {
      const dismissedIds = new Map<string, Set<string>>();
      dismissedList.forEach((rawKey) => {
        const separator = String(rawKey).lastIndexOf(':');
        if (separator <= 0) return;
        const category = String(rawKey).slice(0, separator);
        const id = String(rawKey).slice(separator + 1);
        const canonical = getCanonicalUnsyncedStore(category);
        if (!dismissedIds.has(canonical)) dismissedIds.set(canonical, new Set<string>());
        dismissedIds.get(canonical)!.add(id);
      });
      keys.forEach((rawKey) => {
        const separator = String(rawKey).lastIndexOf(':');
        if (separator <= 0) return;
        const category = String(rawKey).slice(0, separator);
        const id = String(rawKey).slice(separator + 1);
        if (dismissedIds.get(getCanonicalUnsyncedStore(category))?.has(id)) keys.delete(rawKey);
      });
    }
  } catch (e) {
    // ignore malformed dismissed list
  }
  const count = keys.size;
  if (localStorage.getItem(UNSYNCED_COUNT_KEY) !== String(count)) {
    safeSetLocalStorage(UNSYNCED_COUNT_KEY, String(count));
  }
  return count;
}

export function isHeaderSyncActivated(): boolean {
  return true;
}

export function hasUnsyncedLocalChanges(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_UNSYNCED_KEY) === 'true' || getUnsyncedLocalChangesCount() > 0;
}

export function getLastBackupFileName(): string | null {
  return localStorage.getItem(LAST_BACKUP_FILE_KEY);
}

export function getLastBackupTime(): string | null {
  return localStorage.getItem(LAST_BACKUP_TIME_KEY);
}

export function subscribeGoogleDriveSync(listener: () => void): () => void {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter((l) => l !== listener);
  };
}

function notifyListeners() {
  syncListeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.warn('Sync listener error:', e);
    }
  });
}

export interface DriveBackupFile {
  id: string;
  name: string;
  createdTime: string;
  size?: string;
}

export interface DriveRestorePreview {
  fileName: string;
  createdTime: string;
  totalRecords: number;
  storeCounts: Record<string, number>;
}

let preparedRestore: { file: DriveBackupFile; jsonString: string } | null = null;

export const D1_BUSINESS_COLLECTIONS = [
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
  'moneyMovements',
] as const;

export type D1BusinessCollection = typeof D1_BUSINESS_COLLECTIONS[number];
export const D1_RECOVERY_STORES = D1_BUSINESS_COLLECTIONS;

export interface D1BackupData {
  products: any[];
  customers: any[];
  suppliers: any[];
  sales: any[];
  purchases: any[];
  expenses: any[];
  notifications: any[];
  auditLogs: any[];
  stockMovements: any[];
  pricingHistory: any[];
  settings: any[];
  heldOrders: any[];
  whatsAppPreOrders: any[];
  deliveryOrders: any[];
  moneyMovements: any[];
  [key: string]: any[];
}

export interface D1BackupPayload {
  version: 2;
  source: 'd1';
  d1Revision: number;
  exportedAt: string;
  data: D1BackupData;
}

export function generateBackupFileName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  const timestampStr = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
  return `idofera_backup_${timestampStr}.json`;
}

export function buildD1BackupPayload(
  rawStores: Record<string, any>,
  revision: number,
  exportedAt: string = new Date().toISOString()
): { payload: D1BackupPayload; jsonString: string; totalRecords: number } {
  const normalizedInput = migrateSnapshot(rawStores || {});
  const data: Record<string, any[]> = {};
  let totalRecords = 0;

  for (const collection of D1_BUSINESS_COLLECTIONS) {
    const rawVal = normalizedInput?.[collection] as any;
    if (Array.isArray(rawVal)) {
      data[collection] = rawVal;
      totalRecords += rawVal.length;
    } else if (collection === 'settings' && rawVal && typeof rawVal === 'object') {
      const arr = [migrateRecord('settings', { ...rawVal, id: rawVal.id || 'store_settings' })];
      data[collection] = arr;
      totalRecords += arr.length;
    } else {
      data[collection] = [];
    }
  }

  const payload: D1BackupPayload = {
    version: 2,
    source: 'd1',
    d1Revision: Number(revision || 0),
    exportedAt,
    data: data as D1BackupData,
  };

  const jsonString = JSON.stringify(payload, null, 2);

  return { payload, jsonString, totalRecords };
}

export async function createD1BackupExport(): Promise<{
  fileName: string;
  revision: number;
  totalRecords: number;
  jsonString: string;
  blob: Blob;
  payload: D1BackupPayload;
}> {
  const cloud = await readD1ForBackup();
  const now = new Date();
  const fileName = generateBackupFileName(now);
  const { payload, jsonString, totalRecords } = buildD1BackupPayload(
    cloud.stores,
    cloud.revision,
    now.toISOString()
  );
  const blob = new Blob([jsonString], { type: 'application/json' });
  return {
    fileName,
    revision: payload.d1Revision,
    totalRecords,
    jsonString,
    blob,
    payload,
  };
}

function parseBackupData(jsonString: string): Record<string, any> {
  const parsed = JSON.parse(jsonString);
  const data = parsed?.data || parsed;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Backup JSON does not contain a valid data object.');
  }
  return data;
}

function buildRecoverySnapshot(data: Record<string, any>): D1Snapshot {
  const normalizedData = migrateSnapshot(data || {});
  return Object.fromEntries(
    D1_RECOVERY_STORES.map((store) => {
      const value = normalizedData[store] as any;
      if (Array.isArray(value)) {
        return [store, value];
      }
      if (store === 'settings' && value && typeof value === 'object') {
        return [store, [migrateRecord(store, { ...value, id: value.id || 'store_settings' })]];
      }
      return [store, []];
    }),
  );
}

export async function previewLatestDriveBackup(): Promise<DriveRestorePreview | null> {
  const latest = await fetchLatestBackupFromDrive();
  if (!latest) return null;
  const data = parseBackupData(latest.jsonString);
  const storeCounts = Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => Array.isArray(value))
      .map(([store, value]) => [store, value.length]),
  );
  preparedRestore = latest;
  return {
    fileName: latest.file.name,
    createdTime: latest.file.createdTime,
    totalRecords: Object.values(storeCounts).reduce((sum, count) => sum + count, 0),
    storeCounts,
  };
}

/**
 * Interactive user-gesture authorization for Google Drive.
 * Designed to be called directly from click event handlers to avoid popup blockers.
 */
export async function requestGoogleDriveAuthorization(): Promise<{ accessToken: string; email?: string }> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const newToken = credential?.accessToken || null;
    const userEmail = result.user?.email || undefined;
    if (newToken) {
      setGoogleDriveAccessToken(newToken, userEmail);
      return { accessToken: newToken, email: userEmail };
    }
  } catch (err: any) {
    console.warn('Firebase popup authorization failed; trying Google Identity Services:', err);
    try {
      const token = await requestGoogleIdentityServicesToken();
      setGoogleDriveAccessToken(token);
      return { accessToken: token };
    } catch (fallbackError: any) {
      console.error('Failed to obtain Google Drive access token:', fallbackError);
      throw new Error(fallbackError?.message || 'Google Drive authorization was cancelled or blocked. Allow pop-ups and try again.');
    }
  }

  throw new Error('Could not obtain Google Drive access token. Please sign in with Google.');
}

/**
 * Obtain a valid Google OAuth access token for Drive operations
 */
export async function getOrRequestDriveAccessToken(): Promise<string> {
  const existingToken = getGoogleDriveAccessToken();
  if (existingToken) return existingToken;

  const authResult = await requestGoogleDriveAuthorization();
  return authResult.accessToken;
}

async function requestGoogleIdentityServicesToken(): Promise<string> {
  const clientId = String((firebaseConfig as any).oAuthClientId || '');
  if (!clientId) throw new Error('Google OAuth client ID is not configured.');
  const google = await new Promise<any>((resolve, reject) => {
    const existing = (window as any).google;
    if (existing?.accounts?.oauth2) return resolve(existing);
    const prior = document.querySelector<HTMLScriptElement>('script[data-google-identity-services]');
    const script = prior || document.createElement('script');
    script.setAttribute('data-google-identity-services', 'true');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve((window as any).google);
    script.onerror = () => reject(new Error('Could not load Google authorization. Check the connection and try again.'));
    if (!prior) document.head.appendChild(script);
  });
  return await new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive',
      prompt: 'consent select_account',
      callback: (response: any) => response?.access_token ? resolve(response.access_token) : reject(new Error(response?.error_description || response?.error || 'Google authorization was cancelled.')),
      error_callback: (error: any) => reject(new Error(error?.message || error?.type || 'Google authorization popup failed.')),
    });
    client.requestAccessToken();
  });
}

/**
 * List all backup files in the dedicated Google Drive folder (11KHJv7CPD7OLcI5w_1MCc_YO70Re8CV9)
 */
export async function listDriveBackups(customTokenOrApiKey?: string): Promise<DriveBackupFile[]> {
  let token = getGoogleDriveAccessToken();
  const apiKey = getGoogleDriveApiKey();

  // Exclude folders so files like "trash" are not treated as backup archives
  const query = `'${DEDICATED_DRIVE_FOLDER_ID}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
  const baseUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&orderBy=createdTime desc&fields=files(id,name,createdTime,size,mimeType)&pageSize=100`;

  const headers: Record<string, string> = {};
  let url = baseUrl;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (apiKey) {
    url = `${baseUrl}&key=${encodeURIComponent(apiKey)}`;
  }

  let response: Response | null = null;
  try {
    response = await fetch(url, { headers });

    if (response && (response.status === 401 || response.status === 403) && headers['Authorization']) {
      // Stored token is invalid or expired. Clear it and retry using API key without Authorization header.
      setGoogleDriveAccessToken(null);
      delete headers['Authorization'];
      url = `${baseUrl}&key=${encodeURIComponent(apiKey)}`;
      response = await fetch(url, { headers });
    }
  } catch (netErr) {
    console.warn('Direct Google Drive API list failed, trying server proxy:', netErr);
  }

  // If direct fetch succeeded and is OK
  if (response && response.ok) {
    const data = await response.json();
    const rawFiles: any[] = data.files || [];
    const backupFiles = rawFiles.filter((file) => {
      const name = String(file.name || '').toLowerCase();
      return name.endsWith('.json') || name.startsWith('idofera_backup');
    });
    return backupFiles;
  }

  // Fallback to server proxy route
  try {
    const proxyRes = await fetch('/api/drive/backups');
    if (proxyRes.ok) {
      const proxyData = await proxyRes.json();
      if (Array.isArray(proxyData.files)) {
        return proxyData.files;
      }
    }
  } catch (proxyErr) {
    console.warn('Server proxy list fallback failed:', proxyErr);
  }

  if (response && !response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const errorMsg = errorData.error?.message || `Google Drive API error (${response.status}): ${response.statusText}`;
    throw new Error(errorMsg);
  }

  return [];
}

/**
 * Fetch and return the content of the most recent backup JSON file in the dedicated folder
 */
export async function fetchLatestBackupFromDrive(
  customTokenOrApiKey?: string
): Promise<{ file: DriveBackupFile; jsonString: string } | null> {
  const files = await listDriveBackups(customTokenOrApiKey);
  if (!files || files.length === 0) {
    // Try server proxy route directly
    try {
      const proxyRes = await fetch('/api/drive/latest-backup');
      if (proxyRes.ok) {
        const proxyData = await proxyRes.json();
        if (proxyData.file && proxyData.jsonString) {
          return { file: proxyData.file, jsonString: proxyData.jsonString };
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  let token = getGoogleDriveAccessToken();
  const apiKey = getGoogleDriveApiKey();

  // Try candidate backup files from newest to oldest
  for (const candidateFile of files) {
    // Skip obvious non-JSON or folder files
    const fileName = String(candidateFile.name || '').toLowerCase();
    if (!fileName.endsWith('.json') && !fileName.includes('backup')) continue;

    const baseUrl = `https://www.googleapis.com/drive/v3/files/${candidateFile.id}?alt=media`;
    let downloadUrl = baseUrl;
    const headers: Record<string, string> = {};

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (apiKey) {
      downloadUrl = `${baseUrl}&key=${encodeURIComponent(apiKey)}`;
    }

    try {
      let response = await fetch(downloadUrl, { headers });

      if (response.status === 401 || response.status === 403) {
        setGoogleDriveAccessToken(null);
        delete headers['Authorization'];
        downloadUrl = `${baseUrl}&key=${encodeURIComponent(apiKey)}`;
        response = await fetch(downloadUrl, { headers });
      }

      if (!response.ok) {
        const publicUrl = `https://drive.google.com/uc?export=download&id=${candidateFile.id}`;
        const fallbackResp = await fetch(publicUrl);
        if (fallbackResp.ok) {
          response = fallbackResp;
        }
      }

      if (response.ok) {
        const jsonString = await response.text();
        const trimmed = jsonString.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          // Valid JSON archive found
          return { file: candidateFile, jsonString: trimmed };
        }
      }
    } catch (fetchErr) {
      console.warn(`Direct download of ${candidateFile.name} failed:`, fetchErr);
    }
  }

  // If client-side downloads were blocked (e.g. CORS/extensions), use server proxy
  try {
    const proxyRes = await fetch('/api/drive/latest-backup');
    if (proxyRes.ok) {
      const proxyData = await proxyRes.json();
      if (proxyData.file && proxyData.jsonString) {
        return { file: proxyData.file, jsonString: proxyData.jsonString };
      }
    }
  } catch (proxyErr) {
    console.warn('Server proxy latest-backup failed:', proxyErr);
  }

  throw new Error('Unable to download a valid backup JSON from Google Drive. Please check your network connection.');
}

/**
 * Restore both Cloudflare D1 and local IndexedDB records from the most recent backup JSON file in Google Drive
 */
export async function restoreFromLatestDriveBackup(
  customTokenOrApiKey?: string
): Promise<{ success: boolean; fileName?: string; createdTime?: string; recordCount?: number }> {
  const latest = preparedRestore || await fetchLatestBackupFromDrive(customTokenOrApiKey);
  preparedRestore = null;
  if (!latest) {
    return { success: false };
  }

  const data = parseBackupData(latest.jsonString);
  const recoverySnapshot = buildRecoverySnapshot(data);

  // 1. Authoritatively update Cloudflare D1
  await replaceD1FromRecovery(recoverySnapshot);

  // 2. Fully restore local IndexedDB records
  try {
    await importDatabaseJSON(latest.jsonString);
  } catch (idbErr) {
    console.warn('Could not directly import to IndexedDB during Drive restore:', idbErr);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('idofera_db_restored', { detail: data }));
    }
  }

  // 3. Mark local state as completely in sync with cloud
  clearUnsyncedLocalChanges();
  safeSetLocalStorage(LAST_BACKUP_FILE_KEY, latest.file.name);
  safeSetLocalStorage(LAST_BACKUP_TIME_KEY, latest.file.createdTime || new Date().toISOString());
  notifyListeners();

  return {
    success: true,
    fileName: latest.file.name,
    createdTime: latest.file.createdTime,
    recordCount: Object.values(recoverySnapshot).reduce((sum, records) => sum + records.length, 0),
  };
}

/**
 * Upload a new JSON backup file containing current local IndexedDB records to the dedicated Google Drive folder
 */
export async function uploadBackupToDrive(
  customToken?: string,
  jsonOverride?: string,
  fileNameOverride?: string
): Promise<DriveBackupFile> {
  let token = (customToken && !customToken.startsWith('AIzaSy')) ? customToken : getGoogleDriveAccessToken();
  if (!token) {
    token = await getOrRequestDriveAccessToken();
  }

  const jsonContent = jsonOverride || await exportDatabaseJSON();
  const fileName = fileNameOverride || generateBackupFileName();

  const metadata = {
    name: fileName,
    parents: [DEDICATED_DRIVE_FOLDER_ID],
    mimeType: 'application/json',
  };

  const boundary = '-------IdoferaBackupBoundary' + Math.random().toString(36).substring(2);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    jsonContent +
    closeDelimiter;

  const uploadUrl = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,size`;

  const sendPostRequest = async (authToken: string) => {
    return await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Authorization': `Bearer ${authToken}`,
      },
      body: body,
    });
  };

  let response = await sendPostRequest(token);

  if (response.status === 401) {
    // Token is expired or invalid. Clear old token and prompt for re-authorization
    setGoogleDriveAccessToken(null);
    try {
      token = await getOrRequestDriveAccessToken();
      response = await sendPostRequest(token);
    } catch (authErr: any) {
      throw new Error(authErr?.message || 'Google Drive authorization expired or invalid. Please sign in with Google to re-authorize backup uploads.');
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Failed to upload backup to Google Drive (${response.status})`);
  }

  const file: DriveBackupFile = await response.json();

  clearUnsyncedLocalChanges();
  safeSetLocalStorage(LAST_BACKUP_FILE_KEY, file.name);
  safeSetLocalStorage(LAST_BACKUP_TIME_KEY, file.createdTime || new Date().toISOString());
  notifyListeners();

  return file;
}

export async function uploadD1BackupToDrive(): Promise<DriveBackupFile> {
  const cloud = await readD1ForBackup();
  const now = new Date();
  const fileName = generateBackupFileName(now);
  const { jsonString } = buildD1BackupPayload(cloud.stores, cloud.revision, now.toISOString());
  return uploadBackupToDrive(undefined, jsonString, fileName);
}
