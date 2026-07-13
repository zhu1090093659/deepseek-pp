import type {
  ProjectContext,
  ProjectContextCreateInput,
  ProjectContextState,
  ProjectContextUpdateInput,
  ProjectConversation,
  ProjectConversationInput,
  ProjectPromptContext,
} from './types';
import { PROJECT_CONTEXT_SCHEMA_VERSION } from './types';
import { PROJECT_UNTITLED_CONVERSATION, isPlaceholderProjectConversationTitle } from './title';
import { withSyncLocalStateLock } from '../persistence/local-state-lock';
import { deleteMemoriesForProjectAlreadyLocked } from '../memory/store';

export const PROJECT_CONTEXT_STORAGE_KEY = 'deepseek_pp_project_context';

const DEFAULT_STATE: ProjectContextState = {
  schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
  projects: [],
  conversations: [],
  pendingProjectId: null,
};

export async function getProjectContextState(): Promise<ProjectContextState> {
  const data = await chrome.storage.local.get(PROJECT_CONTEXT_STORAGE_KEY) as Record<string, unknown>;
  return normalizeProjectContextState(data[PROJECT_CONTEXT_STORAGE_KEY]);
}

export async function saveProjectContextState(state: ProjectContextState): Promise<void> {
  await withSyncLocalStateLock(() => writeProjectContextState(state));
}

export async function saveProjectContextStateForSyncApply(state: ProjectContextState): Promise<void> {
  await writeProjectContextState(state);
}

async function writeProjectContextState(state: ProjectContextState): Promise<void> {
  await chrome.storage.local.set({
    [PROJECT_CONTEXT_STORAGE_KEY]: normalizeProjectContextState(state),
  });
}

export async function createProjectContext(input: ProjectContextCreateInput): Promise<ProjectContext> {
  return withProjectMutation(async (state) => {
    const now = Date.now();
    const project: ProjectContext = {
      id: crypto.randomUUID(),
      name: requiredTrimmed(input.name, 'Project name'),
      description: String(input.description ?? '').trim(),
      instructions: String(input.instructions ?? '').trim(),
      createdAt: now,
      updatedAt: now,
    };
    await writeProjectContextState({
      ...state,
      projects: [...state.projects, project],
    });
    return project;
  });
}

export async function updateProjectContext(
  projectId: string,
  patch: ProjectContextUpdateInput,
): Promise<ProjectContext> {
  return withProjectMutation(async (state) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const nextProject: ProjectContext = {
      ...project,
      ...(patch.name === undefined ? {} : { name: requiredTrimmed(patch.name, 'Project name') }),
      ...(patch.description === undefined ? {} : { description: String(patch.description).trim() }),
      ...(patch.instructions === undefined ? {} : { instructions: String(patch.instructions).trim() }),
      updatedAt: Date.now(),
    };

    await writeProjectContextState({
      ...state,
      projects: state.projects.map((item) => item.id === projectId ? nextProject : item),
    });
    return nextProject;
  });
}

export async function deleteProjectContext(projectId: string): Promise<void> {
  await withProjectMutation(async (state) => {
    await deleteProjectContextState(state, projectId);
  });
}

export async function deleteProjectContextAndMemories(projectId: string): Promise<number> {
  return withProjectMutation(async (state) => {
    await deleteProjectContextState(state, projectId);
    return deleteMemoriesForProjectAlreadyLocked(projectId);
  });
}

async function deleteProjectContextState(
  state: ProjectContextState,
  projectId: string,
): Promise<void> {
  await writeProjectContextState({
    ...state,
    projects: state.projects.filter((project) => project.id !== projectId),
    conversations: state.conversations.filter((conversation) => conversation.projectId !== projectId),
    pendingProjectId: state.pendingProjectId === projectId ? null : state.pendingProjectId,
  });
}

export async function addConversationToProject(
  projectId: string,
  input: ProjectConversationInput,
): Promise<ProjectConversation> {
  return withProjectMutation((state) => addConversationToProjectState(state, projectId, input));
}

async function addConversationToProjectState(
  state: ProjectContextState,
  projectId: string,
  input: ProjectConversationInput,
): Promise<ProjectConversation> {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const now = Date.now();
  const conversationId = requiredTrimmed(input.conversationId, 'Conversation id');
  const existing = state.conversations.find((item) => item.conversationId === conversationId);
  const conversation: ProjectConversation = {
    conversationId,
    projectId,
    title: selectConversationTitle(input.title, existing?.title),
    url: normalizeConversationUrl(input.url ?? existing?.url),
    addedAt: existing?.addedAt ?? now,
    lastSeenAt: now,
  };

  await writeProjectContextState({
    ...state,
    projects: state.projects.map((item) => item.id === projectId ? { ...item, updatedAt: now } : item),
    conversations: [
      ...state.conversations.filter((item) => item.conversationId !== conversationId),
      conversation,
    ],
    pendingProjectId: state.pendingProjectId === projectId ? null : state.pendingProjectId,
  });

  return conversation;
}

