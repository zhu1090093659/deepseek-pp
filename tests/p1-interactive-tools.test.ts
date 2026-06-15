import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewMemoryImport } from '../core/memory/importer';
import {
  createArtifactToolDescriptors,
  createMemoryImportToolDescriptors,
  createMemoryToolDescriptors,
  createSkillCreatorToolDescriptors,
  createSkillDraft,
} from '../core/tool';
import {
  createSandboxToolDescriptors,
  executeSandboxToolCall,
  normalizeSandboxRunRequest,
} from '../core/sandbox';
import { filterSidepanelChatToolDescriptors } from '../core/tool/sidepanel';
import {
  getPromptInjectionSettings,
  savePromptInjectionSettings,
  shouldInjectPresetForTurn,
} from '../core/prompt/settings';
import {
  detectVoiceCapabilities,
  getVoiceSettings,
  saveVoiceSettings,
} from '../core/voice/settings';
import {
  getSavedItemsState,
  saveSavedItem,
} from '../core/saved-items';
import type { Memory, ToolCall } from '../core/types';

let storage: Record<string, unknown>;

beforeEach(() => {
  storage = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          storage = { ...storage, ...values };
        }),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('P1 interactive tool contracts', () => {
  it('executes sandbox calls through the injected browser runtime', async () => {
    const descriptor = createSandboxToolDescriptors('en')[0];
    expect(descriptor.execution.mode).toBe('auto');
    expect(descriptor.execution.risk).toBe('high');

    const seenRequests: unknown[] = [];
    const result = await executeSandboxToolCall({
      async runSandbox(request) {
        seenRequests.push(request);
        return {
          ok: true,
          summary: 'Sandbox executed',
          detail: '42',
          output: {
            ok: true,
            stdout: '',
            stderr: '',
            result: '42',
            durationMs: 7,
            truncated: false,
            error: '',
          },
        };
      },
    }, toolCall('sandbox_run', {
      language: 'javascript',
      code: 'return 42;',
      timeoutMs: 500,
    }), 'en');

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Sandbox executed');
    expect(result.detail).toBe('42');
    expect(result.name).toBe('sandbox_run');
    expect(result.output).toMatchObject({
      ok: true,
      result: '42',
    });
    expect(seenRequests).toEqual([{
      language: 'javascript',
      code: 'return 42;',
      input: undefined,
      timeoutMs: 1000,
    }]);
  });

  it('normalizes sandbox requests with explicit size and timeout boundaries', () => {
    expect(normalizeSandboxRunRequest({
      language: 'typescript',
      code: 'const answer: number = 42;',
      timeoutMs: 60_000,
    }).timeoutMs).toBe(15_000);
    expect(normalizeSandboxRunRequest({
      language: 'python',
      code: 'print(42)',
    }).timeoutMs).toBe(15_000);
    expect(normalizeSandboxRunRequest({
      language: 'html',
      code: '<h1>Hello</h1>',
    }).language).toBe('html');

    expect(() => normalizeSandboxRunRequest({
      language: 'ruby',
      code: 'puts 1',
    })).toThrow('language must be javascript, typescript, python, or html');
  });

  it('keeps review-card tools out of sidepanel chat descriptors while artifact handles runnable outputs', () => {
    const descriptors = [
      ...createMemoryToolDescriptors('en'),
      ...createArtifactToolDescriptors('en'),
      ...createSkillCreatorToolDescriptors('en'),
      ...createMemoryImportToolDescriptors('en'),
    ];

    const sidepanelNames = filterSidepanelChatToolDescriptors(descriptors)
      .map((descriptor) => descriptor.name);

    expect(sidepanelNames).toContain('memory_save');
    expect(sidepanelNames).toContain('artifact_create');
    expect(sidepanelNames).not.toContain('sandbox_run');
    expect(sidepanelNames).not.toContain('skill_draft_create');
    expect(sidepanelNames).not.toContain('memory_import_preview');
  });

  it('creates Skill drafts for review-before-save and validates useful instructions', () => {
    const draft = createSkillDraft({
      name: 'My Skill!',
      description: 'Use when drafting release notes.',
      instructions: 'Write concise release notes with user-facing language and no implementation leakage.',
      memoryEnabled: true,
    });

    expect(draft.kind).toBe('skill_draft');
    expect(draft.draft.name).toBe('my-skill');
    expect(draft.draft.metadata?.createdBy).toBe('skill_draft_create');
    expect(() => createSkillDraft({
      name: 'bad',
      description: 'Too short',
      instructions: 'short',
    })).toThrow('instructions must be at least 40 characters');
  });

  it('previews memory imports with per-item rejection and dedupe', () => {
    const preview = previewMemoryImport({
      content: JSON.stringify({
        memories: [
          { name: 'Good', content: 'Keep this durable fact', type: 'topic' },
          { name: 'Duplicate', content: 'Already stored' },
          { name: 'Empty', content: '   ' },
          'not an object',
        ],
      }),
      defaultType: 'reference',
      tags: ['imported'],
      existingMemories: [storedMemory('Already stored')],
    });

    expect(preview.memories).toHaveLength(1);
    expect(preview.memories[0]).toMatchObject({
      name: 'Good',
      content: 'Keep this durable fact',
      type: 'topic',
      tags: ['imported'],
    });
    expect(preview.duplicates).toBe(1);
    expect(preview.rejected).toBe(2);
  });

  it('merges partial prompt-control saves instead of resetting unrelated settings', async () => {
    await savePromptInjectionSettings({
      memoryEnabled: false,
      presetCadence: 'every_message',
    });
    const saved = await savePromptInjectionSettings({ forceResponseLanguage: 'en' });

    expect(saved).toEqual({
      memoryEnabled: false,
      systemPromptEnabled: true,
      presetCadence: 'every_message',
      forceResponseLanguage: 'en',
    });
    expect(await getPromptInjectionSettings()).toEqual(saved);
  });

  it('applies preset cadence decisions explicitly', () => {
    expect(shouldInjectPresetForTurn({
      hasActivePreset: true,
      isFirstMessage: false,
      messageCount: 10,
      cadence: 'off',
    })).toBe(false);
    expect(shouldInjectPresetForTurn({
      hasActivePreset: true,
      isFirstMessage: false,
      messageCount: 2,
      cadence: 'every_message',
    })).toBe(true);
  });

  it('merges partial voice saves and detects browser voice capabilities', async () => {
    await saveVoiceSettings({ inputEnabled: true, rate: 1.5 });
    const saved = await saveVoiceSettings({ readAloudEnabled: true });

    expect(saved).toEqual({
      inputEnabled: true,
      readAloudEnabled: true,
      rate: 1.5,
      pitch: 1,
    });
    expect(await getVoiceSettings()).toEqual(saved);
    expect(detectVoiceCapabilities({
      SpeechRecognition: function SpeechRecognition() {},
      speechSynthesis: {},
    })).toEqual({
      speechRecognition: true,
      speechSynthesis: true,
    });
  });

  it('persists saved snippets without mutating the original content', async () => {
    const saved = await saveSavedItem({
      id: 'saved-1',
      syncId: 'sync-1',
      kind: 'snippet',
      title: 'Reusable ask',
      content: 'Summarize this thread.',
      tags: ['prompt', 'prompt'],
      createdAt: 100,
    });

    expect(saved.content).toBe('Summarize this thread.');
    expect(saved.tags).toEqual(['prompt']);
    expect((await getSavedItemsState()).items).toHaveLength(1);
  });
});

function toolCall(name: string, payload: Record<string, unknown>): ToolCall {
  return {
    name,
    payload,
    raw: `<${name}>`,
  };
}

function storedMemory(content: string): Memory {
  return {
    id: 1,
    syncId: 'sync-1',
    scope: 'global',
    type: 'reference',
    name: 'Existing',
    content,
    description: '',
    tags: [],
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    lastAccessedAt: 1,
  };
}
