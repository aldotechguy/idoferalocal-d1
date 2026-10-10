/**
 * #14 — Node-runtime image store (local disk).
 *
 * Node has no R2 binding, so development and self-hosted runs persist images under
 * a local directory. The content type is derived from the key's extension, which is
 * always chosen by `newProductImageKey`, so no sidecar metadata is required.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSafeImageKey, type ImageStore, type StoredImage } from './imageStore.js';

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif',
};

export function makeNodeImageStore(rootDir: string): ImageStore {
  const root = path.resolve(rootDir);
  const resolveKey = (key: string) => {
    if (!isSafeImageKey(key)) throw new Error('Unsafe image key.');
    const full = path.resolve(root, key);
    // Defence in depth: the resolved path must stay inside the storage root.
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error('Unsafe image key.');
    return full;
  };
  return {
    async put(key, image) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, image.bytes);
    },
    async get(key): Promise<StoredImage | null> {
      try {
        const full = resolveKey(key);
        const bytes = new Uint8Array(await readFile(full));
        const extension = path.extname(full).slice(1).toLowerCase();
        const contentType = EXTENSION_TYPES[extension];
        return contentType ? { bytes, contentType } : null;
      } catch { return null; }
    },
    async remove(key) {
      try { await rm(resolveKey(key), { force: true }); } catch { /* already gone */ }
    },
  };
}
