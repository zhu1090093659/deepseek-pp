import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_OFFICIAL_API_CHAT_CONFIG } from '../core/chat/official-api-config';
import { DEFAULT_VOICE_SETTINGS } from '../core/voice/settings';
import { createChatController } from '../entrypoints/sidepanel/controllers/chat-controller';
import { createLibraryController } from '../entrypoints/sidepanel/controllers/library-controller';
import { createSidepanelRuntimeClient } from '../entrypoints/sidepanel/runtime-client';

describe('sidepanel chat controller', () => {
  it('owns provider-specific prompt payload projection', async () => {
    const sendMessage = vi.fn(async (_request: unknown) => ({ ok: true }));
    const controller = createChatController(createSidepanelRuntimeClient(sendMessage));

    await controller.submitPrompt({
      text: 'official prompt',
      authStatus: {
        available: true,
        provider: 'official-api',
        hasApiKey: true,
        hasToken: false,
      },
      config: DEFAULT_OFFICIAL_API_CHAT_CONFIG,
      refFileIds: ['ignored-file'],
    });
    await controller.submitPrompt({
      text: 'vision prompt',
      authStatus: {
        available: true,
        provider: 'deepseek-web',
        hasApiKey: false,
        hasToken: true,
      },
      config: DEFAULT_OFFICIAL_API_CHAT_CONFIG,
      refFileIds: ['file-1'],
    });

    expect(sendMessage.mock.calls[0]?.[0]).toEqual({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: { text: 'official prompt', config: DEFAULT_OFFICIAL_API_CHAT_CONFIG },
    });
    expect(sendMessage.mock.calls[1]?.[0]).toEqual({
      type: 'CHAT_SUBMIT_PROMPT',
      payload: { text: 'vision prompt', refFileIds: ['file-1'] },
    });
  });

  it('loads and normalizes the full confirmed runtime snapshot once', async () => {
    const controller = createChatController(createSidepanelRuntimeClient(async (request) => {
      if (request.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasToken: true, hasApiKey: false };
      }
      if (request.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return DEFAULT_OFFICIAL_API_CHAT_CONFIG;
      if (request.type === 'GET_MODEL_TYPE') return 'vision';
      if (request.type === 'GET_VOICE_SETTINGS') return DEFAULT_VOICE_SETTINGS;
      throw new Error(`Unexpected command: ${request.type}`);
    }));

    await expect(controller.load()).resolves.toMatchObject({
      authStatus: { provider: 'deepseek-web', available: true },
      chatConfig: DEFAULT_OFFICIAL_API_CHAT_CONFIG,
      webModelType: 'vision',
      voiceSettings: DEFAULT_VOICE_SETTINGS,
      loadErrors: [],
    });
  });

  it('keeps independently confirmed chat state while reporting a failed optional read', async () => {
    const controller = createChatController(createSidepanelRuntimeClient(async (request) => {
      if (request.type === 'GET_AUTH_STATUS') {
        return { available: true, provider: 'deepseek-web', hasToken: true, hasApiKey: false };
      }
      if (request.type === 'GET_OFFICIAL_API_CHAT_CONFIG') return DEFAULT_OFFICIAL_API_CHAT_CONFIG;
      if (request.type === 'GET_MODEL_TYPE') return 'vision';
      if (request.type === 'GET_VOICE_SETTINGS') throw new Error('voice settings unavailable');
      throw new Error(`Unexpected command: ${request.type}`);
    }));

    const snapshot = await controller.load();

    expect(snapshot.authStatus.provider).toBe('deepseek-web');
    expect(snapshot.webModelType).toBe('vision');
    expect(snapshot.voiceSettings).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(snapshot.loadErrors).toHaveLength(1);
    expect(snapshot.loadErrors[0]).toMatchObject({ kind: 'transport' });
  });
});

describe('sidepanel library controller', () => {
  it('validates confirmed reads and routes mutations through typed commands', async () => {
    const sendMessage = vi.fn(async (request: { type: string }) => {
      if (request.type === 'GET_MEMORIES') return [memory];
      if (request.type === 'GET_SAVED_ITEMS') return [savedItem];
      if (request.type === 'DELETE_MEMORY' || request.type === 'INSERT_SAVED_PROMPT_INTO_CHAT') {
        return { ok: true };
      }
      throw new Error(`Unexpected command: ${request.type}`);
    });
    const controller = createLibraryController(createSidepanelRuntimeClient(sendMessage));

    await expect(controller.getMemories()).resolves.toEqual([memory]);
    await expect(controller.getSavedItems()).resolves.toEqual([savedItem]);
    await controller.deleteMemory(1);
    await controller.insertSavedPrompt('reuse this');

    expect(sendMessage).toHaveBeenCalledWith({ type: 'DELETE_MEMORY', payload: { id: 1 } });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'INSERT_SAVED_PROMPT_INTO_CHAT',
      payload: { text: 'reuse this' },
    });
  });

  it('rejects malformed confirmed data instead of rendering a fake empty library', async () => {
    const controller = createLibraryController(createSidepanelRuntimeClient(async () => [{ id: 1 }]));
    await expect(controller.getMemories()).rejects.toMatchObject({ kind: 'protocol' });
  });
});

const memory = {
  id: 1,
  syncId: 'memory-1',
  scope: 'global',
  type: 'reference',
  name: 'Remember',
  content: 'A confirmed memory.',
  description: '',
  tags: [],
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  accessCount: 0,
  lastAccessedAt: 1,
};

const savedItem = {
  id: 'saved-1',
  syncId: 'saved-sync-1',
  kind: 'snippet',
  title: 'Snippet',
  content: 'Reuse this.',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
};
