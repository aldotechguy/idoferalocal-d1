import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargo = spawnSync(cargoCommand, ['build', '--manifest-path', 'native/Cargo.toml', '--release', '-p', 'binding_napi'], {
  cwd: root,
  stdio: 'inherit',
});
if (cargo.status !== 0) process.exit(cargo.status ?? 1);

const extension = process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so';
const libraryName = process.platform === 'win32' ? 'binding_napi' : 'libbinding_napi';
const target = process.env.CARGO_BUILD_TARGET;
const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, 'native', 'target');
const source = path.join(targetDir, ...(target ? [target] : []), 'release', `${libraryName}.${extension}`);
const destination = path.join(root, 'src', 'native-bridge', 'native.node');
mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log(`Native addon copied to ${path.relative(root, destination)}`);
