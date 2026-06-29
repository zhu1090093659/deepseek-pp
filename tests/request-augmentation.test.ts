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

  it('emits English prompt scaffolding with identity, tool rules, and scenario guidance', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'en',
    });

    expect(result.augmented).toContain('You are DeepSeek++');
    expect(result.augmented).toContain('Tool Call Format');
    expect(result.augmented).toContain('Output Style');
    expect(result.augmented).toContain('search latest DeepSeek news');
    expect(result.augmented).not.toContain('## 角色');
  });

  it('uses locale-aware default tool descriptors when none are provided', () => {
    const result = buildPromptAugmentation('search latest DeepSeek news', {
      memories: [],
      locale: 'en',
    });

    expect(result.augmented).toContain('search latest DeepSeek news');
    expect(result.augmented).toContain('You are DeepSeek++');
    expect(result.augmented).toContain('Call tools with XML tags');
  });

  it('keeps project context after base system scaffolding and before user prompt', () => {
    const result = buildPromptAugmentation('where is the Android entry point?', {
      memories: [],
      presetContent: 'You are a repo-aware assistant.',
      projectContext: '## Project Context\nProject: DeepSeek++\n--- android/MainActivity.kt:1-2 ---',
      locale: 'en',
    });

    expect(result.augmented).toContain('You are a repo-aware assistant.');
    expect(result.augmented).toContain('You are DeepSeek++');
    expect(result.augmented).toContain('## Project Context');
    expect(result.augmented).toContain('where is the Android entry point?');
  });

  it('keeps Chinese prompt scaffolding available under zh-CN', () => {
    const result = buildPromptAugmentation('搜索 DeepSeek 新闻', {
      memories: [],
      toolDescriptors: DEFAULT_TOOL_DESCRIPTORS,
      locale: 'zh-CN',
    });

    expect(result.augmented).toContain('搜索 DeepSeek 新闻');
    expect(result.augmented).toContain('You are DeepSeek++');
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
    expect(withoutMemory.augmented).not.toContain('Do not include me');
    expect(withoutMemory.augmented).toContain('remember nothing here');

    const withoutSystemPrompt = buildPromptAugmentation('plain prompt', {
      memories: [],
      systemPromptEnabled: false,
      locale: 'en',
    });
    expect(withoutSystemPrompt.augmented).not.toContain('You are DeepSeek++');
    expect(withoutSystemPrompt.augmented).toContain('plain prompt');

    const forceChinese = buildPromptAugmentation('hello', {
      memories: [],
      systemPromptEnabled: true,
      forceResponseLanguage: 'zh-CN',
      locale: 'en',
    });
    expect(forceChinese.augmented).toContain('Respond in Chinese');
    expect(forceChinese.augmented).not.toContain('Respond in English');
  });
});
