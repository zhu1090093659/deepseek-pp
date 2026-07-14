import { getAllMemoriesAlreadyLocked } from '../../core/memory/store';
import { decodePresetCollection } from '../../core/preset/codec';
import { getAllPresetsAlreadyLocked } from '../../core/preset/store';
import { withSyncLocalStateLock } from '../../core/persistence/local-state-lock';
import {
  decodeProjectContextState,
  getProjectContextStateAlreadyLocked,
} from '../../core/project';
import {
  decodeSavedItemsState,
  getSavedItemsStateAlreadyLocked,
} from '../../core/saved-items';
import {
  decodeSkillSourceCollection,
  decodeUserSkillCollection,
} from '../../core/skill/codec';
import {
  getAllSkillSourcesAlreadyLocked,
  getUserSkillsAlreadyLocked,
} from '../../core/skill/registry';
import { isSyncableSkill, isSyncableSkillSource } from '../../core/skill/sync-policy';
import { createStorageBackend } from '../../core/sync/backend-factory';
import type { VersionedOAuthSyncConfig } from '../../core/sync/config';
import {
  OPTIONAL_SYNC_FILE_KEYS,
  REQUIRED_SYNC_FILE_KEYS,
  SYNC_FILE_KEYS,
  type SyncFileKey,
} from '../../core/sync/contracts';
import {
  readCurrentSyncGeneration,
  uploadSyncGeneration,
} from '../../core/sync/generation';
import { authorizeGDrive } from '../../core/sync/gdrive-client';
import { mergeLocalSkillImportsIntoSyncSnapshot } from '../../core/sync/local-skill-merge';
import type { SyncDownloadResult } from '../../core/sync/operation-coordinator';
import { authorizeOneDrive } from '../../core/sync/onedrive-client';
import type { SyncErrorTranslator } from '../../core/sync/oauth-client';
import {
  parseValidatedArray,
  parseValidatedJson,
  validateSyncMemory,
} from '../../core/sync/schema';
import {
  serializeSyncDataSnapshot,
  type SyncDataSnapshot,
} from '../../core/sync/snapshot';
import type { StorageBackend } from '../../core/sync/storage-backend';
import type { SyncConfig, SyncCounts } from '../../core/types';

export interface SyncRuntimeServiceDependencies {
  translate: SyncErrorTranslator;
  beginLocalApply(stage: () => Promise<SyncDataSnapshot>): Promise<SyncDataSnapshot>;
}

export interface SyncRuntimeService {
  test(config: SyncConfig): Promise<void>;
  authorize(config: VersionedOAuthSyncConfig): Promise<string>;
  upload(config: SyncConfig): Promise<SyncCounts>;
  download(config: SyncConfig): Promise<SyncDownloadResult>;
}

export function createSyncRuntimeService(
  dependencies: SyncRuntimeServiceDependencies,
): SyncRuntimeService {
  const test = async (config: SyncConfig): Promise<void> => {
    await createStorageBackend(config, dependencies.translate).test();
  };

  const authorize = async (config: VersionedOAuthSyncConfig): Promise<string> => {
    // OAuth authorization must remain in the extension background runtime.
    if (config.provider === 'gdrive') return authorizeGDrive(config, dependencies.translate);
    return authorizeOneDrive(config, dependencies.translate);
  };

  const upload = async (config: SyncConfig): Promise<SyncCounts> => {
    const backend = createStorageBackend(config, dependencies.translate);
    const [, snapshot] = await Promise.all([
      backend.ensureStore(),
      getLocalSyncDataSnapshot(),
    ]);
    await uploadSyncDataSnapshot(backend, snapshot);
    return getSyncCounts(snapshot);
  };

  const download = async (config: SyncConfig): Promise<SyncDownloadResult> => {
    const backend = createStorageBackend(config, dependencies.translate);
    const remoteSnapshot = await getRemoteSyncDataSnapshot(backend, dependencies.translate);
    const snapshot = await dependencies.beginLocalApply(
      () => mergeSyncSnapshotWithLocalImports(remoteSnapshot),
    );
    return {
      counts: getSyncCounts(snapshot),
      projectContextChanged: snapshot.projectContext !== null,
      savedItemsChanged: snapshot.savedItems !== null,
    };
  };

  return Object.freeze({ test, authorize, upload, download });
}

async function getLocalSyncDataSnapshot(): Promise<SyncDataSnapshot> {
  return withSyncLocalStateLock(async () => {
    const [memories, userSkills, skillSources, presets, projectContext, savedItems] = await Promise.all([
      getAllMemoriesAlreadyLocked(),
      getUserSkillsAlreadyLocked(),
      getAllSkillSourcesAlreadyLocked(),
      getAllPresetsAlreadyLocked(),
      getProjectContextStateAlreadyLocked(),
      getSavedItemsStateAlreadyLocked(),
    ]);

    return {
      memories: memories.map(({ id, ...memory }) => memory),
      skills: userSkills.filter(isSyncableSkill),
      skillSources: skillSources.filter(isSyncableSkillSource),
      presets,
      projectContext,
      savedItems,
    };
  });
}

async function uploadSyncDataSnapshot(
  backend: StorageBackend,
  snapshot: SyncDataSnapshot,
): Promise<void> {
  await uploadSyncGeneration(backend, serializeSyncDataSnapshot(snapshot));
}

