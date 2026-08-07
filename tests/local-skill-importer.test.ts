import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME } from '../core/shell';

vi.mock('../core/mcp/store', () => ({
  getAllMcpServers: vi.fn(),
  getMcpToolCache: vi.fn(),
  updateMcpServer: vi.fn(),
}));

vi.mock('../core/mcp/discovery', () => ({
  executeMcpToolCall: vi.fn(),
  getMcpToolDescriptors: vi.fn(),
  refreshMcpServerDiscovery: vi.fn(),
}));

import { executeMcpToolCall, getMcpToolDescriptors, refreshMcpServerDiscovery } from '../core/mcp/discovery';
import { getAllMcpServers, getMcpToolCache, updateMcpServer } from '../core/mcp/store';
import type { McpServerConfig, McpToolCacheEntry } from '../core/mcp/types';
import {
  importLocalSkillSource as importLocalSkillSourceWithRuntime,
  parseLocalSkillDoc,
  pickLocalSkillFolder as pickLocalSkillFolderWithRuntime,
  previewLocalSkillSource as previewLocalSkillSourceWithRuntime,
  relocateLocalSkillSource as relocateLocalSkillSourceWithRuntime,
  updateLocalSkillSource as updateLocalSkillSourceWithRuntime,
} from '../core/skill/local-importer';
import type { LocalSkillImportResponse, LocalSkillImportResult } from '../core/types';
import type { ParseSkillDocResult } from '../core/skill/local-importer';
import type { LocalStateMutationStage } from '../core/persistence/local-state-mutation';
import type { ToolCall, ToolResult } from '../core/types';

const SKILL_STORAGE_KEY = 'deepseek_pp_skills';

let storage: Record<string, unknown>;

const importerDeps = {
  executeToolCall: (call: ToolCall) => (
    executeMcpToolCall as unknown as (value: ToolCall) => Promise<ToolResult>
  )(call),
  async runLocalStateMutation<T>(stage: LocalStateMutationStage<T>): Promise<T> {
    return (await stage())();
  },
};

const previewLocalSkillSource = (rootPath: string) =>
  previewLocalSkillSourceWithRuntime(rootPath, importerDeps);
const pickLocalSkillFolder = (defaultPath?: string) =>
  pickLocalSkillFolderWithRuntime(defaultPath, importerDeps);
const importLocalSkillSource = (request: Parameters<typeof importLocalSkillSourceWithRuntime>[0]) =>
  importLocalSkillSourceWithRuntime(request, importerDeps);
const relocateLocalSkillSource = (sourceId: string, newRootPath: string) =>
  relocateLocalSkillSourceWithRuntime(sourceId, newRootPath, importerDeps);
