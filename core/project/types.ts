export const PROJECT_CONTEXT_SCHEMA_VERSION = 2 as const;

export interface ProjectContext {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectConversation {
  conversationId: string;
  projectId: string;
  title: string;
  url: string;
  addedAt: number;
  lastSeenAt: number;
}

export interface ProjectContextState {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  projects: ProjectContext[];
  conversations: ProjectConversation[];
  pendingProjectId: string | null;
}

export interface ProjectContextCreateInput {
  name: string;
  description?: string;
  instructions?: string;
}

export interface ProjectContextUpdateInput {
  name?: string;
  description?: string;
  instructions?: string;
}

export interface ProjectConversationInput {
  conversationId: string;
  title?: string;
  url?: string;
}

export interface ProjectPromptContext {
  projectId: string;
  projectName: string;
  instructions: string;
}

export interface CurrentDeepSeekConversation {
  conversationId: string;
  title: string;
  url: string;
}
