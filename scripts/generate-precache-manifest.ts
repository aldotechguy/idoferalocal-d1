/**
 * Post-build: writes dist/precache-manifest.json listing the files the service
 * worker must precache for an offline cold start.
 *
 * The app shell is the HTML plus the entry chunk, everything the entry imports
 * STATICALLY, and the stylesheets. Lazy route chunks are deliberately excluded:
 * they are fetched on demand and cached opportunistically by the worker's
 * stale-while-revalidate rule, so precaching them would bloat every install
 * for content a shopper may never open.
 *
 * The static-import walk matters. `dist/index.html` contains NO stylesheet link
 * -- the CSS is pulled in by the bootstrap chunk at runtime -- and the entry
 * chunk carries a Vite mapDeps array listing every LAZY chunk. Scraping for any
 * chunk name would precache the entire application, so only real static
 * specifiers (`from"./x.js"` / `import"./x.js"`, always `./`-prefixed) are
 * followed; mapDeps entries are bare `assets/...` and never match.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const DIST = 'dist';
const HTML = path.join(DIST, 'index.html');
const ASSETS = path.join(DIST, 'assets');
const OUT = path.join(DIST, 'precache-manifest.json');

if (!existsSync(HTML)) {
  console.warn('[precache] dist/index.html not found; skipping manifest.');
  process.exit(0);
}

const html = readFileSync(HTML, 'utf8');
const assets = new Set<string>();

// Entry scripts referenced by the document itself.
for (const match of html.matchAll(/<script[^>]+src="(\/assets\/[^"]+)"/g)) assets.add(match[1]);

/** Every statically imported asset reachable from the entries. */
function walk(entry: string) {
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const file = path.join(DIST, current.replace(/^\//, ''));
    if (!existsSync(file) || !current.endsWith('.js')) continue;
    const source = readFileSync(file, 'utf8');
    for (const pattern of [/\bfrom\s*"\.\/([^"]+)"/g, /\bimport\s*"\.\/([^"]+)"/g]) {
      for (const match of source.matchAll(pattern)) {
        const resolved = `/assets/${match[1]}`;
        if (!assets.has(resolved)) queue.push(resolved);
      }
    }
  }
}

for (const entry of [...assets]) walk(entry);

/**
 * The boot chain is loaded with DYNAMIC imports and so cannot be discovered by
 * walking static specifiers:
 *   index.html inline script -> import('/src/bootstrap.ts') -> import('./main.tsx')
 * Without bootstrap and main the cached shell is a blank page, because the React
 * root is never mounted. Vite names chunks after their source file, so these are
 * found by name; the assertion below fails the build loudly if they are not.
 */
const REQUIRED_BOOT = ['bootstrap', 'main'];
for (const name of REQUIRED_BOOT) {
  if (!existsSync(ASSETS)) break;
  const match = readdirSync(ASSETS).find((file) => file.startsWith(`${name}-`) && file.endsWith('.js'));
  if (match) assets.add(`/assets/${match}`);
}

// Stylesheets: the HTML may not link them at all, but an unstyled offline boot
// is not a usable one, and the set is small.
if (existsSync(ASSETS)) {
  for (const name of readdirSync(ASSETS)) {
    if (name.endsWith('.css')) assets.add(`/assets/${name}`);
  }
}

const list = [...assets].sort();
writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), assets: list }, null, 2));
console.log(`[precache] ${list.length} shell asset(s) -> ${OUT}`);
for (const asset of list) console.log(`  ${asset}`);

const missingBoot = REQUIRED_BOOT.filter((name) => !list.some((a) => new RegExp(`/${name}-[^/]+\\.js$`).test(a)));
const hasCss = list.some((a) => a.endsWith('.css'));
if (missingBoot.length || !hasCss) {
  // Either would make the offline shell silently useless: a blank page, or an
  // unstyled one. Fail the build rather than ship an offline mode that cannot
  // render.
  console.error(`[precache] Shell incomplete (missing boot: ${missingBoot.join(', ') || 'none'}; css: ${hasCss}).`);
  process.exitCode = 1;
}
