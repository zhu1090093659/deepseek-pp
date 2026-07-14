import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeMessageContext } from '../core/messaging/runtime-boundary';
import { PERSISTENCE_RUNTIME_PAYLOAD_DECODERS } from '../core/messaging/persistence-runtime-request-codec';
import { RUNTIME_COMMAND_CONTRACTS } from '../core/messaging/runtime-command-contracts';
import {
  createRuntimeCommandRegistry,
  definePayloadlessRuntimeCommandHandler,
  getRuntimeCommandOwner,
  TYPED_RUNTIME_COMMAND_TYPES,
  type RuntimeCommandHandler,
} from '../core/messaging/runtime-command-registry';
import type {
  ArtifactRecord,
  BackgroundConfig,
  GitHubSkillImportResult,
  GitHubSkillPreview,
  GitHubSkillUpdatePreview,
  LocalSkillImportResponse,
  LocalSkillPreview,
  Memory,
  PetConfig,
  ProjectContext,
  ProjectContextState,
  ProjectConversation,
  SavedItem,
  Skill,
  SystemPromptPreset,
} from '../core/types';
import {
  createLibraryRuntimeHandlers,
  type LibraryRuntimeHandlerDependencies,
} from '../entrypoints/background/library-handlers';
import {
  createLocalPreferenceRuntimeHandlers,
  type LocalPreferenceRuntimeHandlerDependencies,
} from '../entrypoints/background/local-preference-handlers';
import {
  createMemoryRuntimeHandlers,
  type MemoryRuntimeHandlerDependencies,
} from '../entrypoints/background/memory-handlers';
import { createPersistenceRuntimeHandlers } from '../entrypoints/background/persistence-handlers';
import {
  createProjectRuntimeHandlers,
  type ProjectRuntimeHandlerDependencies,
} from '../entrypoints/background/project-handlers';
import {
  createSkillRuntimeHandlers,
  type SkillRuntimeHandlerDependencies,
} from '../entrypoints/background/skill-handlers';

const context: RuntimeMessageContext = {
  runtimeId: 'extension-id',
  surface: 'extension_context',
  senderUrl: 'chrome-extension://extension-id/sidepanel.html',
  senderOrigin: 'chrome-extension://extension-id',
  tabId: 17,
  documentSessionId: 'document-1',
};

const memory: Memory = {
  id: 7,
  syncId: 'memory-sync-7',
  scope: 'global',
  type: 'user',
  name: 'Contract memory',
  content: 'Remember this',
  description: '',
  tags: [],
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  accessCount: 0,
  lastAccessedAt: 1,
};

const skill: Skill = {
  name: 'contract-skill',
  description: 'Contract Skill',
  instructions: 'Follow the contract.',
  source: 'custom',
  memoryEnabled: true,
  enabled: true,
};

const preset: SystemPromptPreset = {
  id: 'preset-1',
  name: 'Preset',
  content: 'Prompt',
  createdAt: 1,
  updatedAt: 1,
};

const savedItem: SavedItem = {
  id: 'saved-1',
  syncId: 'saved-sync-1',
  kind: 'snippet',
  title: 'Saved',
  content: 'Text',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};

const project: ProjectContext = {
  id: 'project-1',
  name: 'Project',
  description: '',
  instructions: 'Use project context.',
  createdAt: 1,
  updatedAt: 1,
};

const conversation: ProjectConversation = {
  conversationId: 'conversation-1',
  projectId: project.id,
  title: 'Conversation',
  url: 'https://chat.deepseek.com/a/chat/s/conversation-1',
  addedAt: 1,
  lastSeenAt: 1,
};

const projectState: ProjectContextState = {
  schemaVersion: 2,
  projects: [project],
  conversations: [conversation],
  pendingProjectId: null,
};

const artifact: ArtifactRecord = {
  id: 'artifact-1',
  kind: 'file',
  filename: 'result.txt',
  mimeType: 'text/plain',
  content: 'result',
  sizeBytes: 6,
  createdAt: 1,
};

