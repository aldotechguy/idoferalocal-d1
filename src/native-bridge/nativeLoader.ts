import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');

function libraryNames(base: string): string[] {
  const extension = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so';
  const names = [`${base}.node`, `lib${base}${extension}`, `${base}${extension}`];
  if (process.platform === 'win32') names.push(`${base}.dll`);
  return names;
}

/** Shared, cross-platform loader for the napi-rs addon. */
export function loadNativeModule(): Record<string, (...args: any[]) => any> | null {
  const candidates = [
    ...(process.env.IDOFERA_NATIVE_ADDON ? [path.resolve(process.env.IDOFERA_NATIVE_ADDON)] : []),
    path.join(here, 'native.node'),
    path.join(projectRoot, 'src/native-bridge/native.node'),
    path.join(projectRoot, 'src/native/binding_napi.node'),
    ...['release', 'debug'].flatMap((profile) =>
      libraryNames('binding_napi').flatMap((file) => [
        path.join(projectRoot, `native/target/${profile}/${file}`),
        path.join(projectRoot, `native/crates/binding_napi/${profile}/${file}`),
      ]),
    ),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate) as Record<string, (...args: any[]) => any>;
    } catch {
      // Missing files and incompatible native binaries are both treated as unavailable.
    }
  }
  return null;
}
