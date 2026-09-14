/**
 * Large business collections used to be mirrored in localStorage as well as
 * IndexedDB. That duplicate copy can exceed the browser's small synchronous
 * storage quota and crash React effects. IndexedDB is now the durable local
 * store; these keys are retained only long enough for the boot migration.
 */
export const LEGACY_BUSINESS_STORAGE_KEYS = [
  'idofera_products',
  'idofera_customers',
  'idofera_suppliers',
  'idofera_sales',
  'idofera_purchases',
  'idofera_expenses',
  'idofera_notifications',
  'idofera_auditLogs',
  'idofera_stockMovements',
  'idofera_pricingHistory',
  'idofera_heldOrders',
  'idofera_deliveryOrders',
  'idofera_whatsAppPreOrders',
  'idofera_moneyMovements',
] as const;

export function removeLegacyBusinessStorage(): void {
  if (typeof localStorage === 'undefined') return;
  LEGACY_BUSINESS_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function safeSetLocalStorage(key: string, value: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'QuotaExceededError') {
      // State initializers have already read any legacy values before effects
      // run, so reclaiming the duplicate collection space is migration-safe.
      removeLegacyBusinessStorage();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        console.warn(`Unable to persist local preference "${key}" after storage cleanup.`, retryError);
        return false;
      }
    }
    console.warn(`Unable to persist local preference "${key}".`, error);
    return false;
  }
}
