import { loadNativeModule } from './nativeLoader.js';
import type { SqlStmt } from '../server/relationalWritesCore';
import { coreUpsert as coreUpsertTS, coreDelete as coreDeleteTS } from '../server/relationalWritesCore';
import { isNativeBridgeEnabled, reportNativeBridgeEvent } from './telemetry.js';

const nativeModule = loadNativeModule();

export const isNativeRelationalAvailable = (): boolean =>
  nativeModule !== null && typeof nativeModule.nativePlanCoreUpsert === 'function'
    && typeof nativeModule.nativePlanCoreDelete === 'function';

export async function planCoreUpsert(
  collection: string,
  document: any,
  now: string = new Date().toISOString(),
): Promise<SqlStmt[] | null> {
  if (isNativeRelationalAvailable() && isNativeBridgeEnabled() && document && typeof document === 'object' && document.id) {
    try {
      const raw = nativeModule.nativePlanCoreUpsert(
        collection,
        JSON.stringify(document),
        now
      );
      if (raw !== null && raw !== undefined) {
        const statements = raw.map((s: { sql: string; paramsJson?: string; params_json?: string }) => ({
          sql: s.sql,
          params: JSON.parse(s.paramsJson || s.params_json || '[]'),
        }));
        reportNativeBridgeEvent({ bridge: 'relational-upsert', outcome: 'native' });
        return statements;
      }
      reportNativeBridgeEvent({ bridge: 'relational-upsert', outcome: 'fallback', reason: 'native planner does not support collection' });
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'relational-upsert', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  } else {
    reportNativeBridgeEvent({ bridge: 'relational-upsert', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable or invalid document' : 'native rollout disabled' });
  }
  return coreUpsertTS(collection, document);
}

export async function planCoreDelete(
  collection: string,
  documentId: string
): Promise<SqlStmt[] | null> {
  if (isNativeRelationalAvailable() && isNativeBridgeEnabled()) {
    try {
      const raw = nativeModule.nativePlanCoreDelete(collection, documentId);
      if (raw === null || raw === undefined) {
        reportNativeBridgeEvent({ bridge: 'relational-delete', outcome: 'fallback', reason: 'native planner does not support collection' });
        return null;
      }
      const statements = raw.map((s: { sql: string; paramsJson?: string; params_json?: string }) => ({
        sql: s.sql,
        params: JSON.parse(s.paramsJson || s.params_json || '[]'),
      }));
      reportNativeBridgeEvent({ bridge: 'relational-delete', outcome: 'native' });
      return statements;
    } catch (error) {
      reportNativeBridgeEvent({ bridge: 'relational-delete', outcome: 'fallback', reason: error instanceof Error ? error.message : 'native call failed' });
    }
  } else {
    reportNativeBridgeEvent({ bridge: 'relational-delete', outcome: 'fallback', reason: isNativeBridgeEnabled() ? 'native addon unavailable' : 'native rollout disabled' });
  }

  return coreDeleteTS(collection, documentId);
}
