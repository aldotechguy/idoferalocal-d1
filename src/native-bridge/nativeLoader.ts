type NativeRequire = (id: string) => unknown;
type NativeModuleInfo = typeof import('node:module');
type NativePath = typeof import('node:path');
let nativeRequire: NativeRequire | null = null;
let projectRoot = '';
let pathApi: NativePath | null = null;

function getNativeRequire(): NativeRequire | null {
  if (nativeRequire) return nativeRequire;
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  // Cloudflare Workers expose a `process` shim but not Node's CJS loader or
  // process.getBuiltinModule, so native addons are unavailable there by design.
  if (typeof process.getBuiltinModule !== 'function') return null;
  try {
    const moduleApi = process.getBuiltinModule('node:module') as NativeModuleInfo;
    pathApi = process.getBuiltinModule('node:path') as NativePath;
    if (!moduleApi.createRequire || !pathApi) return null;
    // createRequire needs a real file or file: URL; process.argv[1] can be a bare
    // flag under Node's test runner ("Invalid path"). With no __filename in an
    // ESM worker, anchor at the project root so addon candidates resolve.
    const filename = (Function('return typeof __filename === "string" ? __filename : null') as () => string | null)();
    const anchor = filename && pathApi.isAbsolute(filename)
      ? filename
      : pathApi.join(process.cwd(), 'index.js');
    nativeRequire = moduleApi.createRequire(anchor) as NativeRequire;
    // tsx executes this module from its own cache directory under Node test
    // workers, so a path relative to the transformed file never points at the
    // repository. Use cwd when it is the repo root; otherwise prefer the
    // project root embedded in the anchor (the bundled dist/server.cjs).
    projectRoot = hasAddonAt(process.cwd()) ? process.cwd() : pathApi.join(pathApi.dirname(anchor), '..');
    return nativeRequire;
  } catch {
    return null;
  }
}

function hasAddonAt(root: string): boolean {
  if (!pathApi) return false;
  const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
  return fs.existsSync(pathApi.join(root, 'src/native-bridge/native.node'))
    || fs.existsSync(pathApi.join(root, 'src/native/binding_napi.node'));
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
  if (typeof process === 'undefined' || !process.versions?.node) return null;
  const loader = getNativeRequire();
  if (!loader || !projectRoot || !pathApi) return null;
  return loadFromCandidates(loader);
}

export function loadNativeModuleFrom(requireAddon: NativeRequire, root: string, paths: NativePath, overridePath?: string): Record<string, (...args: any[]) => any> | null {
  const candidates = [
    ...(overridePath ? [paths.resolve(overridePath)] : []),
    paths.join(root, 'src/native-bridge/native.node'),
    paths.join(root, 'src/native/binding_napi.node'),
    ...['release', 'debug'].flatMap((profile) =>
      libraryNames('binding_napi').flatMap((file) => [
        paths.join(root, `native/target/${profile}/${file}`),
        paths.join(root, `native/crates/binding_napi/${profile}/${file}`),
      ]),
    ),
  ];

  for (const candidate of candidates) {
    try {
      return requireAddon(candidate) as Record<string, (...args: any[]) => any>;
    } catch {
      // Missing files and incompatible native binaries are both treated as unavailable.
    }
  }
  return null;
}

function loadFromCandidates(loader: NativeRequire): Record<string, (...args: any[]) => any> | null {
  if (!pathApi) return null;
  return loadNativeModuleFrom(loader, projectRoot, pathApi, process.env.IDOFERA_NATIVE_ADDON);
}
