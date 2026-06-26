import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from '../core/shell';

vi.mock('../core/mcp/store', () => ({
  getAllMcpServers: vi.fn(),
  updateMcpServer: vi.fn(),
}));

vi.mock('../core/mcp/discovery', () => ({
  executeMcpToolCall: vi.fn(),
  refreshMcpServerDiscovery: vi.fn(),
}));

import { executeMcpToolCall, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import { getAllMcpServers, updateMcpServer } from '../core/mcp/store';
import type { McpServerConfig } from '../core/mcp/types';
import { importLocalSkillSource, pickLocalSkillFolder, previewLocalSkillSource } from '../core/skill/local-importer';

const SKILL_STORAGE_KEY = 'deepseek_pp_skills';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | null | undefined) => {
          if (typeof key === 'string') return { [key]: storage[key] };
          if (Array.isArray(key)) return Object.fromEntries(key.map((item) => [item, storage[item]]));
          return { ...storage };
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
  });
  const shellServer = createShellServer(['local_skill_preview', 'local_folder_pick']);
  vi.mocked(getAllMcpServers).mockResolvedValue([shellServer]);
  vi.mocked(updateMcpServer).mockImplementation(async (_id, patch) => ({
    ...shellServer,
    ...patch,
    allowlist: patch.allowlist ?? shellServer.allowlist,
  }));
  vi.mocked(refreshMcpServerDiscovery).mockResolvedValue({} as never);
  vi.mocked(executeMcpToolCall).mockResolvedValue(createLocalSkillToolResult());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('local Skill importer', () => {
  it('picks local Skill folders through Shell MCP', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createFolderPickToolResult());

    await expect(pickLocalSkillFolder('/Users/me/.codex/skills')).resolves.toBe('/Users/me/.codex/skills/demo');
    expect(executeMcpToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'local_folder_pick',
      descriptorId: 'mcp:shell-local:local_folder_pick',
      payload: {
        title: 'Choose a local Skill folder',
        defaultPath: '/Users/me/.codex/skills',
      },
    }));
  });

  it('adds local Skill tools to older Shell allowlists before picking folders', async () => {
    vi.mocked(getAllMcpServers).mockResolvedValueOnce([createShellServer(['shell_status', 'python_status'])]);
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createFolderPickToolResult());

    await expect(pickLocalSkillFolder()).resolves.toBe('/Users/me/.codex/skills/demo');
    expect(updateMcpServer).toHaveBeenCalledWith('shell-local', {
      allowlist: {
        mode: 'allow',
        toolNames: ['shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick'],
      },
    });
  });

  it('refreshes Shell discovery once when the folder picker cache is stale', async () => {
    vi.mocked(executeMcpToolCall)
      .mockResolvedValueOnce({
        ok: false,
        summary: 'MCP tool unavailable',
        detail: 'MCP tool is not available on server Shell Local.',
        name: 'local_folder_pick',
        error: {
          code: 'mcp_tool_not_found',
          message: 'MCP tool is not available on server Shell Local.',
          retryable: true,
        },
      })
      .mockResolvedValueOnce(createFolderPickToolResult());

    await expect(pickLocalSkillFolder()).resolves.toBe('/Users/me/.codex/skills/demo');
    expect(refreshMcpServerDiscovery).toHaveBeenCalledWith('shell-local');
    expect(executeMcpToolCall).toHaveBeenCalledTimes(2);
  });

  it('explains legacy Windows folder picker failures as stale Shell Native Host installs', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce({
      ok: false,
      summary: 'MCP tool failed',
      detail: 'Command failed: powershell.exe -NoProfile -STA -Command Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {}; Choose a local Skill folder Choose : CommandNotFoundException',
      name: 'local_folder_pick',
      error: {
        code: 'mcp_tool_failed',
        message: 'Command failed: powershell.exe -NoProfile -STA -Command Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; Choose a local Skill folder Choose : CommandNotFoundException',
        retryable: false,
      },
    });

    await expect(pickLocalSkillFolder()).rejects.toThrow('Reinstall Shell Native Host');
  });

  it('previews and imports local Skills while preserving script execution boundaries', async () => {
    const preview = await previewLocalSkillSource('/Users/me/.codex/skills/demo');

    expect(preview.source.provider).toBe('local');
    expect(preview.skills[0]).toMatchObject({
      path: 'SKILL.md',
      importName: 'demo-local',
      description: 'Demo local Skill',
    });
    expect(preview.skills[0].scriptFiles).toEqual([{ path: 'scripts/run.py', bytes: 18 }]);

    const result = await importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['SKILL.md'],
    });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].remote).toMatchObject({
      provider: 'local',
      localRootPath: '/Users/me/.codex/skills/demo',
      localDirectory: '/Users/me/.codex/skills/demo',
      scriptFiles: [{ path: 'scripts/run.py', bytes: 18 }],
    });
    expect(result.imported[0].instructions).toContain('Local Execution Boundary');
    expect(result.imported[0].instructions).toContain('Run commands with cwd set to the Skill directory path: /Users/me/.codex/skills/demo');
    expect(result.imported[0].instructions).toContain('scripts/run.py');
    expect(result.imported[0].instructions).toContain('### references/guide.md');
    expect(storage[SKILL_STORAGE_KEY]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-local', source: 'remote' }),
    ]));
  });
});

function createShellServer(toolNames: string[]): McpServerConfig {
  return {
    id: 'shell-local',
    displayName: SHELL_MCP_SERVER_NAME,
    enabled: true,
    transport: { kind: 'native_messaging' as const, nativeHost: SHELL_MCP_NATIVE_HOST },
    execution: { enabled: true, mode: 'manual' as const },
    allowlist: { mode: 'allow' as const, toolNames },
    timeouts: { connectMs: 1, requestMs: 1, discoveryMs: 1 },
    limits: { maxResultBytes: 128_000, maxToolCount: 8 },
    headers: [],
    secrets: [],
    version: 1 as const,
    status: 'ready' as const,
    lastConnectedAt: 1,
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function createFolderPickToolResult() {
  return {
    ok: true,
    summary: 'MCP tool executed',
    output: {
      ok: true,
      data: {
        path: '/Users/me/.codex/skills/demo',
      },
    },
  };
}

function createLocalSkillToolResult() {
  const content = [
    '---',
    'name: demo-local',
    'description: Demo local Skill',
    'version: 1.2.3',
    '---',
    '',
    '# Demo',
    '',
    'Use scripts/run.py when computation is needed.',
  ].join('\n');

  return {
    ok: true,
    summary: 'MCP tool executed',
    output: {
      ok: true,
      data: {
        rootPath: '/Users/me/.codex/skills/demo',
        displayName: 'demo',
        directoryName: 'demo',
        warnings: [],
        truncated: false,
        skills: [
          {
            path: 'SKILL.md',
            directory: '',
            directoryPath: '/Users/me/.codex/skills/demo',
            content,
            bodyBytes: content.length,
            includedFiles: [
              {
                path: 'references/guide.md',
                bytes: 11,
                content: 'Guide text.',
              },
            ],
            omittedFiles: [],
            scriptFiles: [{ path: 'scripts/run.py', bytes: 18 }],
            warnings: [],
          },
        ],
      },
    },
  };
}
