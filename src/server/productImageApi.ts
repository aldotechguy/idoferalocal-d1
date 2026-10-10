/**
 * #14 — Staff product-image upload/delete endpoints and the public image route.
 *
 * Uploads accept base64 JSON (the same shape the product editor already used) but
 * the bytes are written to durable object storage and only a stable URL is kept in
 * `products.images_json` — no more base64 blobs inside the database.
 */
import type { MallExecutor } from './mallApi.js';
import type { StaffActor } from './mallOrderAdminApi.js';
import { s } from './relationalMapper.js';
import {
  IMAGE_CACHE_CONTROL, decodeBase64Image, imageKeyFromUrl, imageResponse,
  imageUrl, newProductImageKey, type ImageStore,
} from './imageStore.js';

type DomainError = Error & { status?: number; payload?: unknown };
const fail = (status: number, message: string, payload?: unknown): never => {
  const error = new Error(message) as DomainError;
  error.status = status;
  if (payload !== undefined) error.payload = payload;
  throw error;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});

const UPLOAD_ROLES = ['Administrator', 'Store Manager'];
/** Generous enough for a 4 MB image in base64 plus JSON framing. */
const MAX_UPLOAD_BODY = 8 * 1024 * 1024;

export async function handleStaffProductImageApi(
  request: Request,
  store: ImageStore | undefined,
  exec: MallExecutor,
  actor: StaffActor,
): Promise<Response> {
  try {
    if (!actor?.id) return json({ error: 'Authentication required.' }, 401);
    if (!UPLOAD_ROLES.includes(actor.role)) fail(403, 'Only an Administrator or Store Manager can manage product images.');
    if (!store) fail(503, 'Image storage is not configured on this deployment.');

    if (request.method === 'DELETE') {
      const url = new URL(request.url, 'http://localhost');
      const key = imageKeyFromUrl(url.searchParams.get('url'));
      if (!key) fail(400, 'Only images uploaded to this store can be deleted.');
      await store.remove(key);
      // Storage keys are `products/<month>/<uuid>.<ext>`, so the old
      // `key.split('/')[1]` recorded the month folder as the audit entity id.
      // Look up which product still references the URL instead (delete is rare,
      // so one bounded scan is fine).
      const referers = await exec.queryAll('SELECT id FROM products WHERE images_json LIKE ? LIMIT 1', [`%${key}%`]);
      await exec.runBatch([{
        sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'DELETE_PRODUCT_IMAGE', 'Product', ?, ?, ?)`,
        params: [crypto.randomUUID(), actor.id, s(referers[0]?.id) || null,
          `${actor.displayName} deleted stored image ${key}.`, new Date().toISOString()],
      }]);
      return json({ ok: true, deleted: imageUrl(key), productId: s(referers[0]?.id) || undefined });
    }

    if (request.method !== 'POST') fail(405, 'Only POST or DELETE is supported.');

    const text = await request.text();
    if (text.length > MAX_UPLOAD_BODY) fail(413, 'Image upload is too large.');
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { fail(400, 'Invalid JSON request body.'); }

    let decoded;
    try { decoded = decodeBase64Image(body?.contentType, body?.dataBase64); }
    catch (error) {
      return json({
        error: 'Image validation failed',
        fields: { image: error instanceof Error ? error.message : 'Invalid image.' },
      }, 400);
    }

    const key = newProductImageKey(decoded.contentType);
    await store.put(key, { bytes: decoded.bytes, contentType: decoded.contentType });
    await exec.runBatch([{
      sql: `INSERT INTO audit_logs (id, actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, 'UPLOAD_PRODUCT_IMAGE', 'Product', NULL, ?, ?)`,
      params: [crypto.randomUUID(), actor.id,
        `${actor.displayName} uploaded ${decoded.contentType} (${decoded.bytes.byteLength} bytes) as ${key}.`,
        new Date().toISOString()],
    }]);

    return json({ url: imageUrl(key), contentType: decoded.contentType, bytes: decoded.bytes.byteLength }, 201);
  } catch (error) {
    const known = error as DomainError;
    return json({
      error: known.status ? known.message : 'Image operation failed.',
      ...(known.payload && typeof known.payload === 'object' ? known.payload : {}),
    }, known.status || 500);
  }
}

/** Public, unauthenticated delivery of stored images with immutable caching. */
export async function handlePublicImageRequest(
  request: Request,
  store: ImageStore | undefined,
  key: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  if (!store) return new Response('Image storage is not configured.', { status: 503 });
  const image = await store.get(key);
  if (!image) return new Response('Not found', { status: 404 });
  const response = imageResponse(image, IMAGE_CACHE_CONTROL);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers: response.headers });
  return response;
}
