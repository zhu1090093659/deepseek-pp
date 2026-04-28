export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';

export type ModelType = 'expert' | null;

export interface Memory {
  id?: number;
  syncId: string;
  type: MemoryType;
  name: string;
  content: string;
  description: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface SyncConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
  lastSyncAt: number | null;
}

export type SkillSource = 'builtin' | 'custom';

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  memoryEnabled: boolean;
  metadata?: Record<string, string>;
}

export interface SkillInvocation {
  skillName: string;
  args: string;
  rawInput: string;
}

export interface ToolCall {
  name: string;
  payload: Record<string, unknown>;
  raw: string;
}

export interface SystemPromptPreset {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeepSeekRequest {
  chat_session_id: string;
  model_type: string;
  parent_message_id: string | null;
  preempt: boolean;
  prompt: string;
  ref_file_ids: string[];
  search_enabled: boolean;
  thinking_enabled: boolean;
}

export interface SSEEvent {
  id?: string;
  type: string;
  data: string;
}

export type MessageAction =
  | { type: 'GET_MEMORIES' }
  | { type: 'GET_MEMORY_BY_ID'; payload: { id: number } }
  | { type: 'GET_SKILLS' }
  | { type: 'SAVE_MEMORY'; payload: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'> }
  | { type: 'DELETE_MEMORY'; payload: { id: number } }
  | { type: 'UPDATE_MEMORY'; payload: Memory }
  | { type: 'SAVE_SKILL'; payload: Skill }
  | { type: 'DELETE_SKILL'; payload: { name: string } }
  | { type: 'GET_PRESETS' }
  | { type: 'SAVE_PRESET'; payload: SystemPromptPreset }
  | { type: 'DELETE_PRESET'; payload: { id: string } }
  | { type: 'SET_ACTIVE_PRESET'; payload: { id: string | null } }
  | { type: 'GET_ACTIVE_PRESET' }
  | { type: 'GET_CONFIG' }
  | { type: 'GET_MODEL_TYPE' }
  | { type: 'SET_MODEL_TYPE'; payload: ModelType }
  | { type: 'TOOL_CALL_EXECUTED'; payload: ToolCall }
  | { type: 'MEMORIES_UPDATED' }
  | { type: 'WEBDAV_TEST'; payload: Omit<SyncConfig, 'lastSyncAt'> }
  | { type: 'WEBDAV_SYNC' }
  | { type: 'GET_SYNC_CONFIG' }
  | { type: 'SAVE_SYNC_CONFIG'; payload: SyncConfig };

export interface PromptConfig {
  memoryTokenBudget: number;
  systemTemplate: string;
}
