import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('entrypoints/background.ts', 'utf8');
const settingsState = readFileSync(
  'entrypoints/sidepanel/controllers/useSettingsController.ts',
  'utf8',
);
const syncCoordinator = readFileSync('core/sync/operation-coordinator.ts', 'utf8');
const syncHandlers = readFileSync('entrypoints/background/sync-runtime-handlers.ts', 'utf8');
const syncService = readFileSync('entrypoints/background/sync-runtime-service.ts', 'utf8');
const localSkillMerge = readFileSync('core/sync/local-skill-merge.ts', 'utf8');
const memoryHandlers = readFileSync('entrypoints/background/memory-handlers.ts', 'utf8');
const projectHandlers = readFileSync('entrypoints/background/project-handlers.ts', 'utf8');
const skillHandlers = readFileSync('entrypoints/background/skill-handlers.ts', 'utf8');
const libraryHandlers = readFileSync('entrypoints/background/library-handlers.ts', 'utf8');
const mutationRunner = readFileSync(
  'entrypoints/background/local-state-mutation-runner.ts',
  'utf8',
);
const persistenceMutations = readFileSync(
  'entrypoints/background/persistence-mutation-bindings.ts',
  'utf8',
);

describe('background sync recovery integration', () => {
  it('establishes the recovery barrier before startup mutation and runtime dispatch', () => {
    const startup = background.indexOf('void syncLocalRecoveryBarrier.ensureReady()');
    const archive = background.indexOf('.then(() => archiveStaleMemories()');
    const runtimeDispatch = background.indexOf('.then(() => handleMessage(envelope, context))');
    const automationScan = background.indexOf('.then(() => scanDueAutomationsFromWake()');

    expect(startup).toBeGreaterThan(-1);
    expect(archive).toBeGreaterThan(startup);
    expect(runtimeDispatch).toBeGreaterThan(startup);
    expect(automationScan).toBeGreaterThan(startup);
    expect(background).not.toContain('syncLocalStateReady');
    expect(background).toContain('syncLocalRecoveryBarrier.trackApply(operation)');
    expect(background).toContain('createTrackedLocalStateMutationRunner({');
    expect(mutationRunner).toContain(
      'dependencies.trackApply(dependencies.runWithRecovery(stage))',
    );
  });

  it('fully stages the remote snapshot before the journaled local apply commit point', () => {
    const downloadEffect = syncService.slice(
      syncService.indexOf('const download = async'),
      syncService.indexOf('return Object.freeze({ test, authorize, upload, download })'),
    );
    const coordinatedDownload = syncCoordinator.slice(
      syncCoordinator.lastIndexOf('    download('),
      syncCoordinator.indexOf('export function createSyncCommandErrorResponse'),
    );
    const timestampHelper = syncCoordinator.slice(
      syncCoordinator.indexOf('const updateLastSyncAfterEffect'),
      syncCoordinator.indexOf('return Object.freeze({'),
    );

    expect(syncHandlers).toContain("'WEBDAV_DOWNLOAD_REMOTE'");
    expect(syncHandlers).toContain('dependencies.coordinator.download(');
    expect(syncHandlers).toContain('target,');
    expect(downloadEffect).toContain('const remoteSnapshot = await getRemoteSyncDataSnapshot(');
    expect(downloadEffect).toContain(
      '() => mergeSyncSnapshotWithLocalImports(remoteSnapshot)',
    );
    expect(downloadEffect).toContain('const snapshot = await dependencies.beginLocalApply(');
    expect(downloadEffect.indexOf('await getRemoteSyncDataSnapshot('))
      .toBeLessThan(downloadEffect.indexOf('await dependencies.beginLocalApply('));
    expect(coordinatedDownload.indexOf('await effects.download(config)'))
      .toBeLessThan(coordinatedDownload.indexOf('await updateLastSyncAfterEffect'));
    expect(coordinatedDownload.indexOf('await updateLastSyncAfterEffect'))
      .toBeLessThan(coordinatedDownload.indexOf('await notifyCommitted?.(result)'));
    expect(timestampHelper).toContain('store.updateLastSyncAt(revision, lastSyncAt)');
    expect(downloadEffect).not.toContain('Promise.all(replacements)');
    expect(downloadEffect).not.toContain('replaceAllMemories');
  });

  it('journals project deletion and its Memory cascade in one recoverable local-state mutation', () => {
    const projectComposition = background.slice(
      background.indexOf('project: {'),
      background.indexOf('localPreference: {'),
    );

    expect(projectComposition).toContain(
      'deleteProjectContext: persistenceMutations.deleteProjectContext',
    );
    expect(persistenceMutations).toContain(
      '() => dependencies.stageDeleteProjectContextAndMemoriesAlreadyLocked(projectId)',
    );
    expect(projectHandlers).toContain('await dependencies.deleteProjectContext(payload.projectId)');
    expect(projectHandlers).toContain('await dependencies.notifyCommittedProjectContextUpdate(context.tabId)');
    expect(projectHandlers).not.toContain('deleteMemoriesForProject(');
  });

  it('routes Skill/Source imports and deletes plus Preset deletion through the same recovery journal', () => {
    const persistenceComposition = background.slice(
      background.indexOf('...createPersistenceRuntimeHandlers({'),
      background.indexOf('...createToolRuntimeHandlers({'),
    );

    expect(persistenceComposition).toContain('deleteSkill: persistenceMutations.deleteSkill');
    expect(persistenceComposition).toContain(
      'importGitHubSkillSource: persistenceMutations.importGitHubSkillSource',
    );
    expect(persistenceComposition).toContain(
      'importLocalSkillSource: persistenceMutations.importLocalSkillSource',
    );
    expect(persistenceComposition).toContain(
      'deleteGitHubSkillSource: persistenceMutations.deleteGitHubSkillSource',
    );
    expect(persistenceComposition).toContain('deletePreset: persistenceMutations.deletePreset');
    expect(persistenceMutations).toContain(
      '() => dependencies.stageDeleteSkillAlreadyLocked(name)',
    );
    expect(persistenceMutations).toContain('runner,');
    expect(persistenceMutations).toContain(
      '() => dependencies.stageDeleteSkillSourceAlreadyLocked(sourceId)',
    );
    expect(persistenceMutations).toContain(
      '() => dependencies.stageDeletePresetAlreadyLocked(id)',
    );
    expect(skillHandlers).toContain('await dependencies.deleteSkill(payload.name)');
    expect(skillHandlers).toContain('await dependencies.deleteGitHubSkillSource(payload.sourceId)');
    expect(libraryHandlers).toContain('await dependencies.deletePreset(payload.id)');
  });

  it('shares one local-only Skill sync policy across upload filtering and download preservation', () => {
    expect(syncService).toContain('.filter(isSyncableSkill)');
    expect(syncService).toContain('.filter(isSyncableSkillSource)');
    expect(localSkillMerge).toContain('.filter(isLocalOnlySkill)');
    expect(localSkillMerge).toContain('.filter(isLocalOnlySkillSource)');
    expect(syncService).not.toContain('function isSyncableSkill(');
    expect(localSkillMerge).not.toContain('function isLocalImportedSkill(');
  });

  it('imports a Settings Memory JSON batch through one atomic background command', () => {
    const settingsImport = settingsState.slice(
      settingsState.indexOf('const handleImport = useCallback'),
      settingsState.indexOf('const handleClearAllMemories = useCallback'),
    );
    expect(settingsImport).toContain("type: 'IMPORT_MEMORY_DRAFTS'");
    expect(settingsImport).not.toContain("type: 'SAVE_MEMORY'");
    expect(memoryHandlers).toContain('ids = await dependencies.importMemoriesAtomically(payload.memories)');
    expect(memoryHandlers).toContain('await dependencies.notifyCommittedStateUpdate(context.tabId)');
    expect(memoryHandlers).not.toContain('for (const memory');
  });
});
