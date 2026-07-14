import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MULTIMODAL_MCP_NATIVE_HOST,
  MULTIMODAL_MCP_SERVER_NAME,
} from '../core/multimodal/contracts';
import { createMcpDescriptorId, createMcpInvocationName } from '../core/mcp/descriptor-identity';
import type { McpServerConfig, McpToolCacheEntry, ToolDescriptor } from '../core/types';
import McpPage from '../entrypoints/sidepanel/pages/McpPage';

let container: HTMLDivElement;
let root: Root | null;
let historyResponse: unknown;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  historyResponse = [];

  vi.stubGlobal('chrome', {
    runtime: {
      getManifest: vi.fn(() => ({ version: '0.7.5' })),
      sendMessage: vi.fn(async (message: { type?: string }) => {
        if (message.type === 'GET_MCP_SERVERS') return [multimodalServer];
        if (message.type === 'GET_PLATFORM_CAPABILITIES') return platformEnvironment;
        if (message.type === 'GET_MCP_TOOL_CACHE') return multimodalCache;
        if (message.type === 'GET_TOOL_CALL_HISTORY') return historyResponse;
        return null;
      }),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
});

describe('McpPage server row collapse', () => {
  it('collapses the initially selected Multimodal Vision row', async () => {
    await renderMcpPage();

    expect(container.textContent).toContain(MULTIMODAL_MCP_NATIVE_HOST);

    const title = findExactText(MULTIMODAL_MCP_SERVER_NAME);
    const collapseIcon = title.previousElementSibling;
    expect(collapseIcon).toBeTruthy();

    await act(async () => {
      collapseIcon!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain(MULTIMODAL_MCP_SERVER_NAME);
    expect(container.textContent).not.toContain(MULTIMODAL_MCP_NATIVE_HOST);
  });

  it('shows a history load failure without discarding the last confirmed history', async () => {
    historyResponse = [toolHistoryRecord];
    await renderMcpPage();

    const recentCalls = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('最近调用'),
    );
    expect(recentCalls).toBeTruthy();
    await act(async () => {
      recentCalls!.click();
    });
    expect(container.textContent).toContain('history_tool');

    historyResponse = { ok: false, error: 'tool history storage is corrupt' };
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();

    expect(container.textContent).toContain('tool history storage is corrupt');
    expect(container.textContent).toContain('history_tool');
  });
});

async function renderMcpPage() {
  await act(async () => {
    root = createRoot(container);
    root.render(React.createElement(McpPage));
  });
  await settle();
}

async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function findExactText(text: string): HTMLElement {
  const element = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (candidate) => candidate.textContent === text,
  );
  expect(element).toBeTruthy();
  return element!;
}

const now = 1_718_000_000_000;

const platformEnvironment = {
  kind: 'browser_extension',
  name: 'WebExtension',
  capabilities: { nativeMessaging: true },
};

const multimodalServer: McpServerConfig = {
  version: 1,
  id: 'multimodal',
  displayName: MULTIMODAL_MCP_SERVER_NAME,
  enabled: true,
  transport: {
    kind: 'native_messaging',
    nativeHost: MULTIMODAL_MCP_NATIVE_HOST,
  },
  headers: [],
  secrets: [],
  timeouts: {
    connectMs: 5_000,
    requestMs: 180_000,
    discoveryMs: 10_000,
  },
  limits: {
    maxResultBytes: 128_000,
    maxToolCount: 8,
  },
  allowlist: {
    mode: 'all',
    toolNames: [],
  },
  execution: {
    enabled: true,
    mode: 'auto',
  },
  status: 'ready',
  lastConnectedAt: now,
  lastError: null,
  createdAt: now,
  updatedAt: now,
};

const multimodalTools: ToolDescriptor[] = [
  toolDescriptor('vision_status', 'Multimodal Status'),
  toolDescriptor('analyze_images', 'Analyze Images'),
  toolDescriptor('analyze_video', 'Analyze Video'),
];

const multimodalCache: McpToolCacheEntry = {
  serverId: multimodalServer.id,
  descriptors: multimodalTools,
  refreshedAt: now,
  expiresAt: now + 60_000,
  health: {
    serverId: multimodalServer.id,
    status: 'ready',
    checkedAt: now,
    latencyMs: 42,
    toolCount: multimodalTools.length,
    error: null,
  },
};

const toolHistoryRecord = {
  id: 'history-1',
  call: {
    id: 'call-1',
    descriptorId: 'multimodal:history_tool',
    provider: {
      kind: 'mcp' as const,
      id: multimodalServer.id,
      displayName: MULTIMODAL_MCP_SERVER_NAME,
      transport: 'native_messaging' as const,
    },
    name: 'history_tool',
    invocationName: 'history_tool',
    payload: {},
    raw: '<history_tool>{}</history_tool>',
  },
  result: {
    ok: true,
    summary: 'history result',
  },
  source: 'manual_chat' as const,
  createdAt: now,
};

function toolDescriptor(name: string, title: string): ToolDescriptor {
  return {
    id: createMcpDescriptorId(multimodalServer.id, name),
    provider: {
      kind: 'mcp',
      id: multimodalServer.id,
      displayName: MULTIMODAL_MCP_SERVER_NAME,
      transport: 'native_messaging',
    },
    name,
    invocationName: createMcpInvocationName(multimodalServer.id, name),
    title,
    description: title,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    execution: {
      enabled: true,
      mode: 'auto',
      risk: 'low',
    },
  };
}
