/**
 * Phase 4.5 gate — extract base64 product photos from the legacy D1 export.
 *
 * Base64 images cannot live in the relational tables (D1 `SQLITE_TOOBIG`, and they
 * bloat every snapshot push), so productToRow writes URL images only. This job pulls
 * the originals out of the legacy documents into backups/images/ + manifest.json so
 * Phase 5 can upload them to R2 and rewrite products.images_json — no photo is lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SOURCE_FILE, parseDump } from './lib.js';

type ManifestEntry = { productId: string; index: number; file: string; mime: string; bytes: number };

function main() {
  const src = fs.readFileSync(SOURCE_FILE, 'utf8');
  const { docs } = parseDump(src);
  const outDir = path.join(process.cwd(), 'backups', 'images');
  fs.mkdirSync(outDir, { recursive: true });

  const manifest: ManifestEntry[] = [];
  let products = 0;
  const seen = new Set<string>();

  for (const doc of docs) {
    if (doc.collection !== 'products') continue;
    let payload: any;
    try {
      payload = JSON.parse(doc.payload);
    } catch {
      continue;
    }
    const id = String(payload?.id || '');
    if (!id || seen.has(id)) continue;
    const images = Array.isArray(payload.images) ? (payload.images as unknown[]) : [];
    const base64 = images.filter((u) => typeof u === 'string' && String(u).startsWith('data:'));
    if (!base64.length) continue;
    seen.add(id);
    products += 1;
    base64.forEach((url, index) => {
      const value = String(url);
      const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/s);
      if (!match) return;
      const mime = match[1] || 'image/png';
      const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
      const file = `${id}-${index}.${ext}`;
      const buffer = Buffer.from(match[2], 'base64');
      fs.writeFileSync(path.join(outDir, file), buffer);
      manifest.push({ productId: id, index, file, mime, bytes: buffer.length });
    });
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ source: SOURCE_FILE, extractedAt: new Date().toISOString(), products, images: manifest }, null, 2));
  const total = manifest.reduce((a, m) => a + m.bytes, 0);
  console.log(`extracted ${manifest.length} images from ${products} products (${(total / 1048576).toFixed(2)} MB) -> ${outDir}`);
  console.log(`manifest: ${manifestPath}`);
}

main();