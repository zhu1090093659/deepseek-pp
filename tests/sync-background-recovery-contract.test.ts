import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('entrypoints/background.ts', 'utf8');
const settingsState = readFileSync(
  'entrypoints/sidepanel/components/settings/useSettingsState.ts',
  'utf8',
);
const syncCoordinator = readFileSync('core/sync/operation-coordinator.ts', 'utf8');
const localSkillMerge = readFileSync('core/sync/local-skill-merge.ts', 'utf8');

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
  });

  it('fully stages the remote snapshot before the journaled local apply commit point', () => {
    const downloadCase = background.slice(
      background.indexOf("case 'WEBDAV_DOWNLOAD_REMOTE':"),
      background.indexOf("case 'CHAT_SUBMIT_PROMPT':"),
    );
    const downloadEffect = background.slice(
      background.indexOf('async function downloadRemoteSyncTarget'),
      background.indexOf('async function notifyDownloadedSyncState'),
    );
    const coordinatedDownload = syncCoordinator.slice(
      syncCoordinator.lastIndexOf('    download('),
      syncCoordinator.indexOf('export function createSyncCommandErrorResponse'),
    );
    const timestampHelper = syncCoordinator.slice(
      syncCoordinator.indexOf('const updateLastSyncAfterEffect'),
      syncCoordinator.indexOf('return Object.freeze({'),
    );

    expect(downloadCase).toContain('syncOperationCoordinator.download(');
    expect(downloadCase).toContain('message.payload');
    expect(downloadEffect).toContain('const remoteSnapshot = await getRemoteSyncDataSnapshot(backend)');
    expect(downloadEffect).toContain(
      '() => mergeSyncSnapshotWithLocalImports(remoteSnapshot)',
    );
    expect(downloadEffect).toContain('const snapshot = await beginSyncLocalApply(');
    expect(downloadEffect.indexOf('await getRemoteSyncDataSnapshot(backend)'))
      .toBeLessThan(downloadEffect.indexOf('await beginSyncLocalApply('));
    expect(coordinatedDownload.indexOf('await effects.download(config)'))
      .toBeLessThan(coordinatedDownload.indexOf('await updateLastSyncAfterEffect'));
    expect(coordinatedDownload.indexOf('await updateLastSyncAfterEffect'))
      .toBeLessThan(coordinatedDownload.indexOf('await notifyCommitted?.(result)'));
    expect(timestampHelper).toContain('store.updateLastSyncAt(revision, lastSyncAt)');
    expect(downloadEffect).not.toContain('Promise.all(replacements)');
    expect(downloadEffect).not.toContain('replaceAllMemories');
  });

  it('journals project deletion and its Memory cascade in one recoverable local-state mutation', () => {
    const deleteProjectCase = background.slice(
      background.indexOf("case 'DELETE_PROJECT_CONTEXT':"),
      background.indexOf("case 'ADD_CONVERSATION_TO_PROJECT':"),
    );

    expect(deleteProjectCase).toContain(
      'const operation = runLocalStateMutationWithRecovery(() =>',
    );
    expect(deleteProjectCase).toContain('stageDeleteProjectContextAndMemoriesAlreadyLocked(projectId)');
    expect(deleteProjectCase).toContain('await syncLocalRecoveryBarrier.trackApply(operation)');
    expect(deleteProjectCase).not.toContain('deleteMemoriesForProject(');
  });

  it('routes Skill/Source imports and deletes plus Preset deletion through the same recovery journal', () => {
    const deleteSkillCase = background.slice(
      background.indexOf("case 'DELETE_SKILL':"),
      background.indexOf("case 'SET_SKILL_ENABLED':"),
    );
    const importSkillCases = background.slice(
      background.indexOf("case 'IMPORT_GITHUB_SKILL_SOURCE':"),
      background.indexOf("case 'GET_PRESETS':"),
    );
    const deletePresetCase = background.slice(
      background.indexOf("case 'DELETE_PRESET':"),
      background.indexOf("case 'SET_ACTIVE_PRESET':"),
    );

    expect(deleteSkillCase).toContain(
      'beginLocalStateMutation(() => stageDeleteSkillAlreadyLocked(name))',
    );
    expect(importSkillCases).toContain('runLocalStateMutation: beginLocalStateMutation');
    expect(importSkillCases).toContain(
      'beginLocalStateMutation(() => stageDeleteSkillSourceAlreadyLocked(sourceId))',
    );
    expect(deletePresetCase).toContain(
      'beginLocalStateMutation(() => stageDeletePresetAlreadyLocked(presetId))',
    );
  });

  it('shares one local-only Skill sync policy across upload filtering and download preservation', () => {
    expect(background).toContain('.filter(isSyncableSkill)');
    expect(background).toContain('.filter(isSyncableSkillSource)');
    expect(localSkillMerge).toContain('.filter(isLocalOnlySkill)');
    expect(localSkillMerge).toContain('.filter(isLocalOnlySkillSource)');
    expect(background).not.toContain('function isSyncableSkill(');
    expect(localSkillMerge).not.toContain('function isLocalImportedSkill(');
  });

  it('imports a Settings Memory JSON batch through one atomic background command', () => {
    const settingsImport = settingsState.slice(
      settingsState.indexOf('const handleImport = useCallback'),
      settingsState.indexOf('const handleClearAllMemories = useCallback'),
    );
    const backgroundImport = background.slice(
      background.indexOf("case 'IMPORT_MEMORY_DRAFTS':"),
      background.indexOf("case 'UPDATE_MEMORY':"),
    );

    expect(settingsImport).toContain("type: 'IMPORT_MEMORY_DRAFTS'");
    expect(settingsImport).not.toContain("type: 'SAVE_MEMORY'");
    expect(backgroundImport).toContain('ids = await importMemoriesAtomically(memories)');
    expect(backgroundImport).toContain('await notifyCommittedStateUpdate(context.tabId)');
    expect(backgroundImport).not.toContain('for (const memory');
  });
});
