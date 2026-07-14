import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('whole-key persistence boundaries', () => {
  it('owns one independent queue per store instead of joining the sync-global lock', () => {
    for (const [path, queueFactory] of [
      ['core/automation/store.ts', 'createSerialOperationQueue'],
      ['core/usage/store.ts', 'createCoalescingMutationQueue'],
      ['core/tool/history.ts', 'createCoalescingMutationQueue'],
    ] as const) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain(queueFactory);
      expect(source).not.toContain('withSyncLocalStateLock');
    }
  });

  it('reuses the queue primitive for the sync recovery lock', () => {
    const source = readFileSync('core/persistence/local-state-lock.ts', 'utf8');
    expect(source).toContain('createSerialOperationQueue');
    expect(source).not.toContain('.then(run, run)');
  });

  it('routes usage persistence through the strict runtime path and restores retry after failure', () => {
    const source = readFileSync('entrypoints/content.ts', 'utf8');
    const start = source.indexOf('function recordUsageProgress');
    const end = source.indexOf('function renderTokenSpeedIndicator', start);
    const recorder = source.slice(start, end);

    expect(recorder).toContain('sendRuntimeMessageStrict');
    expect(recorder).toContain('usageProgressWrites.persist');
    expect(recorder).toContain('.catch((error) =>');
    expect(recorder).toContain("console.error('[DeepSeek++] Failed to persist usage turn.'");
    expect(recorder).not.toContain('void sendRuntimeMessage({');
  });

  it('unwraps background failures before rendering Usage or Tool History data', () => {
    const automation = readFileSync('entrypoints/sidepanel/pages/AutomationPage.tsx', 'utf8');
    const usage = readFileSync(
      'entrypoints/sidepanel/components/settings/UsageSubPage.tsx',
      'utf8',
    );
    const usageController = readFileSync(
      'entrypoints/sidepanel/controllers/usage-controller.ts',
      'utf8',
    );
    const mcp = readFileSync('entrypoints/sidepanel/pages/McpPage.tsx', 'utf8');
    const mcpController = readFileSync(
      'entrypoints/sidepanel/controllers/mcp-tools-controller.ts',
      'utf8',
    );

    expect(automation).toContain('decodeAutomationList');
    expect(automation).toContain('sidepanelRuntimeClient.request');
    expect(automation).not.toContain('chrome.runtime.sendMessage');
    expect(usage).toContain('usageController.getSummary');
    expect(usageController).toContain('sidepanelRuntimeClient');
    expect(usageController).toContain('isUsageSummary(value)');
    expect(mcp).toContain('useMcpPageController');
    expect(mcpController).toContain('sidepanelRuntimeClient');
    expect(mcpController).toContain("decodeToolCallHistory(value, 'GET_TOOL_CALL_HISTORY response')");
  });
});
