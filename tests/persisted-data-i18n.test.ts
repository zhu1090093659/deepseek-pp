import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomation, getAllAutomations } from '../core/automation/store';
import { createMcpServer, getAllMcpServers } from '../core/mcp/store';
import { savePreset, getAllPresets } from '../core/preset/store';
import { addCustomScenario, getAllScenarios } from '../core/scenario/store';
import { getAllSkills, replaceAllCustomSkills } from '../core/skill/registry';
import {
  parseValidatedArray,
  validateStoredMemory,
} from '../core/sync/schema';
import { decodePreset as validatePreset } from '../core/preset/codec';
import {
  decodeGitHubSkillSource as validateGitHubSkillSource,
  decodeSkill as validateSkill,
  decodeSkillImportSource as validateSkillImportSource,
} from '../core/skill/codec';
import type { GitHubSkillSource, LocalSkillSource, Memory, Skill, SystemPromptPreset } from '../core/types';
import {
  fetchBundledSkillAsset,
  getBundledSkillAssetUrl,
} from './helpers/bundled-skill-assets';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('fetch', fetchBundledSkillAsset);
  vi.stubGlobal('chrome', {
    runtime: {
      getURL: getBundledSkillAssetUrl,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string | string[] | null | undefined) => {
          if (typeof key === 'string') return { [key]: storage[key] };
          if (Array.isArray(key)) {
            return Object.fromEntries(key.map((item) => [item, storage[item]]));
          }
          return { ...storage };
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persisted user data i18n boundaries', () => {
  it('keeps custom and remote skills unchanged while builtin skills are locale-projected', async () => {
    const customText = '自定义 Skill: keep https://example.com/路径 and command npm run 构建';
    const customSkill: Skill = {
      name: 'custom-guard',
      description: customText,
      instructions: `${customText}\nDo not translate this.`,
      source: 'custom',
      memoryEnabled: false,
      enabled: true,
    };
    const remoteSkill: Skill = {
      name: 'remote-guard',
      description: '远端原文 description',
      instructions: 'Remote 原始指令 with /usr/local/bin/tool --flag=中文',
      source: 'remote',
      memoryEnabled: true,
      enabled: true,
    };

    await replaceAllCustomSkills([customSkill, remoteSkill]);

    const english = await getAllSkills({ includeDisabled: true, locale: 'en' });
    const chinese = await getAllSkills({ includeDisabled: true, locale: 'zh-CN' });
    const englishCustom = english.find((skill) => skill.name === customSkill.name);
    const chineseCustom = chinese.find((skill) => skill.name === customSkill.name);
    const englishRemote = english.find((skill) => skill.name === remoteSkill.name);
    const chineseRemote = chinese.find((skill) => skill.name === remoteSkill.name);

    expect(english.find((skill) => skill.name === 'shell')?.description).toContain('Local command-line assistant');
    expect(chinese.find((skill) => skill.name === 'shell')?.description).toContain('本地命令行助手');
    expect(englishCustom?.description).toBe(customSkill.description);
    expect(chineseCustom?.description).toBe(customSkill.description);
    expect(englishCustom?.instructions).toBe(customSkill.instructions);
    expect(chineseCustom?.instructions).toBe(customSkill.instructions);
    expect(englishRemote?.description).toBe(remoteSkill.description);
    expect(chineseRemote?.description).toBe(remoteSkill.description);
    expect(englishRemote?.instructions).toBe(remoteSkill.instructions);
    expect(chineseRemote?.instructions).toBe(remoteSkill.instructions);
  });

  it('keeps presets, scenarios, automation prompts, MCP URLs, and commands as authored', async () => {
    const preservedText = '保留原文 https://example.com?q=中文 && npm run 构建 -- --target=Edge';
    const preset: SystemPromptPreset = {
      id: 'preset-guard',
      name: '双语 preset',
      content: preservedText,
      createdAt: 1,
      updatedAt: 2,
    };

    await savePreset(preset);
    const scenario = await addCustomScenario('自定义场景', `请处理：${preservedText}\n{text}`);
    const automation = await createAutomation({
      name: '自动化任务',
      prompt: `Automation prompt should stay raw: ${preservedText}`,
      schedule: {
        kind: 'manual',
        expression: null,
        timezone: 'Asia/Shanghai',
        enabled: false,
        minimumIntervalMinutes: 60,
      },
      promptOptions: {
        modelType: null,
        searchEnabled: true,
        thinkingEnabled: false,
        refFileIds: ['file-中文'],
      },
    });
    await createMcpServer({
      displayName: 'Shell Local 中文',
      transport: {
        kind: 'streamable_http',
        url: 'https://example.com/mcp?token=中文',
      },
      headers: [{ name: 'X-Command', value: 'npm run 构建' }],
      secrets: [{ kind: 'bearer', value: 'Bearer 中文-secret' }],
    });

    expect((await getAllPresets())[0]).toEqual(preset);
    expect((await getAllScenarios()).find((item) => item.id === scenario.id)?.template)
      .toBe(`请处理：${preservedText}\n{text}`);
    expect((await getAllAutomations()).find((item) => item.id === automation.id)?.prompt)
      .toBe(`Automation prompt should stay raw: ${preservedText}`);

    const [mcpServer] = await getAllMcpServers({ includeSecrets: true });
    expect(mcpServer.displayName).toBe('Shell Local 中文');
    expect(mcpServer.transport.kind).toBe('streamable_http');
    expect(mcpServer.transport.url).toBe('https://example.com/mcp?token=中文');
    expect(mcpServer.headers[0].value).toBe('npm run 构建');
    expect(mcpServer.secrets[0].value).toBe('Bearer 中文-secret');
  });

  it('keeps WebDAV sync payload validation data-only and locale-independent', () => {
    const memory: Omit<Memory, 'id'> = {
      syncId: 'sync-中文',
      scope: 'global',
      type: 'reference',
      name: '原始标题',
      content: 'Do not translate https://example.com/中文',
      description: '原始描述',
      tags: ['中文', 'URL:https://example.com'],
      pinned: true,
      createdAt: 1,
      updatedAt: 2,
      accessCount: 3,
      lastAccessedAt: 4,
    };
    const skill: Skill = {
      name: 'remote-original',
      description: '远端描述',
      instructions: 'Keep command: officecli view "D:\\\\文档\\\\a.docx"',
      source: 'third-party',
      memoryEnabled: false,
      enabled: false,
      metadata: { provider: 'iOfficeAI/OfficeCLI' },
    };
    const preset: SystemPromptPreset = {
      id: 'preset-sync',
      name: '原文 preset',
      content: 'Raw prompt / 保持原文',
      createdAt: 1,
      updatedAt: 2,
    };
    const source: GitHubSkillSource = {
      id: 'source-1',
      provider: 'github',
      url: 'https://github.com/example/skills/tree/main/中文',
      owner: 'example',
      repo: 'skills',
      repository: 'example/skills',
      ref: 'main',
      rootPath: '中文',
      commitSha: 'abc123',
      defaultBranch: 'main',
      repoUrl: 'https://github.com/example/skills',
      skillPaths: ['中文/SKILL.md'],
      importedSkillNames: ['remote-original'],
      importedAt: 1,
      updatedAt: 2,
      description: '上游描述',
    };
    const localSource: LocalSkillSource = {
      id: 'local:/Users/me/.codex/skills/demo',
      provider: 'local',
      rootPath: '/Users/me/.codex/skills/demo',
      displayName: 'demo',
      directoryName: 'demo',
      skillPaths: ['SKILL.md'],
      importedSkillNames: ['demo'],
      importedAt: 1,
      updatedAt: 2,
      warnings: ['保留本地路径'],
    };

    expect(parseValidatedArray('memories.json', JSON.stringify([memory]), validateStoredMemory)[0]).toEqual(memory);
    expect(parseValidatedArray('skills.json', JSON.stringify([skill]), validateSkill)[0]).toEqual(skill);
    expect(parseValidatedArray('presets.json', JSON.stringify([preset]), validatePreset)[0]).toEqual(preset);
    expect(parseValidatedArray('skill-sources.json', JSON.stringify([source]), validateGitHubSkillSource)[0])
      .toEqual(source);
    expect(parseValidatedArray('skill-sources.json', JSON.stringify([localSource]), validateSkillImportSource)[0])
      .toEqual(localSource);
  });

  it('accepts a GitHub source imported from the repository root (empty rootPath)', () => {
    // Regression for https://github.com/zhu1090093659/deepseek-pp/issues/250
    // Importing from a bare repo URL (no sub-path) stores rootPath as "".
    // The download validation must accept it, not reject it as a non-empty string.
    const repoRootSource: GitHubSkillSource = {
      id: 'github:example/skills:main:.',
      provider: 'github',
      url: 'https://github.com/example/skills',
      owner: 'example',
      repo: 'skills',
      repository: 'example/skills',
      ref: 'main',
      rootPath: '',
      commitSha: 'abc123',
      defaultBranch: 'main',
      repoUrl: 'https://github.com/example/skills',
      skillPaths: ['SKILL.md'],
      importedSkillNames: ['demo'],
      importedAt: 1,
      updatedAt: 2,
    };

    expect(validateGitHubSkillSource(repoRootSource)).toEqual(repoRootSource);
    expect(validateSkillImportSource(repoRootSource)).toEqual(repoRootSource);
    expect(parseValidatedArray('skill-sources.json', JSON.stringify([repoRootSource]), validateSkillImportSource)[0])
      .toEqual(repoRootSource);
  });
});