describe('R4.1 persistence runtime handler ownership', () => {
  it('creates exactly the 57 inventory-assigned handlers and completes the sole registry', async () => {
    const handlers = createPersistenceRuntimeHandlers({
      memory: createMemoryDependencies(),
      skill: createSkillDependencies(),
      library: createLibraryDependencies(),
      project: createProjectDependencies(),
      localPreference: createLocalPreferenceDependencies(),
    });
    const types = handlers.map((handler) => handler.type);
    const expected = readInventoryCommands('R4.1 / #360 — Persistence, library, and local preferences (57)');

    expect(types).toHaveLength(57);
    expect(new Set(types).size).toBe(57);
    expect([...types].sort()).toEqual([...expected].sort());
    for (const type of types) expect(getRuntimeCommandOwner(type)).toBe('typed-handler');
    const decodedTypes = Object.entries(RUNTIME_COMMAND_CONTRACTS)
      .filter(([, contract]) => contract.request.access === 'payload-decoded')
      .map(([type]) => type)
      .filter((type) => expected.includes(type))
      .sort();
    expect(Object.keys(PERSISTENCE_RUNTIME_PAYLOAD_DECODERS).sort()).toEqual(decodedTypes);

    const registry = createRuntimeCommandRegistry({
      typedHandlers: completeTypedHandlers([
        definePayloadlessRuntimeCommandHandler('GET_CONFIG', () => ({ version: '1.10.0' })),
        definePayloadlessRuntimeCommandHandler('WHATS_NEW_DISMISSED', () => ({ ok: true as const })),
        ...handlers,
      ]),
      handleLegacy: async () => null,
    });
    await expect(registry.dispatch({ type: 'GET_MEMORIES' }, context)).resolves.toEqual([memory]);
  });

  it('rejects a missing required payload before entering a dependency', async () => {
    const dependencies = createMemoryDependencies();
    const handlers = createMemoryRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, { type: 'SAVE_MEMORY' }))
      .rejects.toThrow('SAVE_MEMORY.payload must be a plain object');
    expect(dependencies.saveMemory).not.toHaveBeenCalled();
  });

  it('rejects a non-plain record payload before entering a dependency', async () => {
    const dependencies = createMemoryDependencies();
    const handlers = createMemoryRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_MEMORY',
      payload: new Date(0),
    })).rejects.toThrow('SAVE_MEMORY.payload must be a plain object');
    expect(dependencies.saveMemory).not.toHaveBeenCalled();
  });

  it('rejects malformed nested fields before persistence or external I/O', async () => {
    const localPreferenceDependencies = createLocalPreferenceDependencies();
    const skillDependencies = createSkillDependencies();
    const localPreferenceHandlers = createLocalPreferenceRuntimeHandlers(
      localPreferenceDependencies,
    );
    const skillHandlers = createSkillRuntimeHandlers(skillDependencies);

    await expect(dispatch(localPreferenceHandlers, {
      type: 'SAVE_PET',
      payload: { ...createPetConfig(), enabled: 'yes', motion: 'no' },
    })).rejects.toThrow('SAVE_PET.payload.enabled must be a boolean');
    expect(localPreferenceDependencies.savePetConfig).not.toHaveBeenCalled();

    await expect(dispatch(localPreferenceHandlers, {
      type: 'SET_MODEL_TYPE',
      payload: 'unsupported-model',
    })).rejects.toThrow('SET_MODEL_TYPE.payload must be expert, vision, or null');
    expect(localPreferenceDependencies.setModelType).not.toHaveBeenCalled();

    await expect(dispatch(skillHandlers, {
      type: 'PREVIEW_LOCAL_SKILL_SOURCE',
      payload: { rootPath: 7 },
    })).rejects.toThrow('PREVIEW_LOCAL_SKILL_SOURCE.payload.rootPath must be a non-empty string');
    expect(skillDependencies.previewLocalSkillSource).not.toHaveBeenCalled();
  });
});

