import Dexie, { type EntityTable } from 'dexie';
import type { ArtifactFile, ArtifactRecord, ArtifactView } from './types';
import { ARTIFACT_PERSISTENCE_CONTRACT, isArtifactRecord } from './schema';

const db = new Dexie(ARTIFACT_PERSISTENCE_CONTRACT.databaseName) as Dexie & {
  artifacts: EntityTable<ArtifactRecord, 'id'>;
};

db.version(ARTIFACT_PERSISTENCE_CONTRACT.databaseVersion).stores({
  [ARTIFACT_PERSISTENCE_CONTRACT.tableName]: ARTIFACT_PERSISTENCE_CONTRACT.tableSchema,
});

let legacyMigrationPromise: Promise<void> | null = null;

export async function saveArtifact(input: {
  kind: ArtifactRecord['kind'];
  filename: string;
  mimeType: string;
  content: string;
  files?: ArtifactFile[];
  view?: ArtifactView;
}): Promise<ArtifactRecord> {
  const record = buildArtifactRecord(input);

  if (shouldUseIndexedDbArtifacts()) {
    await ensureLegacyArtifactsMigrated();
    try {
      await db.artifacts.put(record);
      await pruneArtifactDb();
      return record;
    } catch (error) {
      console.warn('[DeepSeek++] artifact IndexedDB write failed, falling back to storage.local', error);
    }
  }

  const records = await getLegacyArtifacts();
  await setLegacyArtifacts([record, ...records].slice(0, ARTIFACT_PERSISTENCE_CONTRACT.maxRecords));
  return record;
}

export async function getArtifact(id: string): Promise<ArtifactRecord | null> {
  if (shouldUseIndexedDbArtifacts()) {
    await ensureLegacyArtifactsMigrated();
    try {
      const record = await db.artifacts.get(id);
      if (record) return record;
    } catch (error) {
      console.warn('[DeepSeek++] artifact IndexedDB read failed, falling back to storage.local', error);
    }
  }

  return (await getLegacyArtifacts()).find((artifact) => artifact.id === id) ?? null;
}

export async function getArtifacts(): Promise<ArtifactRecord[]> {
  if (shouldUseIndexedDbArtifacts()) {
    await ensureLegacyArtifactsMigrated();
    try {
      return await db.artifacts.orderBy('createdAt').reverse().limit(ARTIFACT_PERSISTENCE_CONTRACT.maxRecords).toArray();
    } catch (error) {
      console.warn('[DeepSeek++] artifact IndexedDB list failed, falling back to storage.local', error);
    }
  }

  return getLegacyArtifacts();
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

function shouldUseIndexedDbArtifacts(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

async function ensureLegacyArtifactsMigrated(): Promise<void> {
  if (!shouldUseIndexedDbArtifacts()) return;
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = migrateLegacyArtifacts().catch((error) => {
      console.warn('[DeepSeek++] artifact legacy migration skipped', error);
    });
  }
  await legacyMigrationPromise;
}

async function migrateLegacyArtifacts(): Promise<void> {
  const legacy = await getLegacyArtifacts();
  if (legacy.length === 0) {
    await clearLegacyArtifacts();
    return;
  }

  await db.transaction('rw', db.artifacts, async () => {
    await db.artifacts.bulkPut(legacy);
    await pruneArtifactDb();
  });
  await clearLegacyArtifacts();
}

async function pruneArtifactDb(): Promise<void> {
  const staleIds = await db.artifacts
    .orderBy('createdAt')
    .reverse()
    .offset(ARTIFACT_PERSISTENCE_CONTRACT.maxRecords)
    .primaryKeys() as string[];
  if (staleIds.length === 0) return;
  await db.artifacts.bulkDelete(staleIds);
}

async function getLegacyArtifacts(): Promise<ArtifactRecord[]> {
  const storage = getChromeLocalStorage();
  if (!storage) return [];
  const data = await storage.get(ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey) as Record<string, unknown>;
  const value = data[ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey];
  if (!Array.isArray(value)) return [];
  return value.filter(isArtifactRecord);
}

async function setLegacyArtifacts(records: ArtifactRecord[]): Promise<void> {
  const storage = getChromeLocalStorage();
  if (!storage) return;
  await storage.set({ [ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey]: records });
}

async function clearLegacyArtifacts(): Promise<void> {
  const storage = getChromeLocalStorage();
  if (!storage || typeof storage.remove !== 'function') return;
  await storage.remove(ARTIFACT_PERSISTENCE_CONTRACT.legacyStorageKey);
}

function getChromeLocalStorage(): chrome.storage.LocalStorageArea | null {
  try {
    const storage = chrome.storage?.local;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}
