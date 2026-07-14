import { describe, expect, it } from 'vitest';
import {
  parseValidatedArray,
  validateImportedMemory,
  validatePreset,
  validateStoredMemory,
} from '../core/sync/schema';
import {
  decodeProjectConversation,
  decodeProjectContext,
  decodeProjectContextState,
} from '../core/project';
import { decodeSavedItemsState } from '../core/saved-items';

const validMemory = {
  syncId: 'sync-1',
  scope: 'global',
  type: 'topic',
  name: 'Memory',
  content: 'Useful fact',
  description: 'Memory',
  tags: ['test'],
  pinned: false,
  createdAt: 1,
  updatedAt: 1,
  accessCount: 0,
  lastAccessedAt: 1,
};

describe('sync schema validators', () => {
  it('validates stored memories and imported memory payloads', () => {
    expect(validateStoredMemory(validMemory).syncId).toBe('sync-1');
    expect(validateImportedMemory(validMemory)).toEqual({
      syncId: 'sync-1',
      scope: 'global',
      projectId: undefined,
      type: 'topic',
      name: 'Memory',
      content: 'Useful fact',
      description: 'Memory',
      tags: ['test'],
      pinned: false,
    });
  });

  it('rejects malformed array items with path context', () => {
    expect(() => parseValidatedArray('memories.json', JSON.stringify([validMemory, { ...validMemory, tags: [1] }]), validateStoredMemory))
      .toThrow('memories.json[1].tags');
  });

  it('rejects invalid presets before storage writes', () => {
    expect(() => validatePreset({ id: 'p1', name: 'Preset' }, 'presets[0]'))
      .toThrow('presets[0].content');
  });

  it('validates project context and project conversations at sync boundaries', () => {
    const project = decodeProjectContext({
      id: 'project-1',
      name: 'DeepSeek++',
      description: '',
      instructions: 'Use project context.',
      createdAt: 1,
      updatedAt: 2,
    }, 'projects[0]');
    const conversation = decodeProjectConversation({
      conversationId: 'session-1',
      projectId: 'project-1',
      title: 'Review project progress',
      url: 'https://chat.deepseek.com/chat/s/session-1',
      addedAt: 3,
      lastSeenAt: 4,
    }, 'projectConversations[0]');

    expect(project.instructions).toBe('Use project context.');
    expect(conversation.conversationId).toBe('session-1');
    expect(() => decodeProjectConversation({ ...conversation, addedAt: 'now' }, 'projectConversations[1]'))
      .toThrow('projectConversations[1].addedAt');
  });

  it('validates full project context sync state', () => {
    const state = decodeProjectContextState({
      schemaVersion: 2,
      projects: [{
        id: 'project-1',
        name: 'DeepSeek++',
        description: '',
        instructions: 'Use project context.',
        createdAt: 1,
        updatedAt: 2,
      }],
      conversations: [{
        conversationId: 'session-1',
        projectId: 'project-1',
        title: 'Project thread',
        url: 'https://chat.deepseek.com/chat/s/session-1',
        addedAt: 3,
        lastSeenAt: 4,
      }],
      pendingProjectId: 'project-1',
    }, 'project-context.json');

    expect(state.pendingProjectId).toBe('project-1');
    expect(state.conversations[0].conversationId).toBe('session-1');
    expect(() => decodeProjectContextState({ ...state, pendingProjectId: 'missing' }, 'project-context.json'))
      .toThrow('project-context.json.pendingProjectId references an unknown project');
    expect(() => decodeProjectContextState({
      ...state,
      conversations: [...state.conversations, { ...state.conversations[0] }],
    }, 'project-context.json')).toThrow('project-context.json.conversations contains duplicate conversation');
  });

  it('validates saved items at sync boundaries', () => {
    const state = decodeSavedItemsState({
      schemaVersion: 1,
      items: [{
        id: 'saved-1',
        syncId: 'sync-1',
        kind: 'snippet',
        title: 'Reusable prompt',
        content: 'Summarize the selected text.',
        tags: ['prompt'],
        createdAt: 1,
        updatedAt: 2,
      }],
    }, 'saved-items.json');

    expect(state.items[0].kind).toBe('snippet');
    expect(() => decodeSavedItemsState({
      schemaVersion: 1,
      items: [{ ...state.items[0], kind: 'note' }],
    }, 'saved-items.json')).toThrow('saved-items.json.items[0].kind');
  });
});
