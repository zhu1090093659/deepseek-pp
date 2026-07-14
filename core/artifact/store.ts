import Dexie, { type EntityTable } from 'dexie';
import type { ArtifactFile, ArtifactRecord, ArtifactView } from './types';
import {
  ARTIFACT_PERSISTENCE_CONTRACT,
  decodeArtifactRecord,
  decodeArtifactRecords,
} from './schema';

const db = new Dexie(ARTIFACT_PERSISTENCE_CONTRACT.databaseName) as Dexie & {
  artifacts: EntityTable<ArtifactRecord, 'id'>;
};

db.version(ARTIFACT_PERSISTENCE_CONTRACT.databaseVersion).stores({
  [ARTIFACT_PERSISTENCE_CONTRACT.tableName]: ARTIFACT_PERSISTENCE_CONTRACT.tableSchema,
});

type LegacyArtifactSlot =
  | { present: false }
  | { present: true; value: unknown };

let legacyMigrationPromise: Promise<void> | null = null;

export async function saveArtifact(input: {
  kind: ArtifactRecord['kind'];
  filename: string;
  mimeType: string;
  content: string;
  files?: ArtifactFile[];
  view?: ArtifactView;
}): Promise<ArtifactRecord> {
  const record = decodeArtifactRecord(buildArtifactRecord(input), 'artifactInput');
  await ensureLegacyArtifactsMigrated();

  await db.transaction('rw', db.artifacts, async () => {
    await readValidatedArtifactRecords();
    await db.artifacts.put(record);
    await pruneArtifactDb(record.id);
    if (!await db.artifacts.get(record.id)) {
      throw new Error(`Artifact save did not retain record: ${record.id}`);
    }
  });
  return record;
}

export async function getArtifact(id: string): Promise<ArtifactRecord | null> {
  await ensureLegacyArtifactsMigrated();
  return (await readValidatedArtifactRecords()).find((record) => record.id === id) ?? null;
}

export async function getArtifacts(): Promise<ArtifactRecord[]> {
  await ensureLegacyArtifactsMigrated();
  const records = await readValidatedArtifactRecords();
  return [...records]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, ARTIFACT_PERSISTENCE_CONTRACT.maxRecords);
}

function buildArtifactRecord(input: {
  kind: ArtifactRecord['kind'];
  filename: string;
  mimeType: string;
  content: string;
  files?: ArtifactFile[];
  view?: ArtifactView;
}): ArtifactRecord {
  return {
    id: crypto.randomUUID(),
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mimeType,
    content: input.content,
    sizeBytes: new TextEncoder().encode(input.content).length,
    createdAt: Date.now(),
    files: input.files,
    view: input.view,
  };
}

async function ensureLegacyArtifactsMigrated(): Promise<void> {
  assertIndexedDbAvailable();
  await assertCurrentArtifactDatabaseVersion();
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = migrateLegacyArtifacts().catch((error) => {
      legacyMigrationPromise = null;
      throw error;
    });
  }
  await legacyMigrationPromise;
}

async function migrateLegacyArtifacts(): Promise<void> {
  const slot = await readLegacyArtifactSlot();
  if (!slot.present) {
    await readValidatedArtifactRecords();
    return;
  }

  const legacy = decodeArtifactRecords(slot.value, 'legacyArtifacts');
  await db.transaction('rw', db.artifacts, async () => {
    const current = await readValidatedArtifactRecords();
    const currentById = new Map(current.map((record) => [record.id, record]));

    for (const record of legacy) {
      const existing = currentById.get(record.id);
      if (existing) {
        if (!sameStructuredValue(existing, record)) {
          throw new Error(`Legacy artifact conflicts with IndexedDB id: ${record.id}`);
        }
        continue;
      }
      await db.artifacts.add(record);
    }

    await readValidatedArtifactRecords();
  });
  await removeLegacyArtifactSlotWithVerification();
}

async function readValidatedArtifactRecords(): Promise<ArtifactRecord[]> {
  return decodeArtifactRecords(
    await db.artifacts.toArray() as unknown[],
    'artifactDatabase',
  );
}

async function pruneArtifactDb(preserveId: string): Promise<void> {
  const orderedIds = await db.artifacts
    .orderBy('createdAt')
    .reverse()
    .primaryKeys() as string[];
  const retainedIds = new Set<string>([preserveId]);
  for (const id of orderedIds) {
    if (retainedIds.size >= ARTIFACT_PERSISTENCE_CONTRACT.maxRecords) break;
    retainedIds.add(id);
  }
  const staleIds = orderedIds.filter((id) => !retainedIds.has(id));
  if (staleIds.length > 0) await db.artifacts.bulkDelete(staleIds);
}

async function readLegacyArtifactSlot(): Promise<LegacyArtifactSlot> {
  const storage = getChromeLocalStorage();
  const key = ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey;
  const data = await storage.get(key) as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(data, key)
    ? { present: true, value: data[key] }
    : { present: false };
}

async function removeLegacyArtifactSlotWithVerification(): Promise<void> {
  const storage = getChromeLocalStorage();
  const key = ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey;
  try {
    await storage.remove(key);
  } catch (removeError) {
    let observed: LegacyArtifactSlot;
    try {
      observed = await readLegacyArtifactSlot();
    } catch (verificationError) {
      throw new AggregateError(
        [removeError, verificationError],
        'Artifact legacy migration cleanup outcome is unknown',
      );
    }
    if (!observed.present) return;
    throw new Error('Artifact legacy migration cleanup failed', { cause: removeError });
  }
}

function getChromeLocalStorage(): chrome.storage.LocalStorageArea {
  try {
    const storage = chrome.storage?.local;
    if (
      !storage
      || typeof storage.get !== 'function'
      || typeof storage.remove !== 'function'
    ) {
      throw new Error('chrome.storage.local is unavailable');
    }
    return storage;
  } catch (error) {
    throw new Error('Artifact legacy storage is unavailable', { cause: error });
  }
}

function assertIndexedDbAvailable(): void {
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    throw new Error('Artifact IndexedDB is unavailable');
  }
}

async function assertCurrentArtifactDatabaseVersion(): Promise<void> {
  await db.open();
  const actualVersion = db.backendDB().version;
  const expectedVersion = ARTIFACT_PERSISTENCE_CONTRACT.databaseVersion * 10;
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Artifact database version ${actualVersion / 10} is not supported by version ${ARTIFACT_PERSISTENCE_CONTRACT.databaseVersion}`,
    );
  }
}

function sameStructuredValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameStructuredValue(item, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  // Chrome storage omits object properties whose value is undefined, while
  // IndexedDB preserves them. Released optional fields therefore compare in
  // their shared structured-data form without weakening real value conflicts.
  const leftKeys = Object.keys(leftRecord)
    .filter((key) => leftRecord[key] !== undefined)
    .sort();
  const rightKeys = Object.keys(rightRecord)
    .filter((key) => rightRecord[key] !== undefined)
    .sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && sameStructuredValue(leftRecord[key], rightRecord[key])
    ));
}

export { db };
