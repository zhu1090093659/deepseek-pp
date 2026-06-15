import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addConversationToProject,
  bindPendingProjectConversation,
  createProjectContext,
  formatProjectPromptContext,
  getProjectContextState,
  getProjectForConversation,
  getProjectPromptContextForConversation,
  normalizeProjectContextState,
  removeConversationFromProject,
  setPendingProjectContext,
  updateProjectContext,
} from '../core/project';

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

describe('session-based project context', () => {
  it('stores projects without carrying over legacy active project state', () => {
    const state = normalizeProjectContextState({
      schemaVersion: 1,
      projects: [{ id: 'legacy', name: 'Legacy' }],
      files: [],
      activeProjectId: 'legacy',
      activeFileIds: [],
    });

    expect(state).toEqual({
      schemaVersion: 2,
      projects: [],
      conversations: [],
      pendingProjectId: null,
    });
  });

  it('keeps one project membership per conversation', async () => {
    const first = await createProjectContext({ name: 'Alpha' });
    const second = await createProjectContext({ name: 'Beta' });

    await addConversationToProject(first.id, {
      conversationId: 'session-1',
      title: 'Draft',
      url: 'https://chat.deepseek.com/chat/s/session-1',
    });
    await addConversationToProject(second.id, {
      conversationId: 'session-1',
      title: 'Draft moved',
      url: 'https://chat.deepseek.com/chat/s/session-1',
    });

    const state = await getProjectContextState();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]).toMatchObject({
      conversationId: 'session-1',
      projectId: second.id,
      title: 'Draft moved',
    });
    await expect(getProjectForConversation('session-1')).resolves.toMatchObject({ id: second.id });
  });

  it('binds pending project to the next conversation and clears pending state', async () => {
    const project = await createProjectContext({
      name: 'Plotforge',
      instructions: 'Keep track of story continuity.',
    });
    await setPendingProjectContext(project.id);

    const conversation = await bindPendingProjectConversation({
      conversationId: 'session-next',
      title: 'Chapter outline',
      url: 'https://chat.deepseek.com/chat/s/session-next',
    });
    const state = await getProjectContextState();
    const context = await getProjectPromptContextForConversation('session-next');

    expect(conversation?.projectId).toBe(project.id);
    expect(state.pendingProjectId).toBeNull();
    expect(formatProjectPromptContext(context!)).toContain('Project: Plotforge');
    expect(formatProjectPromptContext(context!)).toContain('Keep track of story continuity.');
  });

  it('updates project instructions and removes conversation membership', async () => {
    const project = await createProjectContext({ name: 'Alpha', instructions: 'Old' });
    await addConversationToProject(project.id, { conversationId: 'session-1' });

    const updated = await updateProjectContext(project.id, {
      name: 'Alpha Prime',
      instructions: 'New',
    });
    await removeConversationFromProject('session-1');

    const state = await getProjectContextState();
    expect(updated.name).toBe('Alpha Prime');
    expect(state.projects[0].instructions).toBe('New');
    expect(state.conversations).toEqual([]);
  });
});