describe('Memory handlers', () => {
  it('preserves the atomic import success and released domain failures', async () => {
    const dependencies = createMemoryDependencies();
    vi.mocked(dependencies.importMemoriesAtomically).mockResolvedValue([11, 12]);
    const handlers = createMemoryRuntimeHandlers(dependencies);
    const drafts = [{
      type: 'user' as const,
      name: 'Imported',
      content: 'Memory',
      description: '',
      tags: [],
      pinned: false,
    }];

    await expect(dispatch(handlers, {
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories: drafts },
    })).resolves.toEqual({ ok: true, ids: [11, 12], count: 2 });
    expect(dependencies.importMemoriesAtomically).toHaveBeenCalledWith(drafts);
    expect(dependencies.notifyCommittedStateUpdate).toHaveBeenCalledWith(17);

    vi.mocked(dependencies.notifyCommittedStateUpdate).mockClear();
    await expect(dispatch(handlers, {
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories: 'invalid' },
    })).resolves.toEqual({ ok: false, error: 'invalid_memories' });
    expect(dependencies.notifyCommittedStateUpdate).not.toHaveBeenCalled();

    vi.mocked(dependencies.importMemoriesAtomically)
      .mockRejectedValueOnce(new Error('memory.name must be a string'));
    await expect(dispatch(handlers, {
      type: 'IMPORT_MEMORY_DRAFTS',
      payload: { memories: drafts },
    })).resolves.toEqual({ ok: false, error: 'memory.name must be a string' });
    expect(dependencies.notifyCommittedStateUpdate).not.toHaveBeenCalled();
  });

  it('notifies only after a successful committed mutation', async () => {
    const dependencies = createMemoryDependencies();
    vi.mocked(dependencies.saveMemory).mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    const handlers = createMemoryRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_MEMORY',
      payload: memory,
    })).rejects.toThrow('IndexedDB unavailable');
    expect(dependencies.notifyCommittedStateUpdate).not.toHaveBeenCalled();
  });
});

describe('Skill and library handlers', () => {
  it('preserves both released SAVE_SKILL payload shapes', async () => {
    const dependencies = createSkillDependencies();
    const handlers = createSkillRuntimeHandlers(dependencies);

    await dispatch(handlers, { type: 'SAVE_SKILL', payload: skill });
    await dispatch(handlers, {
      type: 'SAVE_SKILL',
      payload: { skill, previousName: 'old-contract-skill' },
    });

    expect(vi.mocked(dependencies.saveSkill).mock.calls).toEqual([
      [skill, undefined],
      [skill, 'old-contract-skill'],
    ]);
    expect(dependencies.broadcastStateUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not broadcast a blocked local import and propagates a post-commit broadcast failure', async () => {
    const dependencies = createSkillDependencies();
    const blocked: LocalSkillImportResponse = {
      ok: false,
      error: 'Shell Host update required',
      importBlock: { code: 'shell_host_update_required' },
    };
    vi.mocked(dependencies.importLocalSkillSource).mockResolvedValueOnce(blocked);
    const handlers = createSkillRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'IMPORT_LOCAL_SKILL_SOURCE',
      payload: { rootPath: '/skills', selectedPaths: ['one/SKILL.md'] },
    })).resolves.toEqual(blocked);
    expect(dependencies.broadcastStateUpdate).not.toHaveBeenCalled();

    vi.mocked(dependencies.broadcastStateUpdate)
      .mockRejectedValueOnce(new Error('state snapshot unavailable'));
    await expect(dispatch(handlers, {
      type: 'SAVE_SKILL',
      payload: skill,
    })).rejects.toThrow('state snapshot unavailable');
    expect(dependencies.saveSkill).toHaveBeenCalled();
  });

  it('keeps optional picker payload and empty prompt insertion compatibility', async () => {
    const skillDependencies = createSkillDependencies();
    const libraryDependencies = createLibraryDependencies();
    const skillHandlers = createSkillRuntimeHandlers(skillDependencies);
    const libraryHandlers = createLibraryRuntimeHandlers(libraryDependencies);

    await expect(dispatch(skillHandlers, { type: 'PICK_LOCAL_SKILL_FOLDER' }))
      .resolves.toEqual({ path: '/picked' });
    expect(skillDependencies.pickLocalSkillFolder).toHaveBeenCalledWith(undefined);

    await expect(dispatch(libraryHandlers, { type: 'INSERT_SAVED_PROMPT_INTO_CHAT' }))
      .resolves.toEqual({ ok: false, error: 'empty_prompt_text' });
    await expect(dispatch(libraryHandlers, {
      type: 'INSERT_SAVED_PROMPT_INTO_CHAT',
      payload: { text: 7 },
    })).resolves.toEqual({ ok: false, error: 'empty_prompt_text' });
    expect(vi.mocked(libraryDependencies.insertPromptIntoActiveDeepSeekTab).mock.calls)
      .toEqual([[''], ['']]);
  });

  it('passes partial Prompt and Voice settings to their released normalizers', async () => {
    const dependencies = createLibraryDependencies();
    const handlers = createLibraryRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SAVE_PROMPT_INJECTION_SETTINGS',
      payload: { memoryEnabled: false },
    })).resolves.toEqual({
      memoryEnabled: false,
      systemPromptEnabled: true,
      presetCadence: 'default',
      forceResponseLanguage: 'auto',
    });
    await expect(dispatch(handlers, {
      type: 'SAVE_VOICE_SETTINGS',
      payload: { rate: 1.5 },
    })).resolves.toEqual({
      inputEnabled: false,
      readAloudEnabled: false,
      rate: 1.5,
      pitch: 1,
    });
    expect(dependencies.savePromptInjectionSettings).toHaveBeenCalledWith({ memoryEnabled: false });
    expect(dependencies.saveVoiceSettings).toHaveBeenCalledWith({ rate: 1.5 });
  });
});

