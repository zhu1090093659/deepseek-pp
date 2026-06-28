import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOL_DESCRIPTORS } from '../core/tool';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { buildPromptAugmentation } from '../core/prompt';

describe('augmentRequestBody', () => {
  it('applies expert mode and advances request message count without exposing state to main-world', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'hello',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'expert',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 0,
    });

    expect(result?.messageCount).toBe(1);
    expect(JSON.parse(result?.body ?? '{}').model_type).toBe('expert');
    expect(result?.usedMemoryIds).toEqual([]);
  });

  it('applies vision mode while preserving official file references', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'describe this image',
      parent_message_id: 12,
      thinking_enabled: false,
      ref_file_ids: ['file-image-1'],
    }), {
      memories: [],
      skills: [],
      activePreset: null,
      modelType: 'vision',
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      messageCount: 2,
    });

    const body = JSON.parse(result?.body ?? '{}');
    expect(result?.messageCount).toBe(3);
    expect(body.model_type).toBe('vision');
    expect(body.ref_file_ids).toEqual(['file-image-1']);
  });

  it('emits English prompt scaffolding while keeping XML tool tags stable', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'en',
    });

    expect(result.augmented).toContain('## Role');
    expect(result.augmented).toContain('(No memories yet)');
    expect(result.augmented).toContain('Use web_search for real-time info');
    expect(result.augmented).toContain('Available tools: memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).toContain('</memory_save>');
    expect(result.augmented).not.toContain('Invalid formats: <invoke name="memory_save">');
    expect(result.augmented).not.toContain('## 角色');
  });

  it('uses locale-aware default tool descriptors when none are provided', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      locale: 'en',
    });

    expect(result.augmented).toContain('Save memory');
    expect(result.augmented).toContain('Save a new long-term memory');
    expect(result.augmented).not.toContain('Parameters JSON Schema');
    expect(result.augmented).not.toContain('Title: 保存记忆');
  });

  it('keeps project context after base system scaffolding and before web-search guidance', () => {
    const result = buildPromptAugmentation('where is the Android entry point?', {
      memories: [],
      presetContent: 'You are a repo-aware assistant.',
      projectContext: '## Project Context\nProject: DeepSeek++\n--- android/MainActivity.kt:1-2 ---',
      locale: 'en',
    });

    const presetIndex = result.augmented.indexOf('You are a repo-aware assistant.');
    const roleIndex = result.augmented.indexOf('## Role');
    const projectIndex = result.augmented.indexOf('## Project Context');
    const webSearchIndex = result.augmented.indexOf('Use web_search for real-time info');
    const visibleUserIndex = result.augmented.indexOf('where is the Android entry point?');

    expect(presetIndex).toBeGreaterThanOrEqual(0);
    expect(roleIndex).toBeGreaterThan(presetIndex);
    expect(projectIndex).toBeGreaterThan(roleIndex);
    expect(webSearchIndex).toBeGreaterThan(projectIndex);
    expect(visibleUserIndex).toBeGreaterThan(webSearchIndex);
  });

  it('keeps Chinese prompt scaffolding available under zh-CN', () => {
    const result = buildPromptAugmentation('搜索 DeepSeek 新闻', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'zh-CN',
    });

    expect(result.augmented).toContain('## 角色');
    expect(result.augmented).toContain('(暂无记忆)');
    expect(result.augmented).toContain('实时信息、新闻、不确定的知识');
    expect(result.augmented).toContain('可用工具：memory_save');
    expect(result.augmented).toContain('<memory_save>');
    expect(result.augmented).not.toContain('## Role');
  });

  it('honors prompt controls for memory, system prompt, and forced language', () => {
    const withoutMemory = buildPromptAugmentation('remember nothing here', {
      memories: [{
        id: 1,
        syncId: 'sync-1',
        scope: 'global',
        type: 'reference',
        name: 'Hidden memory',
        content: 'Do not include me',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      memoryEnabled: false,
      locale: 'en',
    });
    expect(withoutMemory.usedMemoryIds).toEqual([]);
    expect(withoutMemory.augmented).toContain('(Memory injection disabled for this request)');
    expect(withoutMemory.augmented).not.toContain('Do not include me');

    const withoutSystemPrompt = buildPromptAugmentation('plain prompt', {
      memories: [],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(withoutSystemPrompt.renderedToolCount).toBe(0);
    expect(withoutSystemPrompt.augmented).not.toContain('## Role');
    expect(withoutSystemPrompt.augmented).toContain('plain prompt');

    const memoryOnly = buildPromptAugmentation('remember durable facts', {
      memories: [{
        id: 2,
        syncId: 'sync-2',
        scope: 'global',
        type: 'reference',
        name: 'Durable memory',
        content: 'Inject me without the full system prompt',
        description: '',
        tags: [],
        pinned: false,
        createdAt: 1,
        updatedAt: 1,
        accessCount: 0,
        lastAccessedAt: 1,
      }],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(memoryOnly.usedMemoryIds).toEqual([2]);
    expect(memoryOnly.augmented).toContain('## Existing Memories');
    expect(memoryOnly.augmented).toContain('Inject me without the full system prompt');
    expect(memoryOnly.augmented).not.toContain('## Role');

    const forcedLanguage = buildPromptAugmentation('reply', {
      memories: [],
      forceResponseLanguage: 'en',
      locale: 'zh-CN',
    });
    expect(forcedLanguage.augmented).toContain('## 回复语言');
    expect(forcedLanguage.augmented).toContain('请使用英文回复。');
  });

  it('localizes skill user-input wrapper without mutating the user input', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: '/writer Draft about {raw_user_value}',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [],
      skills: [{
        name: 'writer',
        instructions: 'Write clearly.',
        memoryEnabled: false,
      }],
      activePreset: null,
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('The following is the user input for this turn');
    expect(body.prompt).toContain('Draft about {raw_user_value}');
  });

  it('injects only global memories plus memories from the current project', () => {
    const result = augmentRequestBody(JSON.stringify({
      prompt: 'remember the project rule',
      parent_message_id: null,
      thinking_enabled: false,
    }), {
      memories: [
        memory(1, 'global', undefined, 'Global memory', 'Always be concise.'),
        memory(2, 'project', 'project-1', 'Project memory', 'Use project glossary.'),
        memory(3, 'project', 'project-2', 'Other project memory', 'Do not include me.'),
      ],
      skills: [],
      activePreset: null,
      projectId: 'project-1',
      modelType: null,
      toolDescriptors: [],
      messageCount: 0,
      locale: 'en',
    });

    const body = JSON.parse(result?.body ?? '{}') as { prompt?: string };
    expect(body.prompt).toContain('Always be concise.');
    expect(body.prompt).toContain('[project reference] Project memory');
    expect(body.prompt).not.toContain('Do not include me.');
  });
});

function memory(
  id: number,
  scope: 'global' | 'project',
  projectId: string | undefined,
  name: string,
  content: string,
) {
  return {
    id,
    syncId: `sync-${id}`,
    scope,
    projectId,
    type: 'reference' as const,
    name,
    content,
    description: '',
    tags: [],
    pinned: true,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
