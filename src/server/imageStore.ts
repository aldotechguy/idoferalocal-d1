/**
 * #14 — Durable product-image storage (shared, runtime-agnostic).
 *
 * Deliberately free of any Node built-in imports: this module is bundled into the
 * Cloudflare Worker as well as used by the Node server. The actual byte storage is
 * provided per runtime (R2 binding on the edge, local disk in Node).
 */

export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;
/** Base64 inflates by ~4/3, plus JSON overhead. */
const MAX_BASE64_CHARS = Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 1024;

export const IMAGE_TYPES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type StoredImage = { bytes: Uint8Array; contentType: string };

export type ImageStore = {
  put(key: string, image: StoredImage): Promise<void>;
  get(key: string): Promise<StoredImage | null>;
  remove(key: string): Promise<void>;
};

export const IMAGE_URL_PREFIX = '/mall-images/';
const PRODUCT_IMAGE_PREFIX = 'products/';

/** Stable, cache-forever public URL. Relative so it works on every origin. */
export function imageUrl(key: string) {
  return `${IMAGE_URL_PREFIX}${key}`;
}

export function isSafeImageKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 200
    && !key.startsWith('/') && !key.includes('..') && /^[A-Za-z0-9._/-]+$/.test(key);
}

/** Extracts the storage key from one of our own URLs, ignoring anything foreign. */
export function imageKeyFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.startsWith(IMAGE_URL_PREFIX)) return null;
  const key = url.slice(IMAGE_URL_PREFIX.length);
  return isSafeImageKey(key) ? key : null;
}

export function newProductImageKey(contentType: string) {
  const month = new Date().toISOString().slice(0, 7);
  return `${PRODUCT_IMAGE_PREFIX}${month}/${crypto.randomUUID()}.${IMAGE_TYPES[contentType]}`;
}

/** Magic-byte signature so a declared MIME type cannot simply be lied about. */
function matchesSignature(bytes: Uint8Array, contentType: string) {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (offset: number, text: string) =>
    [...text].every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  switch (contentType) {
    case 'image/jpeg': return starts(0xff, 0xd8, 0xff);
    case 'image/png': return starts(0x89, 0x50, 0x4e, 0x47);
    case 'image/webp': return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'image/avif': return bytes.length > 12 && ascii(4, 'ftyp') && ascii(8, 'avif');
    default: return false;
  }
}

export class ImageValidationError extends Error {}

/**
 * Validates and decodes an uploaded image, throwing `ImageValidationError` with a
 * field-level message when the payload is unacceptable.
 */
export function decodeBase64Image(contentType: unknown, dataBase64: unknown): StoredImage {
  if (typeof contentType !== 'string' || !IMAGE_TYPES[contentType]) {
    throw new ImageValidationError(`Unsupported image type. Allowed: ${Object.keys(IMAGE_TYPES).join(', ')}.`);
  }
  if (typeof dataBase64 !== 'string' || !dataBase64) throw new ImageValidationError('Image data is required.');
  if (dataBase64.length > MAX_BASE64_CHARS) throw new ImageValidationError('Image exceeds the 4 MB limit.');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) throw new ImageValidationError('Image data is not valid base64.');

  let bytes: Uint8Array;
  try {
    const binary = atob(dataBase64);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new ImageValidationError('Image data could not be decoded.');
  }
  if (!bytes.length) throw new ImageValidationError('Image data is empty.');
  if (bytes.length > IMAGE_MAX_BYTES) throw new ImageValidationError('Image exceeds the 4 MB limit.');
  if (!matchesSignature(bytes, contentType)) {
    throw new ImageValidationError('Image contents do not match the declared file type.');
  }
  return { bytes, contentType };
}

export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function imageResponse(image: StoredImage, cacheControl = IMAGE_CACHE_CONTROL) {
  return new Response(image.bytes, {
    status: 200,
    headers: {
      'content-type': image.contentType,
      'cache-control': cacheControl,
      'content-length': String(image.bytes.byteLength),
      'x-content-type-options': 'nosniff',
    },
  });
}