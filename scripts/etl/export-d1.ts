/**
 * Phase 0 — export a D1 database to a local SQL file via the Cloudflare REST API.
 *
 * Uses the D1 `/export` endpoint (async job), polls until the download URL is
 * ready, then streams the result to backups/. Read-only against the source; this
 * is the rollback + canon-input artifact.
 *
 * Usage:
 *   npx tsx scripts/etl/export-d1.ts --db=<database_id> --out=backups/<name>.sql
 * Defaults to the live `idofera` id and a timestamped filename.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ACCOUNT_ID, API_TOKEN } from './lib.js';

function arg(name: string, fallback: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

const DATABASE_ID = arg('db', '3a3eb157-5aa5-419a-a8ce-2eade2afc436'); // live `idofera`
const OUT = path.resolve(arg('out', path.join('backups', `d1-export-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)));
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}`;

async function cf(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = (await res.json()) as any;
  if (!res.ok || !data.success) throw new Error(`Cloudflare API error: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

async function main() {
  if (!API_TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required (set it in .env).');
  console.log(`exporting D1 ${DATABASE_ID} -> ${OUT}`);
  const start = await cf(`${API}/export`, { method: 'POST', body: JSON.stringify({ output_format: 'polling' }) });
  const { at_bookmark, error: startErr, result, messages, success } = start;
  if (!success) throw new Error(`export start failed: ${JSON.stringify(messages)}`);
  let bookmark: string | undefined = at_bookmark;
  // The endpoint returns a signed result URL once the export job completes.
  if (typeof result?.url === 'string') bookmark = undefined;
  let downloadUrl: string | undefined = typeof result === 'string' ? result : result?.url;

  for (let attempt = 0; !downloadUrl && attempt < 60; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await cf(`${API}/export/${bookmark}`, { method: 'GET' });
    downloadUrl = typeof poll.result === 'string' ? poll.result : poll.result?.url;
    if (poll.status === 'error') throw new Error(`export job error: ${JSON.stringify(poll)}`);
  }
  if (!downloadUrl) throw new Error('export did not produce a download URL in time.');

  const file = await fetch(downloadUrl);
  if (!file.ok) throw new Error(`download failed: ${file.status}`);
  const text = await file.text();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${text.length} bytes, ${text.split('\n').length} lines -> ${OUT}`);
}

main().catch((e) => { console.error('export-d1 fatal:', e); process.exit(1); });
