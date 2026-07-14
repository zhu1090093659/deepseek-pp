import { describe, expect, it } from 'vitest';
import {
  parseValidatedArray,
  validateImportedMemory,
  validateStoredMemory,
  validateSyncMemory,
} from '../core/sync/schema';
import { decodePreset as validatePreset } from '../core/preset/codec';
import {
  decodeProjectConversation,
  decodeProjectContext,
  decodeProjectContextState,
} from '../core/project';
import { decodeSavedItemsState } from '../core/saved-items';
import {
  MEMORY_HISTORICAL_EXPORT_RECORD,
  MEMORY_IMPORT_PREVIEW_RECORD,
} from './fixtures/persistence-contract/memory';
import { SYNC_MEMORY_MISSING_SCOPE_ADDITIVE_RECORD } from './fixtures/persistence-contract/sync';

const validMemory = {
  syncId: 'sync-1',
  scope: 'global',
  type: 'topic',
  name: 'Memory',
  content: 'Useful fact',
  description: '',
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
      description: '',
      tags: ['test'],
      pinned: false,
    });
  });

  it('accepts preview-style and historical exported memories as import drafts', () => {
    expect(validateImportedMemory(MEMORY_IMPORT_PREVIEW_RECORD)).toEqual({
      ...MEMORY_IMPORT_PREVIEW_RECORD,
      syncId: undefined,
      scope: 'global',
      projectId: undefined,
      tags: [...MEMORY_IMPORT_PREVIEW_RECORD.tags],
    });
    expect(validateImportedMemory(MEMORY_HISTORICAL_EXPORT_RECORD)).toEqual({
      syncId: MEMORY_HISTORICAL_EXPORT_RECORD.syncId,
      scope: 'global',
      projectId: undefined,
      type: MEMORY_HISTORICAL_EXPORT_RECORD.type,
      name: MEMORY_HISTORICAL_EXPORT_RECORD.name,
      content: MEMORY_HISTORICAL_EXPORT_RECORD.content,
      description: '',
      tags: [...MEMORY_HISTORICAL_EXPORT_RECORD.tags],
      pinned: MEMORY_HISTORICAL_EXPORT_RECORD.pinned,
    });
  });

  it('defaults missing sync scope to global and preserves additive fields', () => {
    const { id: _id, ...withoutId } = SYNC_MEMORY_MISSING_SCOPE_ADDITIVE_RECORD;
    expect(validateSyncMemory(SYNC_MEMORY_MISSING_SCOPE_ADDITIVE_RECORD)).toEqual({
      ...withoutId,
      scope: 'global',
      tags: [...SYNC_MEMORY_MISSING_SCOPE_ADDITIVE_RECORD.tags],
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