async function getRemoteSyncDataSnapshot(
  backend: StorageBackend,
  translate: SyncErrorTranslator,
): Promise<SyncDataSnapshot> {
  const generationFiles = await readCurrentSyncGeneration(backend);
  const remoteFiles = generationFiles ?? await getLegacyRemoteSyncFiles(backend, translate);
  return parseRemoteSyncDataSnapshot(remoteFiles, translate);
}

async function getLegacyRemoteSyncFiles(
  backend: StorageBackend,
  translate: SyncErrorTranslator,
): Promise<ReadonlyMap<SyncFileKey, string>> {
  const [requiredFiles, optionalFiles] = await Promise.all([
    Promise.all(REQUIRED_SYNC_FILE_KEYS.map((file) => (
      backendGetRequired(backend, file, translate)
    ))),
    Promise.all(OPTIONAL_SYNC_FILE_KEYS.map((file) => backend.get(file))),
  ]);
  const entries: [SyncFileKey, string][] = REQUIRED_SYNC_FILE_KEYS.map(
    (file, index) => [file, requiredFiles[index]],
  );
  OPTIONAL_SYNC_FILE_KEYS.forEach((file, index) => {
    const content = optionalFiles[index];
    if (content !== null) entries.push([file, content]);
  });
  return new Map(entries);
}

function parseRemoteSyncDataSnapshot(
  remoteFiles: ReadonlyMap<SyncFileKey, string>,
  translate: SyncErrorTranslator,
): SyncDataSnapshot {
  const remoteMemJson = getRequiredSyncFile(remoteFiles, SYNC_FILE_KEYS.memories, translate);
  const remoteSkillJson = getRequiredSyncFile(remoteFiles, SYNC_FILE_KEYS.skills, translate);
  const remotePresetJson = getRequiredSyncFile(remoteFiles, SYNC_FILE_KEYS.presets, translate);
  const remoteSkillSourceJson = remoteFiles.get(SYNC_FILE_KEYS.skillSources) ?? null;
  const remoteProjectContextJson = remoteFiles.get(SYNC_FILE_KEYS.projectContext) ?? null;
  const remoteSavedItemsJson = remoteFiles.get(SYNC_FILE_KEYS.savedItems) ?? null;

  const memories = parseValidatedArray(SYNC_FILE_KEYS.memories, remoteMemJson, validateSyncMemory);
  const skills = parseValidatedJson(
    SYNC_FILE_KEYS.skills,
    remoteSkillJson,
    decodeUserSkillCollection,
  ).filter(isSyncableSkill);
  const skillSources = remoteSkillSourceJson === null
    ? []
    : parseValidatedJson(
      SYNC_FILE_KEYS.skillSources,
      remoteSkillSourceJson,
      decodeSkillSourceCollection,
    ).filter(isSyncableSkillSource);

  return {
    memories,
    skills,
    skillSources,
    presets: parseValidatedJson(
      SYNC_FILE_KEYS.presets,
      remotePresetJson,
      decodePresetCollection,
    ),
    projectContext: remoteProjectContextJson === null
      ? null
      : parseValidatedJson(
        SYNC_FILE_KEYS.projectContext,
        remoteProjectContextJson,
        decodeProjectContextState,
      ),
    savedItems: remoteSavedItemsJson === null
      ? null
      : parseValidatedJson(
        SYNC_FILE_KEYS.savedItems,
        remoteSavedItemsJson,
        decodeSavedItemsState,
      ),
  };
}

function getRequiredSyncFile(
  files: ReadonlyMap<SyncFileKey, string>,
  file: SyncFileKey,
  translate: SyncErrorTranslator,
): string {
  const content = files.get(file);
  if (content === undefined) {
    throw new Error(translate('background.sync.missingRemoteFile', { file }));
  }
  return content;
}

async function mergeSyncSnapshotWithLocalImports(
  snapshot: SyncDataSnapshot,
): Promise<SyncDataSnapshot> {
  const [userSkills, skillSources] = await Promise.all([
    getUserSkillsAlreadyLocked(),
    getAllSkillSourcesAlreadyLocked(),
  ]);
  const merged = mergeLocalSkillImportsIntoSyncSnapshot(
    {
      skills: snapshot.skills,
      skillSources: snapshot.skillSources,
    },
    {
      skills: userSkills,
      skillSources,
    },
  );
  return {
    ...snapshot,
    skills: merged.skills,
    skillSources: merged.skillSources,
  };
}

async function backendGetRequired(
  backend: StorageBackend,
  file: string,
  translate: SyncErrorTranslator,
): Promise<string> {
  const content = await backend.get(file);
  if (content === null) {
    throw new Error(translate('background.sync.missingRemoteFile', { file }));
  }
  return content;
}

function getSyncCounts(snapshot: SyncDataSnapshot): SyncCounts {
  return {
    memories: snapshot.memories.length,
    skills: snapshot.skills.length,
    presets: snapshot.presets.length,
    projects: snapshot.projectContext?.projects.length ?? 0,
    projectConversations: snapshot.projectContext?.conversations.length ?? 0,
    savedItems: snapshot.savedItems?.items.length ?? 0,
  };
}