const updateLocalSkillSource = (sourceId: string) =>
  updateLocalSkillSourceWithRuntime(sourceId, importerDeps);

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
  vi.mocked(getMcpToolCache).mockResolvedValue(createShellDiscovery([
    'local_skill_preview',
    'local_folder_pick',
  ]));
  vi.mocked(getMcpToolDescriptors).mockResolvedValue([]);
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

  it('adds local file tools to older Shell allowlists before picking folders', async () => {
    vi.mocked(getAllMcpServers).mockResolvedValueOnce([createShellServer(['shell_status', 'python_status'])]);
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createFolderPickToolResult());

    await expect(pickLocalSkillFolder()).resolves.toBe('/Users/me/.codex/skills/demo');
    expect(updateMcpServer).toHaveBeenCalledWith('shell-local', {
      allowlist: {
        mode: 'allow',
        toolNames: [
          'shell_status',
          'python_status',
          'local_skill_preview',
          'local_folder_pick',
          'local_file_stat',
          'local_file_read',
          'local_file_write',
        ],
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

    const pick = pickLocalSkillFolder();
    await expect(pick).rejects.toThrow('copy the generated install command');
    await expect(pick).rejects.not.toThrow('<your-extension-id>');
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
    expectImportSuccess(result);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].remote).toMatchObject({
      provider: 'local',
      localRootPath: '/Users/me/.codex/skills/demo',
      localDirectory: '/Users/me/.codex/skills/demo',
      scriptFiles: [{ path: 'scripts/run.py', bytes: 18 }],
    });
    expect(result.imported[0].instructions).toContain('Local Execution Boundary');
    expect(result.imported[0].instructions).toContain('Run commands with the initial cwd set to the Skill directory path: /Users/me/.codex/skills/demo');
    expect(result.imported[0].instructions).toContain('scripts/run.py');
    expect(result.imported[0].instructions).toContain('Index form: true');
    expect(result.imported[0].instructions).toContain('Activation Notice');
    expect(result.imported[0].instructions).not.toContain('### references/guide.md');
    expect(storage[SKILL_STORAGE_KEY]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'demo-local', source: 'remote' }),
    ]));
  });

  it('renders nested local Skill resources relative to the Skill directory', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createNestedLocalSkillToolResult());

    const result = await importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills',
      selectedPaths: ['nested/SKILL.md'],
    });
    expectImportSuccess(result);

    const imported = result.imported[0];
    expect(imported.remote).toMatchObject({
      provider: 'local',
      localRootPath: '/Users/me/.codex/skills',
      localDirectory: '/Users/me/.codex/skills/nested',
      scriptFiles: [{ path: 'nested/scripts/run.py', bytes: 15 }],
    });
    expect(imported.instructions).toContain('Run commands with the initial cwd set to the Skill directory path: /Users/me/.codex/skills/nested');
    expect(imported.instructions).toContain('- scripts/run.py (15 bytes)');
    expect(imported.instructions).toContain('Index form: true');
    expect(imported.instructions).not.toContain('### references/child.md');
    expect(imported.instructions).not.toContain('- nested/scripts/run.py');
    expect(imported.instructions).not.toContain('### nested/references/child.md');
  });

  it('describes non-bundled local resources as available on demand', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    const discovery = createShellDiscovery(['local_file_read'], true, null, 'auto');
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(discovery);
    vi.mocked(getMcpToolDescriptors).mockResolvedValueOnce(discovery.descriptors);

    const result = await importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['SKILL.md'],
    });
    expectImportSuccess(result);

    const imported = result.imported[0];
    expect(imported.instructions).toContain('Supporting files available on demand: 1');
    expect(imported.instructions).toContain('## Supporting Files Available on Demand');
    expect(imported.instructions).toContain('Read them with the local file tool when the upstream instructions need them.');
    expect(imported.instructions).toContain('- references/extended-guide.md (2048 bytes)');
    expect(imported.instructions).not.toContain('## Omitted Supporting Files');
  });

  it('keeps preview available but blocks affected Skills on stale Shell Hosts', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(createShellDiscovery(['local_skill_preview', 'shell_exec']));

    const preview = await previewLocalSkillSource('/Users/me/.codex/skills/demo');

    expect(preview.skills[0].importBlock).toEqual({
      code: 'shell_host_update_required',
    });
  });

  it('rejects on-demand imports when local_file_read is disabled by policy', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(createShellDiscovery(['local_file_read'], false, null, 'auto'));

    await expect(importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['SKILL.md'],
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('not available to chat'),
      importBlock: {
        code: 'shell_reader_unavailable',
      },
    });
  });

  it('rejects manual readers that are not injected into the chat prompt', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(createShellDiscovery(['local_file_read']));

    await expect(importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['SKILL.md'],
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('execution mode to Auto'),
      importBlock: {
        code: 'shell_reader_unavailable',
      },
    });
  });

  it('accepts an enabled auto shell_exec fallback on older Shell Hosts', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    const discovery = createShellDiscovery(['local_skill_preview', 'shell_exec'], true, null, 'auto');
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(discovery);
    vi.mocked(getMcpToolDescriptors).mockResolvedValueOnce(
      discovery.descriptors.filter((descriptor) => descriptor.name === 'shell_exec'),
    );

    await expect(previewLocalSkillSource('/Users/me/.codex/skills/demo')).resolves.toMatchObject({
      skills: [expect.objectContaining({
        omittedFiles: [expect.any(Object)],
        importBlock: undefined,
      })],
    });
  });

  it('surfaces Shell discovery failures while checking on-demand resource support', async () => {
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createLocalSkillWithOnDemandResourceToolResult());
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(createShellDiscovery([], true, 'native host disconnected'));

    await expect(importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['SKILL.md'],
    })).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('native host disconnected'),
      importBlock: {
        code: 'shell_discovery_failed',
        detail: 'native host disconnected',
      },
    });
  });

  it('allows safe selections when a sibling Skill needs an unavailable reader', async () => {
    vi.mocked(executeMcpToolCall)
      .mockResolvedValueOnce(createMixedLocalSkillToolResult())
      .mockResolvedValueOnce(createSafeLocalSkillToolResult());
    vi.mocked(refreshMcpServerDiscovery).mockResolvedValueOnce(
      createShellDiscovery(['local_skill_preview', 'shell_exec']),
    );

    const preview = await previewLocalSkillSource('/Users/me/.codex/skills/demo');

    expect(preview.skills).toEqual([
      expect.objectContaining({
        path: 'SKILL.md',
        importName: 'demo-local',
        importBlock: {
          code: 'shell_host_update_required',
        },
      }),
      expect.objectContaining({
        path: 'safe/SKILL.md',
        importName: 'demo-local-2',
        importBlock: undefined,
      }),
    ]);

    const result = await importLocalSkillSource({
      rootPath: '/Users/me/.codex/skills/demo',
      selectedPaths: ['safe/SKILL.md'],
      selectedImportNames: {
        'safe/SKILL.md': preview.skills[1].importName,
      },
    });
    expectImportSuccess(result);

    expect(result.imported).toEqual([
      expect.objectContaining({ name: preview.skills[1].importName }),
    ]);
    expect(refreshMcpServerDiscovery).toHaveBeenCalledTimes(1);
    expect(executeMcpToolCall).toHaveBeenLastCalledWith(expect.objectContaining({
      payload: {
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['safe/SKILL.md'],
      },
    }));
  });

  it('imports a BOM-prefixed SKILL.md without losing the frontmatter name (issue #296)', async () => {
    // Editors on Windows commonly save SKILL.md with a UTF-8 BOM. Previously
    // the BOM defeated the `^---` frontmatter fence, `name:` was dropped, and
    // the importer threw "Local Skill is missing a valid name."
    const content = [
      '---',
      'name: ref-material-writing',
      'description: BOM-safe import',
      '---',
      '',
      '# 参考材料写作',
      '',
      'body',
    ].join('\n');
    vi.mocked(executeMcpToolCall).mockResolvedValueOnce({
      ok: true,
      summary: 'MCP tool executed',
      output: {
        ok: true,
        data: {
          rootPath: 'D:\\skills\\ref-material-writing',
          displayName: 'ref-material-writing',
          directoryName: 'ref-material-writing',
          warnings: [],
          truncated: false,
          skills: [
            {
              path: 'SKILL.md',
              directory: '',
              directoryPath: 'D:\\skills\\ref-material-writing',
              content: `\uFEFF${content}`,
              bodyBytes: content.length + 1,
              includedFiles: [],
              omittedFiles: [],
              scriptFiles: [],
              warnings: [],
            },
          ],
        },
      },
    });

    const result = await importLocalSkillSource({
      rootPath: 'D:\\skills\\ref-material-writing',
      selectedPaths: ['SKILL.md'],
    });
    expectImportSuccess(result);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].name).toBe('ref-material-writing');
  });

  it('rejects a local Skill with a missing ASCII name instead of silently slugifying (issue #296 / design S3 / R-NAME-REQUIRED)', async () => {
    // Regression guard for issue #296: the OLD lenient parser derived a stable
    // `skill-<hash>` slug when no ASCII `name` was available, silently importing
    // the Skill. The Phase 4 strict frontmatter contract (skill-import-design-rules.md
    // §四 / §八 Step 2.3, appendix A.2 default "报错阻断") REJECTS such documents and
    // surfaces the violation in the preview — it must NOT import a slugified fallback.
    const content = ['---', 'description: 中文 only', '---', '', '# 参考材料写作', '', 'body'].join('\n');
    vi.mocked(executeMcpToolCall).mockResolvedValue({
      ok: true,
      summary: 'MCP tool executed',
      output: {
        ok: true,
        data: {
          rootPath: 'D:\\写作助手',
          displayName: '写作助手',
          directoryName: '写作助手',
          warnings: [],
          truncated: false,
          skills: [
            {
              path: 'SKILL.md',
              directory: '',
              directoryPath: 'D:\\写作助手',
              content,
              bodyBytes: content.length,
              includedFiles: [],
              omittedFiles: [],
              scriptFiles: [],
              warnings: [],
            },
          ],
        },
      },
    });

    // The preview must surface the Skill as a validation failure (no silent slug import).
    const preview = await previewLocalSkillSource('D:\\写作助手');
    const skill = preview.skills.find((s: { path: string }) => s.path === 'SKILL.md');
    expect(skill).toBeDefined();
    expect(skill?.violations?.map((v: { ruleId: string }) => v.ruleId)).toContain('R-NAME-REQUIRED');

    // Importing the rejected Skill must not silently slugify it into an import.
    await expect(importLocalSkillSource({
      rootPath: 'D:\\写作助手',
      selectedPaths: ['SKILL.md'],
    })).rejects.toThrow();
  });

  describe('strict frontmatter contract (parseLocalSkillDoc)', () => {
    // Pure-logic coverage for the six hard-reject rules + boundary cases.
    // Every rule (R-FENCE / R-FIELD-INDENT / R-NAME-REQUIRED / R-DESC-REQUIRED /
    // R-NAME-CHARSET) must be asserted directly; the lenient shared parser is NOT used.
    const fm = (frontmatter: string, body = '# Body\n\nbody text'): string =>
      [`---`, frontmatter, `---`, ``, body].join('\n');

    const expectViolations = (result: ParseSkillDocResult, expected: string[]): void => {
      expect('ok' in result).toBe(true);
      if ('ok' in result) {
        const ruleIds = result.violations.map((v) => v.ruleId);
        for (const ruleId of expected) expect(ruleIds).toContain(ruleId);
      }
    };

    const expectSuccess = (result: ParseSkillDocResult, name: string, description?: string): void => {
      expect('ok' in result).toBe(false);
      if (!('ok' in result)) {
        expect(result.name).toBe(name);
        if (description !== undefined) expect(result.description).toBe(description);
      }
    };

    it('R-FENCE: rejects when the opening fence is missing', () => {
      expectViolations(parseLocalSkillDoc('name: x\ndescription: y\n\n# Body', 'SKILL.md'), ['R-FENCE']);
    });

    it('R-FENCE: rejects when the closing fence is missing', () => {
      expectViolations(parseLocalSkillDoc(['---', 'name: x', 'description: y'].join('\n'), 'SKILL.md'), ['R-FENCE']);
    });

    it('R-FENCE: rejects an indented (non-standalone) opening fence', () => {
      expectViolations(
        parseLocalSkillDoc(['  ---', 'name: x', 'description: y', '---'].join('\n'), 'SKILL.md'),
        ['R-FENCE'],
      );
    });

    it('R-FIELD-INDENT: rejects a leading-space field inside frontmatter', () => {
      expectViolations(parseLocalSkillDoc(fm('  name: my-skill\ndescription: test'), 'SKILL.md'), ['R-FIELD-INDENT']);
    });

    it('R-NAME-REQUIRED: rejects a document without a name field', () => {
      expectViolations(parseLocalSkillDoc(fm('description: test'), 'SKILL.md'), ['R-NAME-REQUIRED']);
    });

    it('R-DESC-REQUIRED: rejects a document without a description field', () => {
      expectViolations(parseLocalSkillDoc(fm('name: my-skill'), 'SKILL.md'), ['R-DESC-REQUIRED']);
    });

    it('R-NAME-CHARSET: rejects a non-ASCII (Chinese) name', () => {
      expectViolations(parseLocalSkillDoc(fm('name: 参考材料\ndescription: test'), 'SKILL.md'), ['R-NAME-CHARSET']);
    });

    it('R-NAME-REQUIRED: rejects an empty name value', () => {
      expectViolations(parseLocalSkillDoc(fm('name:\ndescription: test'), 'SKILL.md'), ['R-NAME-REQUIRED']);
    });

    it('accepts a valid directory-type document and normalizes the name', () => {
      expectSuccess(parseLocalSkillDoc(fm('name: My_Skill\ndescription: test'), 'SKILL.md'), 'my-skill', 'test');
    });

    it('L2 regression: trims surrounding whitespace before the charset gate (no false R-NAME-CHARSET)', () => {
      expectSuccess(parseLocalSkillDoc(fm('name: my-skill \ndescription: test'), 'SKILL.md'), 'my-skill');
    });

    it('tolerates a leading UTF-8 BOM on the frontmatter fence', () => {
      expectSuccess(parseLocalSkillDoc('\uFEFF' + fm('name: my-skill\ndescription: test'), 'SKILL.md'), 'my-skill');
    });
  });

  it('imports a single-file Skill (kind: file) with empty resources and a basename instruction', async () => {
    // Single-file-type Skill: discovered as a bare .md (not SKILL.md), carries no
    // bundled resources, and the import instructions reference the real file name.
    vi.mocked(executeMcpToolCall).mockResolvedValue(createStandaloneLocalSkillToolResult());

    const preview = await previewLocalSkillSource('D:\\standalone');
    const skill = preview.skills.find((s: { path: string }) => s.path === 'Standalone.md');
    expect(skill).toBeDefined();
    expect(skill?.kind).toBe('file');
    expect(skill?.includedFiles).toEqual([]);
    expect(skill?.violations).toBeUndefined();

    const result = await importLocalSkillSource({
      rootPath: 'D:\\standalone',
      selectedPaths: ['Standalone.md'],
    });
    expectImportSuccess(result);
    expect(result.imported).toHaveLength(1);
    const imported = result.imported[0]!;
    expect(imported.name).toBe('standalone');
    expect(imported.remote!.includedFiles).toEqual([]);
    expect(imported.instructions).toContain('standalone/Standalone.md');
    expect(imported.instructions).not.toContain('standalone/SKILL.md');
  });

  describe('relocateLocalSkillSource', () => {
    it('relocates a local Skill source to a renamed folder while preserving the source id', async () => {
      // 先正常导入，使 source 落盘（provider=local，id 由 rootPath 推导）。
      const imported = await importLocalSkillSource({
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['SKILL.md'],
      });
      expectImportSuccess(imported);
      const originalId = imported.source.id;
      expect(originalId).toBe('local:/Users/me/.codex/skills/demo');

      // 用户重新选择了改名后的文件夹。
      vi.mocked(executeMcpToolCall).mockResolvedValueOnce(
        createLocalSkillToolResultAt('/Users/me/.codex/skills/demo-renamed'),
      );

      const relocated = await relocateLocalSkillSource(originalId, '/Users/me/.codex/skills/demo-renamed');
      expect(relocated.ok).toBe(true);
      if (!relocated.ok) throw new Error(relocated.error);

      // 关键不变量：原地更新、保留原 source.id，激活引用 / 禁用状态 / 用户设置不断裂。
      expect(relocated.source.id).toBe(originalId);
      expect(relocated.source.rootPath).toBe('/Users/me/.codex/skills/demo-renamed');
      expect(relocated.source.displayName).toBe('demo-renamed');
      expect(relocated.source.skillPaths).toEqual(['SKILL.md']);
      expect(relocated.imported).toHaveLength(1);
      expect(relocated.imported[0].name).toBe('demo-local');
    });

    it('rejects an empty source id or empty new root path before touching storage', async () => {
      await expect(relocateLocalSkillSource('', '/Users/me/.codex/skills/demo'))
        .rejects.toThrow('Local Skill source id must be a non-empty string.');
      await expect(relocateLocalSkillSource('local:/x', ''))
        .rejects.toThrow('New root path must be a non-empty string.');
      await expect(relocateLocalSkillSource('local:/x', '   '))
        .rejects.toThrow('New root path must be a non-empty string.');
    });

    it('throws when the source id does not exist', async () => {
      await expect(
        relocateLocalSkillSource('local:does-not-exist', '/Users/me/.codex/skills/demo'),
      ).rejects.toThrow('Local Skill source was not found');
    });

    it('throws when the relocated folder no longer contains the selected Skill paths', async () => {
      const imported = await importLocalSkillSource({
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['SKILL.md'],
      });
      expectImportSuccess(imported);

      // 新文件夹里只有 nested/SKILL.md，没有原来选中的 SKILL.md。
      vi.mocked(executeMcpToolCall).mockResolvedValueOnce(createNestedLocalSkillToolResult());

      await expect(
        relocateLocalSkillSource(imported.source.id, '/Users/me/.codex/skills/moved'),
      ).rejects.toThrow('Selected local Skill paths were not found: SKILL.md');
    });
  });

  describe('updateLocalSkillSource', () => {
    it('returns ok:false (not throw) when the original folder is gone, so the UI can offer relocation', async () => {
      const imported = await importLocalSkillSource({
        rootPath: '/Users/me/.codex/skills/demo',
        selectedPaths: ['SKILL.md'],
      });
      expectImportSuccess(imported);

      // 原文件夹被挪动：preview 返回空 skills → loadLocalSkillSource 抛 "No SKILL.md was found"。
      vi.mocked(executeMcpToolCall).mockResolvedValueOnce({
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
            skills: [],
          },
        },
      });

      // 关键：不抛异常，返回 ok:false，使 UI 进入 !response.ok 分支触发 relocate。
      await expect(updateLocalSkillSource(imported.source.id)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('No SKILL.md was found'),
      });
    });

    it('throws on a non-existent source id (unchanged contract)', async () => {
      await expect(updateLocalSkillSource('local:does-not-exist'))
        .rejects.toThrow('Local Skill source was not found');
    });

    it('re-imports a single-file Skill (kind: file) on update and references the real definition file name', async () => {
      // 更新路径复用 importLocalSkillSource，因此同样受益 PR #550 的 basename 去硬编码修复：
      // 单文件型 Skill 在「更新」重扫后，指令应引用真实定义文件名 standalone/Standalone.md，
      // 而非硬编码 SKILL.md。
      vi.mocked(executeMcpToolCall).mockResolvedValue(createStandaloneLocalSkillToolResult());

      const imported = await importLocalSkillSource({
        rootPath: 'D:\\standalone',
        selectedPaths: ['Standalone.md'],
      });
      expectImportSuccess(imported);
      const originalId = imported.source.id;
      expect(originalId).toBe('local:D:\\standalone');

      // 更新路径：复用 importLocalSkillSource 重新扫描原 rootPath + skillPaths。
      const updated = await updateLocalSkillSource(originalId);
      expectImportSuccess(updated);
      const updatedSkill = updated.imported[0]!;
      expect(updatedSkill.name).toBe('standalone');
      expect(updatedSkill.remote!.includedFiles).toEqual([]);
      expect(updatedSkill.instructions).toContain('standalone/Standalone.md');
      expect(updatedSkill.instructions).not.toContain('standalone/SKILL.md');
    });
  });
});