export async function refreshProjectConversation(
  input: ProjectConversationInput,
): Promise<ProjectConversation | null> {
  return withProjectMutation(async (state) => {
    const conversationId = requiredTrimmed(input.conversationId, 'Conversation id');
    const existing = state.conversations.find((item) => item.conversationId === conversationId);
    if (!existing) return null;

    const now = Date.now();
    const conversation: ProjectConversation = {
      ...existing,
      title: selectConversationTitle(input.title, existing.title),
      url: normalizeConversationUrl(input.url ?? existing.url),
      lastSeenAt: now,
    };

    await writeProjectContextState({
      ...state,
      projects: state.projects.map((item) => item.id === existing.projectId ? { ...item, updatedAt: now } : item),
      conversations: state.conversations.map((item) => item.conversationId === conversationId ? conversation : item),
    });
    return conversation;
  });
}

export async function removeConversationFromProject(conversationId: string): Promise<void> {
  await withProjectMutation(async (state) => {
    await writeProjectContextState({
      ...state,
      conversations: state.conversations.filter((item) => item.conversationId !== conversationId),
    });
  });
}

export async function setPendingProjectContext(projectId: string | null): Promise<void> {
  await withProjectMutation(async (state) => {
    const exists = projectId === null || state.projects.some((project) => project.id === projectId);
    if (!exists) throw new Error(`Project not found: ${projectId}`);
    await writeProjectContextState({
      ...state,
      pendingProjectId: projectId,
    });
  });
}

export async function bindPendingProjectConversation(
  input: ProjectConversationInput,
): Promise<ProjectConversation | null> {
  return withProjectMutation(async (state) => {
    if (!state.pendingProjectId) return null;
    const projectExists = state.projects.some((project) => project.id === state.pendingProjectId);
    if (!projectExists) {
      await writeProjectContextState({ ...state, pendingProjectId: null });
      return null;
    }
    return addConversationToProjectState(state, state.pendingProjectId, input);
  });
}

function withProjectMutation<T>(
  operation: (state: ProjectContextState) => Promise<T>,
): Promise<T> {
  return withSyncLocalStateLock(async () => operation(await getProjectContextState()));
}

export async function getProjectForConversation(conversationId: string): Promise<ProjectContext | null> {
  const state = await getProjectContextState();
  const membership = state.conversations.find((item) => item.conversationId === conversationId);
  if (!membership) return null;
  return state.projects.find((project) => project.id === membership.projectId) ?? null;
}

export async function getProjectPromptContextForConversation(
  conversationId: string,
): Promise<ProjectPromptContext | null> {
  const state = await getProjectContextState();
  const membership = state.conversations.find((item) => item.conversationId === conversationId);
  if (!membership) return null;
  const project = state.projects.find((item) => item.id === membership.projectId);
  if (!project) return null;
  const instructions = project.instructions.trim();
  if (!instructions) return null;
  return {
    projectId: project.id,
    projectName: project.name,
    instructions,
  };
}

export function formatProjectPromptContext(context: ProjectPromptContext): string {
  return [
    '## Project Context',
    `Project: ${context.projectName}`,
    '',
    '### Project Instructions',
    context.instructions,
  ].join('\n').trim();
}

export function normalizeProjectContextState(value: unknown): ProjectContextState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_STATE };
  const object = value as Partial<ProjectContextState>;
  if (object.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION) return { ...DEFAULT_STATE };

  const projects = Array.isArray(object.projects) ? object.projects.filter(isProjectContext) : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const seenConversations = new Set<string>();
  const conversations = Array.isArray(object.conversations)
    ? object.conversations.filter((conversation): conversation is ProjectConversation => {
      if (!isProjectConversation(conversation)) return false;
      if (!projectIds.has(conversation.projectId)) return false;
      if (seenConversations.has(conversation.conversationId)) return false;
      seenConversations.add(conversation.conversationId);
      return true;
    })
    : [];
  const pendingProjectId = typeof object.pendingProjectId === 'string' && projectIds.has(object.pendingProjectId)
    ? object.pendingProjectId
    : null;

  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    projects,
    conversations,
    pendingProjectId,
  };
}

function requiredTrimmed(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function normalizeConversationTitle(value: unknown): string {
  if (typeof value !== 'string') return PROJECT_UNTITLED_CONVERSATION;
  const title = value.trim();
  if (!title || isPlaceholderProjectConversationTitle(title)) return PROJECT_UNTITLED_CONVERSATION;
  return title;
}

function selectConversationTitle(incoming: unknown, existing: unknown): string {
  const incomingTitle = typeof incoming === 'string' ? incoming.trim() : '';
  if (incomingTitle && !isPlaceholderProjectConversationTitle(incomingTitle)) return incomingTitle;
  return normalizeConversationTitle(existing);
}

function normalizeConversationUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isProjectContext(value: unknown): value is ProjectContext {
  if (!value || typeof value !== 'object') return false;
  const item = value as ProjectContext;
  return typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    typeof item.instructions === 'string' &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number';
}

function isProjectConversation(value: unknown): value is ProjectConversation {
  if (!value || typeof value !== 'object') return false;
  const item = value as ProjectConversation;
  return typeof item.conversationId === 'string' &&
    typeof item.projectId === 'string' &&
    typeof item.title === 'string' &&
    typeof item.url === 'string' &&
    typeof item.addedAt === 'number' &&
    typeof item.lastSeenAt === 'number';
}
