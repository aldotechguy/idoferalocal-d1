type NativeRequire = (id: string) => unknown;
let nativeRequire: NativeRequire | null = null;
let projectRoot = '';
let pathApi: typeof import('node:path') | null = null;
let cachedRequire: NativeRequire | null = null;
function getNativeRequire(): NativeRequire | null {
  if (cachedRequire) return cachedRequire;
  if (typeof process === 'undefined' || !process.versions?.node || typeof __filename === 'undefined') return null;
  const moduleApi = require('node:module') as typeof import('node:module');
  pathApi = require('node:path') as typeof import('node:path');
  cachedRequire = moduleApi.createRequire(__filename) as NativeRequire;
  projectRoot = pathApi.resolve(pathApi.dirname(__filename), '../..');
  return cachedRequire;
}

function libraryNames(base: string): string[] {
  const extension = process.platform === 'win32' ? '.dll' : process.platform === 'darwin' ? '.dylib' : '.so';
  const names = [`${base}.node`, `lib${base}${extension}`, `${base}${extension}`];
  if (process.platform === 'win32') names.push(`${base}.dll`);
  return names;
}

/** Shared, cross-platform loader for the napi-rs addon. */
export function loadNativeModule(): Record<string, (...args: any[]) => any> | null {
  // Cloudflare Workers/browser bundles are not Node addon runtimes.
  nativeRequire = getNativeRequire();
  if (!nativeRequire || !projectRoot || !pathApi) return null;
  const candidates = [
    ...(process.env.IDOFERA_NATIVE_ADDON ? [pathApi!.resolve(process.env.IDOFERA_NATIVE_ADDON)] : []),
    pathApi!.join(projectRoot, 'src/native-bridge/native.node'),
    pathApi!.join(projectRoot, 'src/native/binding_napi.node'),
    ...['release', 'debug'].flatMap((profile) =>
      libraryNames('binding_napi').flatMap((file) => [
        pathApi!.join(projectRoot, `native/target/${profile}/${file}`),
        pathApi!.join(projectRoot, `native/crates/binding_napi/${profile}/${file}`),
      ]),
    ),
  ];

  for (const candidate of candidates) {
    try {
      return nativeRequire(candidate) as Record<string, (...args: any[]) => any>;
    } catch {
      // Missing files and incompatible native binaries are both treated as unavailable.
    }
  }
  return null;
}