function expectImportSuccess(
  response: LocalSkillImportResponse,
): asserts response is LocalSkillImportResult {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(response.error);
}

function createShellServer(toolNames: string[]): McpServerConfig {
  return {
    id: 'shell-local',
    displayName: SHELL_MCP_SERVER_NAME,
    enabled: true,
    transport: { kind: 'native_messaging' as const, nativeHost: SHELL_MCP_NATIVE_HOST },
    execution: { enabled: true, mode: 'auto' as const },
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

function createLocalSkillToolResultAt(rootPath: string) {
  const result = createLocalSkillToolResult();
  const skill = result.output.data.skills[0];
  return {
    ...result,
    output: {
      ...result.output,
      data: {
        ...result.output.data,
        rootPath,
        displayName: 'demo-renamed',
        directoryName: 'demo-renamed',
        skills: [{
          ...skill,
          directory: '',
          directoryPath: rootPath,
          content: skill.content,
        }],
      },
    },
  };
}

function createStandaloneLocalSkillToolResult() {
  const content = ['---', 'name: standalone', 'description: A standalone skill', '---', '', '# Standalone', '', 'body'].join('\n');
  return {
    ok: true,
    summary: 'MCP tool executed',
    output: {
      ok: true,
      data: {
        rootPath: 'D:\\standalone',
        displayName: 'standalone',
        directoryName: 'standalone',
        warnings: [],
        truncated: false,
        skills: [
          {
            path: 'Standalone.md',
            directory: '',
            directoryPath: 'D:\\standalone',
            content,
            bodyBytes: content.length,
            includedFiles: [],
            omittedFiles: [],
            scriptFiles: [],
            warnings: [],
          },
        ],
      },
    },
  };
}

function createNestedLocalSkillToolResult() {
  const content = [
    '---',
    'name: nested-local',
    'description: Nested local Skill',
    '---',
    '',
    '# Nested',
    '',
    'Use references/child.md and scripts/run.py.',
  ].join('\n');

  return {
    ok: true,
    summary: 'MCP tool executed',
    output: {
      ok: true,
      data: {
        rootPath: '/Users/me/.codex/skills',
        displayName: 'skills',
        directoryName: 'skills',
        warnings: [],
        truncated: false,
        skills: [
          {
            path: 'nested/SKILL.md',
            directory: 'nested',
            directoryPath: '/Users/me/.codex/skills/nested',
            content,
            bodyBytes: content.length,
            includedFiles: [
              {
                path: 'nested/references/child.md',
                bytes: 11,
                content: 'Child guide.',
              },
            ],
            omittedFiles: [],
            scriptFiles: [{ path: 'nested/scripts/run.py', bytes: 15 }],
            warnings: [],
          },
        ],
      },
    },
  };
}

function createLocalSkillWithOnDemandResourceToolResult() {
  const result = createLocalSkillToolResult();
  return {
    ...result,
    output: {
      ...result.output,
      data: {
        ...result.output.data,
        skills: [{
          ...result.output.data.skills[0],
          omittedFiles: [{
            path: 'references/extended-guide.md',
            bytes: 2048,
          }],
        }],
      },
    },
  };
}

function createMixedLocalSkillToolResult() {
  const result = createLocalSkillWithOnDemandResourceToolResult();
  const safeContent = [
    '---',
    'name: demo-local',
    'description: Safe local Skill',
    '---',
    '',
    '# Safe',
  ].join('\n');
  return {
    ...result,
    output: {
      ...result.output,
      data: {
        ...result.output.data,
        skills: [
          ...result.output.data.skills,
          {
            path: 'safe/SKILL.md',
            directory: 'safe',
            directoryPath: '/Users/me/.codex/skills/demo/safe',
            content: safeContent,
            bodyBytes: safeContent.length,
            includedFiles: [],
            omittedFiles: [],
            scriptFiles: [],
            warnings: [],
          },
        ],
      },
    },
  };
}

function createSafeLocalSkillToolResult() {
  const result = createMixedLocalSkillToolResult();
  return {
    ...result,
    output: {
      ...result.output,
      data: {
        ...result.output.data,
        skills: result.output.data.skills.filter((skill) => skill.path === 'safe/SKILL.md'),
      },
    },
  };
}

function createShellDiscovery(
  toolNames: string[],
  enabled = true,
  error: string | null = null,
  mode: 'auto' | 'disabled' = 'auto',
): McpToolCacheEntry {
  const now = Date.now();
  return {
    serverId: 'shell-local',
    descriptors: toolNames.map((name) => ({
      id: `mcp:shell-local:${name}`,
      provider: {
        kind: 'mcp' as const,
        id: 'shell-local',
        displayName: SHELL_MCP_SERVER_NAME,
        transport: 'native_messaging' as const,
      },
      name,
      invocationName: name,
      title: name,
      description: name,
      inputSchema: { type: 'object', properties: {} },
      execution: {
        enabled,
        mode,
        risk: 'low' as const,
      },
    })),
    refreshedAt: now,
    expiresAt: now + 60_000,
    health: {
      serverId: 'shell-local',
      status: error ? 'error' : 'ready',
      checkedAt: now,
      latencyMs: 1,
      toolCount: toolNames.length,
      error,
    },
  };
}
