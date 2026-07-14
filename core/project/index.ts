export type {
  CurrentDeepSeekConversation,
  ProjectContext,
  ProjectContextCreateInput,
  ProjectContextState,
  ProjectContextUpdateInput,
  ProjectConversation,
  ProjectConversationInput,
  ProjectPromptContext,
} from './types';

export { PROJECT_CONTEXT_SCHEMA_VERSION } from './types';

export {
  createEmptyProjectContextState,
  decodeProjectContext,
  decodeProjectContextState,
  decodeProjectConversation,
} from './codec';

export {
  addConversationToProject,
  bindPendingProjectConversation,
  createProjectContext,
  deleteProjectContextAndMemories,
  formatProjectPromptContext,
  getProjectContextState,
  getProjectForConversation,
  getProjectPromptContextForConversation,
  PROJECT_CONTEXT_STORAGE_KEY,
  refreshProjectConversation,
  removeConversationFromProject,
  setPendingProjectContext,
  updateProjectContext,
} from './store';
