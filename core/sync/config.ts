import type { SyncCommandTarget, SyncConfig } from '../types';

export const SYNC_CONFIG_STORAGE_KEY = 'deepseek_pp_sync_config';
export const SYNC_CONFIG_SCHEMA_VERSION = 1 as const;

const SYNC_CONFIG_METADATA_KEYS = new Set(['schemaVersion', 'revision']);
const SYNC_CONFIG_PROVIDER_KEYS = new Set([
  'provider',
  'url',
  'username',
  'password',
  'remotePath',
  'clientId',
  'clientSecret',
  'refreshToken',
]);

export type VersionedSyncConfig = SyncConfig & {
  schemaVersion: typeof SYNC_CONFIG_SCHEMA_VERSION;
  revision: number;
};

export type VersionedOAuthSyncConfig = Extract<
  VersionedSyncConfig,
  { provider: 'gdrive' | 'onedrive' }
>;

export interface SyncConfigRecord {
  config: VersionedSyncConfig;
  revision: number;
}

export interface SyncConfigStorageValue {
  present: boolean;
  value?: unknown;
}

export interface SyncConfigStoragePort {
  read(): Promise<SyncConfigStorageValue>;
  write(value: VersionedSyncConfig): Promise<void>;
}

export interface SyncConfigStore {
  read(): Promise<SyncConfigRecord | null>;
  assertExpectedRevision(expectedRevision: number | null): Promise<SyncConfigRecord | null>;
  replace(target: SyncCommandTarget): Promise<SyncConfigRecord>;
  updateLastSyncAt(expectedRevision: number, lastSyncAt: number): Promise<SyncConfigRecord>;
}

export class SyncConfigConflictError extends Error {
  readonly code = 'sync_config_conflict' as const;

  constructor(
    readonly expectedRevision: number | null,
    readonly currentRevision: number | null,
    message = 'Sync configuration changed in another extension context. Review it and try again.',
  ) {
    super(message);
    this.name = 'SyncConfigConflictError';
  }
}

export class SyncConfigCommitIndeterminateError extends AggregateError {
  readonly code = 'sync_config_commit_indeterminate' as const;

  constructor(
    errors: Iterable<unknown>,
    message = 'Sync configuration commit outcome is unknown',
  ) {
    super(errors, message);
    this.name = 'SyncConfigCommitIndeterminateError';
  }
}

export function createBrowserSyncConfigStoragePort(): SyncConfigStoragePort {
  return {
    async read() {
      const data = await chrome.storage.local.get(SYNC_CONFIG_STORAGE_KEY) as Record<string, unknown>;
      return {
        present: Object.prototype.hasOwnProperty.call(data, SYNC_CONFIG_STORAGE_KEY),
        value: data[SYNC_CONFIG_STORAGE_KEY],
      };
    },
    async write(value) {
      await chrome.storage.local.set({ [SYNC_CONFIG_STORAGE_KEY]: value });
    },
  };
}