describe('Project and local preference handlers', () => {
  it('preserves project-delete notification order and the Memory notification condition', async () => {
    const dependencies = createProjectDependencies();
    const events: string[] = [];
    vi.mocked(dependencies.deleteProjectContext).mockImplementation(async () => {
      events.push('delete');
      return 2;
    });
    vi.mocked(dependencies.notifyCommittedProjectContextUpdate).mockImplementation(async () => {
      events.push('project-notify');
    });
    vi.mocked(dependencies.notifyCommittedStateUpdate).mockImplementation(async () => {
      events.push('state-notify');
    });
    const handlers = createProjectRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'DELETE_PROJECT_CONTEXT',
      payload: { projectId: project.id },
    })).resolves.toEqual({ ok: true, deletedMemories: 2 });
    expect(events).toEqual(['delete', 'project-notify', 'state-notify']);

    events.length = 0;
    vi.mocked(dependencies.deleteProjectContext).mockResolvedValueOnce(0);
    await dispatch(handlers, {
      type: 'DELETE_PROJECT_CONTEXT',
      payload: { projectId: project.id },
    });
    expect(events).toEqual(['project-notify']);
  });

  it('preserves GET_PROJECT_CONTEXT_FOR_CONVERSATION as a conditional write', async () => {
    const dependencies = createProjectDependencies();
    const handlers = createProjectRuntimeHandlers(dependencies);
    const input = { conversationId: conversation.conversationId };

    await expect(dispatch(handlers, {
      type: 'GET_PROJECT_CONTEXT_FOR_CONVERSATION',
      payload: { conversation: input, bindPendingProject: true },
    })).resolves.toEqual({
      projectId: project.id,
      context: '## Project Context\nProject: Project',
    });
    expect(dependencies.bindPendingProjectConversation).toHaveBeenCalledWith(input);
    expect(dependencies.refreshProjectConversation).not.toHaveBeenCalled();
    expect(dependencies.notifyCommittedProjectContextUpdate).toHaveBeenCalledWith(17);
  });

  it('keeps invalid-theme, same-value, scalar-model, and visual broadcast behavior', async () => {
    const dependencies = createLocalPreferenceDependencies();
    const handlers = createLocalPreferenceRuntimeHandlers(dependencies);

    await expect(dispatch(handlers, {
      type: 'SET_DEEPSEEK_THEME',
      payload: { theme: 'system' },
    })).resolves.toEqual({ ok: false, error: 'invalid_theme' });
    expect(dependencies.getDeepSeekTheme).not.toHaveBeenCalled();

    vi.mocked(dependencies.getDeepSeekTheme).mockResolvedValueOnce('dark');
    await expect(dispatch(handlers, {
      type: 'SET_DEEPSEEK_THEME',
      payload: { theme: 'dark' },
    })).resolves.toEqual({ ok: true });
    expect(dependencies.saveDeepSeekTheme).not.toHaveBeenCalled();

    await expect(dispatch(handlers, {
      type: 'SET_MODEL_TYPE',
      payload: 'vision',
    })).resolves.toEqual({ ok: true });
    expect(dependencies.setModelType).toHaveBeenCalledWith('vision');

    const background: BackgroundConfig = {
      enabled: true,
      type: 'url',
      url: 'https://example.test/background.png',
      opacity: 0.4,
    };
    const pet = createPetConfig();
    await dispatch(handlers, { type: 'SAVE_BACKGROUND', payload: background });
    await dispatch(handlers, { type: 'SAVE_PET', payload: pet });
    expect(dependencies.broadcastBackgroundUpdate).toHaveBeenCalledWith(background);
    expect(dependencies.broadcastPetUpdate).toHaveBeenCalledWith(pet);

    vi.mocked(dependencies.broadcastPetUpdate).mockClear();
    await dispatch(handlers, { type: 'CLEAR_PET' });
    expect(vi.mocked(dependencies.clearPetConfig))
      .toHaveBeenCalledBefore(vi.mocked(dependencies.getPetConfig));
    expect(dependencies.broadcastPetUpdate).toHaveBeenCalledWith(pet);
  });
});

