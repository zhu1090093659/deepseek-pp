import type { BundledSkillGroup } from './bundled-loader';

const BUNDLED_SKILL_ASSET_ROOT = 'bundled-skills';
const BUNDLED_SKILL_MANIFEST_PATH = `${BUNDLED_SKILL_ASSET_ROOT}/manifest.json`;

interface BundledSkillAssetManifest {
  schemaVersion: 1;
  groups: Record<BundledSkillGroup, readonly string[]>;
}

export interface BundledSkillAssetStore {
  read(group: BundledSkillGroup, relativePath: string): Promise<string>;
  list(group: BundledSkillGroup, prefix?: string): Promise<readonly string[]>;
}

export interface BundledSkillAssetStoreDependencies {
  getUrl(path: string): string;
  fetch(input: string): Promise<Pick<Response, 'ok' | 'status' | 'text'>>;
}

export function createBundledSkillAssetStore(
  dependencies: BundledSkillAssetStoreDependencies,
): BundledSkillAssetStore {
  const textPromises = new Map<string, Promise<string>>();
  let manifestPromise: Promise<BundledSkillAssetManifest> | null = null;

  const readText = (path: string): Promise<string> => {
    const existing = textPromises.get(path);
    if (existing) return existing;
    const promise = dependencies.fetch(dependencies.getUrl(path)).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Bundled Skill asset request failed (${response.status}): ${path}`);
      }
      return response.text();
    });
    textPromises.set(path, promise);
    void promise.catch(() => {
      if (textPromises.get(path) === promise) textPromises.delete(path);
    });
    return promise;
  };

  const getManifest = (): Promise<BundledSkillAssetManifest> => {
    if (manifestPromise) return manifestPromise;
    const promise = readText(BUNDLED_SKILL_MANIFEST_PATH)
      .then((raw) => decodeBundledSkillAssetManifest(JSON.parse(raw)));
    manifestPromise = promise;
    void promise.catch(() => {
      if (manifestPromise === promise) {
        manifestPromise = null;
        textPromises.delete(BUNDLED_SKILL_MANIFEST_PATH);
      }
    });
    return promise;
  };

  const store: BundledSkillAssetStore = {
    async read(group: BundledSkillGroup, relativePath: string) {
      assertSafeAssetPath(relativePath);
      const manifest = await getManifest();
      if (!manifest.groups[group].includes(relativePath)) {
        throw new Error(`Bundled Skill asset is not registered: ${group}/${relativePath}`);
      }
      return readText(`${BUNDLED_SKILL_ASSET_ROOT}/${group}/${relativePath}`);
    },
    async list(group: BundledSkillGroup, prefix = '') {
      assertSafeAssetPrefix(prefix);
      const manifest = await getManifest();
      return manifest.groups[group].filter((path) => path.startsWith(prefix));
    },
  };
  return Object.freeze(store);
}

function decodeBundledSkillAssetManifest(value: unknown): BundledSkillAssetManifest {
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !isPlainObject(value.groups)) {
    throw new Error('Bundled Skill asset manifest must use schemaVersion 1');
  }
  const officecli = decodeAssetPaths(value.groups.officecli, 'officecli');
  const specDrivenDevelop = decodeAssetPaths(
    value.groups['spec-driven-develop'],
    'spec-driven-develop',
  );
  const groupNames = Object.keys(value.groups);
  if (
    groupNames.length !== 2
    || !groupNames.includes('officecli')
    || !groupNames.includes('spec-driven-develop')
  ) {
    throw new Error('Bundled Skill asset manifest contains unsupported groups');
  }
  return Object.freeze({
    schemaVersion: 1,
    groups: Object.freeze({
      officecli: Object.freeze(officecli),
      'spec-driven-develop': Object.freeze(specDrivenDevelop),
    }),
  });
}

function decodeAssetPaths(value: unknown, group: BundledSkillGroup): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Bundled Skill asset manifest group must be an array: ${group}`);
  }
  const paths = value.map((path, index) => {
    if (typeof path !== 'string') {
      throw new Error(`Bundled Skill asset path must be a string: ${group}[${index}]`);
    }
    assertSafeAssetPath(path);
    return path;
  });
  if (new Set(paths).size !== paths.length) {
    throw new Error(`Bundled Skill asset manifest contains duplicate paths: ${group}`);
  }
  return paths;
}

function assertSafeAssetPath(path: string): void {
  if (
    path.length === 0
    || path.startsWith('/')
    || path.endsWith('/')
    || path.includes('\\')
    || !/^[A-Za-z0-9._/-]+$/.test(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid bundled Skill asset path: ${path}`);
  }
}

function assertSafeAssetPrefix(prefix: string): void {
  if (prefix === '') return;
  if (!prefix.endsWith('/')) throw new Error(`Invalid bundled Skill asset prefix: ${prefix}`);
  assertSafeAssetPath(prefix.slice(0, -1));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export const bundledSkillAssets = createBundledSkillAssetStore({
  getUrl: (path) => chrome.runtime.getURL(path),
  fetch: (input) => fetch(input),
});