export function createSyncConfigStore(
  storage: SyncConfigStoragePort,
  options: {
    conflictMessage?: (expectedRevision: number | null, currentRevision: number | null) => string;
    commitIndeterminateMessage?: () => string;
  } = {},
): SyncConfigStore {
  const read = async (): Promise<SyncConfigRecord | null> => {
    const stored = await storage.read();
    if (!stored.present) return null;
    return decodeStoredSyncConfig(stored.value);
  };

  const assertExpectedRevision = async (
    expectedRevision: number | null,
  ): Promise<SyncConfigRecord | null> => {
    assertRevision(expectedRevision, 'Sync command expectedRevision', true);
    const current = await read();
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== expectedRevision) {
      throw new SyncConfigConflictError(
        expectedRevision,
        currentRevision,
        options.conflictMessage?.(expectedRevision, currentRevision),
      );
    }
    return current;
  };

  const commit = async (record: SyncConfigRecord): Promise<void> => {
    try {
      await storage.write(record.config);
      return;
    } catch (writeError) {
      let observed: SyncConfigStorageValue;
      try {
        observed = await storage.read();
      } catch (verificationError) {
        throw new SyncConfigCommitIndeterminateError(
          [writeError, verificationError],
          options.commitIndeterminateMessage?.(),
        );
      }
      if (!observed.present) throw writeError;

      let observedRecord: SyncConfigRecord;
      try {
        observedRecord = decodeStoredSyncConfig(observed.value);
      } catch (verificationError) {
        throw new SyncConfigCommitIndeterminateError(
          [writeError, verificationError],
          options.commitIndeterminateMessage?.(),
        );
      }
      if (sameJsonValue(observedRecord.config, record.config)) return;
      throw writeError;
    }
  };

  return Object.freeze({
    read,
    assertExpectedRevision,
    async replace(target: SyncCommandTarget) {
      const decoded = decodeSyncCommandTarget(target);
      const current = await assertExpectedRevision(decoded.expectedRevision);
      const revision = (current?.revision ?? 0) + 1;
      const record = createRecord(decoded.config, revision);
      await commit(record);
      return record;
    },
    async updateLastSyncAt(expectedRevision: number, lastSyncAt: number) {
      assertRevision(expectedRevision, 'Sync lastSyncAt expectedRevision', false);
      assertTimestamp(lastSyncAt, 'Sync lastSyncAt');
      const current = await assertExpectedRevision(expectedRevision);
      if (!current) {
        throw new SyncConfigConflictError(expectedRevision, null);
      }
      const record = createRecord({ ...current.config, lastSyncAt }, expectedRevision + 1);
      await commit(record);
      return record;
    },
  });
}

/**
 * Read a persisted value without writing it. Released provider-less WebDAV and
 * unversioned provider records project to schema v1 revision 0 in memory.
 */
export function decodeStoredSyncConfig(value: unknown): SyncConfigRecord {
  const object = clonePlainJsonRecord(value, 'Sync configuration');
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(object, 'schemaVersion');
  const hasRevision = Object.prototype.hasOwnProperty.call(object, 'revision');

  let revision: number;
  if (!hasSchemaVersion) {
    if (hasRevision) {
      throw new Error('Versionless sync configuration cannot declare a revision');
    }
    revision = 0;
  } else {
    if (object.schemaVersion !== SYNC_CONFIG_SCHEMA_VERSION) {
      throw new Error('Sync configuration schema is not supported');
    }
    revision = assertRevision(object.revision, 'Sync configuration revision', false);
  }

  return createRecord(object, revision, !hasSchemaVersion);
}

