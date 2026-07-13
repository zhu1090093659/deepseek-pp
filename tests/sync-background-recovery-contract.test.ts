import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('entrypoints/background.ts', 'utf8');

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

  it('keeps project deletion and its Memory cascade in one local-state critical section', () => {
    const deleteProjectCase = background.slice(
      background.indexOf("case 'DELETE_PROJECT_CONTEXT':"),
      background.indexOf("case 'ADD_CONVERSATION_TO_PROJECT':"),
    );

    expect(deleteProjectCase).toContain(
      'await deleteProjectContextAndMemories(projectId)',
    );
    expect(deleteProjectCase).not.toContain('deleteMemoriesForProject(');
  });
});
