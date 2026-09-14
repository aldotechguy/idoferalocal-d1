import {copyFile, cp, mkdir, readdir} from 'node:fs/promises';

await mkdir('dist/server', {recursive: true});
await copyFile('.sites-worker-build/sites-worker.js', 'dist/server/index.js');

// Sites mounts static assets from dist/client for Worker-backed deployments.
// Keep the Vite root output too for local preview compatibility.
await mkdir('dist/client', {recursive: true});
for (const entry of await readdir('dist', {withFileTypes: true})) {
  if (entry.name === 'client' || entry.name === 'server' || entry.name === '.openai') continue;
  await cp(`dist/${entry.name}`, `dist/client/${entry.name}`, {recursive: true, force: true});
}