/** Validate and deep-clone an untrusted runtime action target before queuing it. */
export function decodeSyncCommandTarget(value: unknown): SyncCommandTarget {
  const object = clonePlainJsonRecord(value, 'Sync command target');
  for (const key of Object.keys(object)) {
    if (key !== 'config' && key !== 'expectedRevision') {
      throw new Error(`Sync command target contains an unsupported field: ${key}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(object, 'config')) {
    throw new Error('Sync command target config is required');
  }
  if (!Object.prototype.hasOwnProperty.call(object, 'expectedRevision')) {
    throw new Error('Sync command target expectedRevision is required');
  }

  const expectedRevision = assertRevision(
    object.expectedRevision,
    'Sync command expectedRevision',
    true,
  );
  const configObject = clonePlainJsonRecord(object.config, 'Sync command config');
  if (
    Object.prototype.hasOwnProperty.call(configObject, 'schemaVersion')
    && configObject.schemaVersion !== SYNC_CONFIG_SCHEMA_VERSION
  ) {
    throw new Error('Sync command config schema is not supported');
  }
  if (Object.prototype.hasOwnProperty.call(configObject, 'revision')) {
    const declaredRevision = assertRevision(configObject.revision, 'Sync command config revision', true);
    const projectedExpected = expectedRevision ?? 0;
    if (declaredRevision !== projectedExpected) {
      throw new Error('Sync command config revision does not match expectedRevision');
    }
  }

  const projectedRevision = expectedRevision ?? 0;
  const config = createRecord(configObject, projectedRevision, true).config;
  return deepFreeze({ config, expectedRevision });
}

export function createSyncCommandTarget(
  config: SyncConfig,
  expectedRevision: number | null,
): SyncCommandTarget {
  return decodeSyncCommandTarget({ config, expectedRevision });
}

/**
 * Replace provider-specific fields while retaining schema metadata and truly
 * additive fields from a newer compatible writer.
 */
export function replaceSyncConfigProvider(
  current: SyncConfig,
  replacement: SyncConfig,
): SyncConfig {
  const extensions = Object.fromEntries(
    Object.entries(current).filter(([key]) => (
      !SYNC_CONFIG_METADATA_KEYS.has(key)
      && !SYNC_CONFIG_PROVIDER_KEYS.has(key)
      && key !== 'lastSyncAt'
    )),
  );
  const metadata = Object.fromEntries(
    Object.entries(current).filter(([key]) => SYNC_CONFIG_METADATA_KEYS.has(key)),
  );
  return clonePlainJsonRecord(
    { ...extensions, ...replacement, ...metadata },
    'Sync provider replacement',
  ) as unknown as SyncConfig;
}

function createRecord(
  value: unknown,
  revision: number,
  allowProviderless = false,
): SyncConfigRecord {
  assertRevision(revision, 'Sync configuration revision', true);
  const object = clonePlainJsonRecord(value, 'Sync configuration');
  const provider = decodeProvider(object.provider, object, allowProviderless);
  const lastSyncAt = decodeLastSyncAt(object.lastSyncAt);

  if (provider === 'webdav') {
    requireString(object.url, 'Sync configuration url');
    requireString(object.username, 'Sync configuration username');
    requireString(object.password, 'Sync configuration password');
    requireString(object.remotePath, 'Sync configuration remotePath');
  } else {
    requireString(object.clientId, 'Sync configuration clientId');
    requireString(object.clientSecret, 'Sync configuration clientSecret');
    if (object.refreshToken !== undefined) {
      requireString(object.refreshToken, 'Sync configuration refreshToken');
    }
  }

  const config = deepFreeze({
    ...object,
    provider,
    lastSyncAt,
    schemaVersion: SYNC_CONFIG_SCHEMA_VERSION,
    revision,
  }) as VersionedSyncConfig;
  return deepFreeze({ config, revision });
}

function decodeProvider(
  value: unknown,
  object: Record<string, unknown>,
  allowProviderless: boolean,
): SyncConfig['provider'] {
  if (value === 'webdav' || value === 'gdrive' || value === 'onedrive') return value;
  if (value === undefined && allowProviderless && hasLegacyWebdavShape(object)) return 'webdav';
  throw new Error('Sync configuration provider is not supported');
}

function hasLegacyWebdavShape(object: Record<string, unknown>): boolean {
  return ['url', 'username', 'password', 'remotePath'].every((key) => (
    Object.prototype.hasOwnProperty.call(object, key)
  ));
}

function decodeLastSyncAt(value: unknown): number | null {
  if (value === null) return null;
  return assertTimestamp(value, 'Sync configuration lastSyncAt');
}

function assertTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function assertRevision(value: unknown, label: string, nullable: true): number | null;
function assertRevision(value: unknown, label: string, nullable: false): number;
function assertRevision(value: unknown, label: string, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer${nullable ? ' or null' : ''}`);
  }
  return value as number;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function clonePlainJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`${label} must be a plain object`);
  return cloneJsonValue(value, label) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown, label: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => cloneJsonValue(item, `${label}[${index}]`));
  }
  if (isPlainRecord(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        value: cloneJsonValue(item, `${label}.${key}`),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return clone;
  }
  throw new Error(`${label} must contain only JSON-compatible values`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return value;
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}
