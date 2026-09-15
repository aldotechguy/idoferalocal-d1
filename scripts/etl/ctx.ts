/** Shared ETL context + payload parser. */
import type { DocRow } from './lib.js';
export type Ctx = {
  errors: { collection: string; docId: string; error: string }[];
  categoryByName: Map<string, string>;
  productIds: Set<string>;
  placeholderProducts: number;
  strippedImages: number;
  salesTotalKobo: number;
  salesCount: number;
  saleItemsCount: number;
};
export function newCtx(): Ctx {
  return { errors: [], categoryByName: new Map(), productIds: new Set(), placeholderProducts: 0, strippedImages: 0, salesTotalKobo: 0, salesCount: 0, saleItemsCount: 0 };
}
export function parsePayload(ctx: Ctx, d: DocRow): any {
  try { return JSON.parse(d.payload); }
  catch (e: any) { ctx.errors.push({ collection: d.collection, docId: d.docId, error: String(e?.message || e) }); return null; }
}
