/**
 * #14 — client-side image preparation and durable upload.
 *
 * Photos are downscaled and re-encoded in the browser before upload, which keeps
 * payloads small and produces an optimised storefront asset. The server still
 * re-validates type, signature and size — this is convenience, not trust.
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

export type PreparedImage = { contentType: string; dataBase64: string };

async function encode(bitmap: ImageBitmap, type: string): Promise<string | null> {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const encoded = canvas.toDataURL(type, QUALITY);
  return encoded.startsWith(`data:${type}`) ? encoded : null;
}

export async function prepareProductImage(file: File): Promise<PreparedImage> {
  const fallback = async (): Promise<PreparedImage> => ({
    contentType: file.type,
    dataBase64: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Error reading file. Please try another image.'));
      reader.readAsDataURL(file);
    }),
  });

  if (typeof createImageBitmap !== 'function') return fallback();
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return fallback(); }
  try {
    // Prefer WebP (keeps transparency, best size); fall back to the source family.
    const webp = await encode(bitmap, 'image/webp');
    if (webp) return { contentType: 'image/webp', dataBase64: webp.split(',')[1] };
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const encoded = await encode(bitmap, type);
    if (encoded) return { contentType: type, dataBase64: encoded.split(',')[1] };
    return fallback();
  } finally { bitmap.close(); }
}

async function request(path: string, options: RequestInit) {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const field = data?.fields?.image;
    throw new Error(field || data?.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function uploadProductImage(file: File): Promise<string> {
  const prepared = await prepareProductImage(file);
  const result = await request('/api/staff/product-images', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(prepared),
  });
  return String(result.url);
}

/** Best-effort removal of a stored image; ignore failures for foreign/external URLs. */
export async function deleteProductImage(url: string): Promise<void> {
  if (!url.startsWith('/mall-images/')) return;
  try {
    await request(`/api/staff/product-images?url=${encodeURIComponent(url)}`, { method: 'DELETE' });
  } catch { /* the object may already be gone */ }
}
