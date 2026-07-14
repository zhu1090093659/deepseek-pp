import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('entrypoints/background.ts', 'utf8');
const settingsState = readFileSync(
  'entrypoints/sidepanel/components/settings/useSettingsState.ts',
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
  });

  it('fully stages the remote snapshot before the journaled local apply commit point', () => {
    const downloadCase = background.slice(
      background.indexOf("case 'WEBDAV_DOWNLOAD_REMOTE':"),
      background.indexOf("case 'CHAT_SUBMIT_PROMPT':"),
    );

    expect(downloadCase).toContain('const remoteSnapshot = await getRemoteSyncDataSnapshot(backend)');
    expect(downloadCase).toContain(
      '() => mergeSyncSnapshotWithLocalImports(remoteSnapshot)',
    );
    expect(downloadCase).toContain('const snapshot = await beginSyncLocalApply(');
    expect(downloadCase.indexOf('const snapshot = await beginSyncLocalApply('))
      .toBeLessThan(downloadCase.indexOf('await saveSyncConfig'));
    expect(downloadCase.indexOf('await saveSyncConfig'))
      .toBeLessThan(downloadCase.indexOf('await broadcastStateUpdate'));
    expect(downloadCase).not.toContain('Promise.all(replacements)');
    expect(downloadCase).not.toContain('replaceAllMemories');
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
