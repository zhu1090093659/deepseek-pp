import {
  definePayloadlessRuntimeCommandHandler,
  type RuntimeCommandHandler,
} from '../../core/messaging/runtime-command-registry';
import type {
  ArtifactRecord,
  CurrentDeepSeekConversation,
  ProjectContext,
  ProjectContextCreateInput,
  ProjectContextState,
  ProjectContextUpdateInput,
  ProjectConversation,
  ProjectConversationInput,
  ProjectPromptContext,
} from '../../core/types';
import { definePersistencePayloadRuntimeCommandHandler } from './runtime-handler';

type CurrentConversationResponse =
  | { ok: true; conversation: CurrentDeepSeekConversation }
  | { ok: false; error: string };

export interface ProjectRuntimeHandlerDependencies {
  getProjectContextState(): Promise<ProjectContextState>;
  createProjectContext(input: ProjectContextCreateInput): Promise<ProjectContext>;
  updateProjectContext(projectId: string, patch: ProjectContextUpdateInput): Promise<ProjectContext>;
  deleteProjectContext(projectId: string): Promise<number>;
  addConversationToProject(
    projectId: string,
    conversation: ProjectConversationInput,
  ): Promise<ProjectConversation>;
  removeConversationFromProject(conversationId: string): Promise<void>;
  setPendingProjectContext(projectId: string | null): Promise<void>;
  getCurrentDeepSeekConversation(): Promise<CurrentConversationResponse>;
  bindPendingProjectConversation(conversation: ProjectConversationInput): Promise<ProjectConversation | null>;
  refreshProjectConversation(conversation: ProjectConversationInput): Promise<ProjectConversation | null>;
  getProjectForConversation(conversationId: string): Promise<ProjectContext | null>;
  getProjectPromptContextForConversation(conversationId: string): Promise<ProjectPromptContext | null>;
  formatProjectPromptContext(context: ProjectPromptContext): string;
  getArtifact(id: string): Promise<ArtifactRecord | null>;
  notifyCommittedProjectContextUpdate(excludeTabId?: number): Promise<void>;
  notifyCommittedStateUpdate(excludeTabId?: number): Promise<void>;
}

export function createProjectRuntimeHandlers(
  dependencies: ProjectRuntimeHandlerDependencies,
): readonly RuntimeCommandHandler[] {
  return Object.freeze([
    definePayloadlessRuntimeCommandHandler('GET_PROJECT_CONTEXT_STATE', () => (
      dependencies.getProjectContextState()
    )),
    definePersistencePayloadRuntimeCommandHandler('CREATE_PROJECT_CONTEXT', async (input, context) => {
      const project = await dependencies.createProjectContext(input);
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      return project;
    }),
    definePersistencePayloadRuntimeCommandHandler('UPDATE_PROJECT_CONTEXT', async (payload, context) => {
      const project = await dependencies.updateProjectContext(payload.projectId, payload.patch);
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      return project;
    }),
    definePersistencePayloadRuntimeCommandHandler('DELETE_PROJECT_CONTEXT', async (payload, context) => {
      const deletedMemories = await dependencies.deleteProjectContext(payload.projectId);
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      if (deletedMemories > 0) {
        await dependencies.notifyCommittedStateUpdate(context.tabId);
      }
      return { ok: true as const, deletedMemories };
    }),
    definePersistencePayloadRuntimeCommandHandler('ADD_CONVERSATION_TO_PROJECT', async (payload, context) => {
      const conversation = await dependencies.addConversationToProject(
        payload.projectId,
        payload.conversation,
      );
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      return { ok: true as const, conversation };
    }),
    definePersistencePayloadRuntimeCommandHandler('REMOVE_CONVERSATION_FROM_PROJECT', async (payload, context) => {
      await dependencies.removeConversationFromProject(payload.conversationId);
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePersistencePayloadRuntimeCommandHandler('SET_PENDING_PROJECT_CONTEXT', async (payload, context) => {
      await dependencies.setPendingProjectContext(payload.projectId);
      await dependencies.notifyCommittedProjectContextUpdate(context.tabId);
      return { ok: true as const };
    }),
    definePayloadlessRuntimeCommandHandler('GET_CURRENT_DEEPSEEK_CONVERSATION', () => (
      dependencies.getCurrentDeepSeekConversation()
    )),
    definePersistencePayloadRuntimeCommandHandler('GET_PROJECT_CONTEXT_FOR_CONVERSATION', async (payload, context) => {
      const changed = payload.bindPendingProject === true
        ? await dependencies.bindPendingProjectConversation(payload.conversation)
        : await dependencies.refreshProjectConversation(payload.conversation);
      if (changed) await dependencies.notifyCommittedProjectContextUpdate(context.tabId);

      const conversationId = payload.conversation.conversationId;
      const project = await dependencies.getProjectForConversation(conversationId);
      if (!project) return null;
      const projectContext = await dependencies.getProjectPromptContextForConversation(conversationId);
      return {
        projectId: project.id,
        context: projectContext
          ? dependencies.formatProjectPromptContext(projectContext)
          : null,
      };
    }),
    definePersistencePayloadRuntimeCommandHandler('GET_ARTIFACT', async (payload) => {
      const artifact = await dependencies.getArtifact(payload.id);
      return artifact
        ? { ok: true as const, artifact }
        : { ok: false as const, error: 'artifact_not_found' as const };
    }),
  ]);
}