function createMemoryDependencies(): MemoryRuntimeHandlerDependencies {
  return {
    getAllMemories: vi.fn(async () => [memory]),
    getMemoryById: vi.fn(async () => memory),
    saveMemory: vi.fn(async () => 7),
    importMemoriesAtomically: vi.fn(async () => [7]),
    updateMemory: vi.fn(async () => undefined),
    deleteMemory: vi.fn(async () => undefined),
    touchMemories: vi.fn(async () => undefined),
    notifyCommittedStateUpdate: vi.fn(async () => undefined),
  };
}

function createSkillDependencies(): SkillRuntimeHandlerDependencies {
  const githubPreview = { source: { provider: 'github' }, skills: [], warnings: [], truncated: false } as unknown as GitHubSkillPreview;
  const githubImport = { ok: true, imported: [skill] } as GitHubSkillImportResult;
  const localPreview = { source: { provider: 'local' }, skills: [], warnings: [], truncated: false } as unknown as LocalSkillPreview;
  const localImport = { ok: true, imported: [skill] } as LocalSkillImportResponse;
  const updatePreview = { hasUpdates: false } as GitHubSkillUpdatePreview;
  return {
    getLocale: vi.fn(() => 'zh-CN' as const),
    getAllSkills: vi.fn(async () => [skill]),
    getSkillLibrary: vi.fn(async () => [skill]),
    getAllSkillSources: vi.fn(async () => []),
    saveSkill: vi.fn(async () => undefined),
    deleteSkill: vi.fn(async () => undefined),
    setSkillEnabled: vi.fn(async () => undefined),
    setSkillsEnabled: vi.fn(async () => undefined),
    previewGitHubSkillSource: vi.fn(async () => githubPreview),
    importGitHubSkillSource: vi.fn(async () => githubImport),
    previewLocalSkillSource: vi.fn(async () => localPreview),
    pickLocalSkillFolder: vi.fn(async () => '/picked'),
    importLocalSkillSource: vi.fn(async () => localImport),
    checkGitHubSkillSourceUpdates: vi.fn(async () => updatePreview),
    updateGitHubSkillSource: vi.fn(async () => githubImport),
    deleteGitHubSkillSource: vi.fn(async () => undefined),
    broadcastStateUpdate: vi.fn(async () => undefined),
  };
}

function createLibraryDependencies(): LibraryRuntimeHandlerDependencies {
  return {
    getAllPresets: vi.fn(async () => [preset]),
    savePreset: vi.fn(async () => undefined),
    deletePreset: vi.fn(async () => undefined),
    setActivePresetId: vi.fn(async () => undefined),
    getActivePreset: vi.fn(async () => preset),
    getPromptInjectionSettings: vi.fn(async () => ({
      memoryEnabled: true,
      systemPromptEnabled: true,
      presetCadence: 'default' as const,
      forceResponseLanguage: 'auto' as const,
    })),
    savePromptInjectionSettings: vi.fn(async (settings) => ({
      memoryEnabled: settings.memoryEnabled !== false,
      systemPromptEnabled: settings.systemPromptEnabled !== false,
      presetCadence: settings.presetCadence ?? ('default' as const),
      forceResponseLanguage: settings.forceResponseLanguage ?? ('auto' as const),
    })),
    getAllSavedItems: vi.fn(async () => [savedItem]),
    saveSavedItem: vi.fn(async () => savedItem),
    deleteSavedItem: vi.fn(async () => undefined),
    insertPromptIntoActiveDeepSeekTab: vi.fn(async (text) => (
      text ? { ok: true as const } : { ok: false as const, error: 'empty_prompt_text' }
    )),
    getVoiceSettings: vi.fn(async () => ({
      inputEnabled: false,
      readAloudEnabled: false,
      rate: 1,
      pitch: 1,
    })),
    saveVoiceSettings: vi.fn(async (settings) => ({
      inputEnabled: settings.inputEnabled ?? false,
      readAloudEnabled: settings.readAloudEnabled ?? false,
      rate: settings.rate ?? 1,
      pitch: settings.pitch ?? 1,
    })),
    detectVoiceCapabilities: vi.fn(() => ({
      speechRecognition: false,
      speechSynthesis: false,
    })),
    broadcastStateUpdate: vi.fn(async () => undefined),
    broadcastSavedItemsUpdate: vi.fn(async () => undefined),
    broadcastVoiceSettingsUpdate: vi.fn(async () => undefined),
  };
}

function createProjectDependencies(): ProjectRuntimeHandlerDependencies {
  return {
    getProjectContextState: vi.fn(async () => projectState),
    createProjectContext: vi.fn(async () => project),
    updateProjectContext: vi.fn(async () => project),
    deleteProjectContext: vi.fn(async () => 0),
    addConversationToProject: vi.fn(async () => conversation),
    removeConversationFromProject: vi.fn(async () => undefined),
    setPendingProjectContext: vi.fn(async () => undefined),
    getCurrentDeepSeekConversation: vi.fn(async () => ({
      ok: true as const,
      conversation: {
        conversationId: conversation.conversationId,
        title: conversation.title,
        url: conversation.url,
      },
    })),
    bindPendingProjectConversation: vi.fn(async () => conversation),
    refreshProjectConversation: vi.fn(async () => conversation),
    getProjectForConversation: vi.fn(async () => project),
    getProjectPromptContextForConversation: vi.fn(async () => ({
      projectId: project.id,
      projectName: project.name,
      instructions: project.instructions,
    })),
    formatProjectPromptContext: vi.fn(() => '## Project Context\nProject: Project'),
    getArtifact: vi.fn(async () => artifact),
    notifyCommittedProjectContextUpdate: vi.fn(async () => undefined),
    notifyCommittedStateUpdate: vi.fn(async () => undefined),
  };
}

function createLocalPreferenceDependencies(): LocalPreferenceRuntimeHandlerDependencies {
  const pet = createPetConfig();
  return {
    getDeepSeekTheme: vi.fn(async () => 'light' as const),
    saveDeepSeekTheme: vi.fn(async () => undefined),
    broadcastThemeUpdate: vi.fn(async () => undefined),
    getModelType: vi.fn(async () => null),
    setModelType: vi.fn(async () => undefined),
    broadcastStateUpdate: vi.fn(async () => undefined),
    getBackgroundConfig: vi.fn(async () => null),
    saveBackgroundConfig: vi.fn(async () => undefined),
    clearBackgroundConfig: vi.fn(async () => undefined),
    broadcastBackgroundUpdate: vi.fn(async () => undefined),
    getPetConfig: vi.fn(async () => pet),
    savePetConfig: vi.fn(async () => undefined),
    clearPetConfig: vi.fn(async () => undefined),
    broadcastPetUpdate: vi.fn(async () => undefined),
  };
}

function createPetConfig(): PetConfig {
  return {
    enabled: true,
    position: 'bottom-right',
    size: 132,
    opacity: 0.96,
    motion: true,
  };
}

function dispatch(
  handlers: readonly RuntimeCommandHandler[],
  message: { type: string; payload?: unknown },
): Promise<unknown> {
  const handler = handlers.find((candidate) => candidate.type === message.type);
  if (!handler) throw new Error(`Handler not found: ${message.type}`);
  return handler.handle(message, context);
}

function completeTypedHandlers(
  handlers: readonly RuntimeCommandHandler[],
): RuntimeCommandHandler[] {
  const provided = new Set<string>(handlers.map((handler) => handler.type));
  const stubs = TYPED_RUNTIME_COMMAND_TYPES
    .filter((type) => !provided.has(type))
    .map((type) => ({
      type,
      handle: async () => null,
    } as unknown as RuntimeCommandHandler));
  return [...handlers, ...stubs];
}

function readInventoryCommands(heading: string): string[] {
  const source = readFileSync('docs/compatibility/runtime-command-inventory.md', 'utf8');
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = source.match(new RegExp(`### ${escaped}[^\\n]*\\n\\n` + '```text\\n([\\s\\S]*?)\\n```'))?.[1];
  if (!block) throw new Error(`Inventory block not found: ${heading}`);
  return block.split('\n').filter(Boolean);
}
