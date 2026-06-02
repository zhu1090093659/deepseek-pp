import type {
  McpServerCreateInput,
  McpServerId,
  McpServerUpdateInput,
} from './mcp/types';
import type {
  ToolCall as GenericToolCall,
  ToolPayload,
  ToolProviderIdentity,
  ToolResult as GenericToolResult,
} from './tool/types';

export type {
  McpHeaderValue,
  McpSecretValue,
  McpServerConfig,
  McpServerConfigVersion,
  McpServerCreateInput,
  McpServerExecutionDefaults,
  McpServerId,
  McpServerResultLimits,
  McpServerStatus,
  McpServerStorageState,
  McpServerTimeouts,
  McpServerTransportConfig,
  McpServerUpdateInput,
  McpServerHealth,
  McpToolAllowlist,
  McpToolCacheEntry,
} from './mcp/types';

export type {
  JsonPrimitive,
  JsonValue,
  ToolCallId,
  ToolCallHistoryRecord,
  ToolCallSource,
  ToolDescriptor,
  ToolDescriptorExecution,
  ToolDescriptorId,
  ToolDescriptorSchema,
  ToolError,
  ToolExecutionContext,
  ToolExecutionMode,
  ToolExecutionTrigger,
  ToolPayload,
  ToolProvider,
  ToolProviderId,
  ToolProviderIdentity,
  ToolProviderKind,
  ToolRegistrySnapshot,
  ToolResult,
  ToolRiskLevel,
  ToolTransportKind,
} from './tool/types';

export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';

export type ModelType = 'expert' | null;

export type DeepSeekTheme = 'light' | 'dark';

export interface BackgroundConfig {
  enabled: boolean;
  type: 'upload' | 'url';
  url?: string;
  imageData?: string;
  opacity: number;
}

export type PetPosition = 'bottom-right' | 'bottom-left' | 'custom';

export interface PetCustomPosition {
  x: number;
  y: number;
}

export interface PetConfig {
  enabled: boolean;
  position: PetPosition;
  customPosition?: PetCustomPosition;
  size: number;
  opacity: number;
  motion: boolean;
}

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

export type NewMemory = Omit<
  Memory,
  'id' | 'syncId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'
> & {
  syncId?: string;
};

export interface SyncConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
  lastSyncAt: number | null;
}

export interface SyncCounts {
  memories: number;
  skills: number;
  presets: number;
}

export type SkillSource = 'builtin' | 'official' | 'custom';

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

export interface ToolCall extends GenericToolCall {}

export interface ToolCardResult extends Pick<GenericToolResult, 'ok' | 'summary' | 'detail' | 'output' | 'truncated' | 'error'> {}

export interface ToolExecutionRecord {
  name: string;
  result: ToolCardResult;
  provider?: ToolProviderIdentity;
  descriptorId?: string;
}

export interface ToolCallRestoreRecord {
  id: string;
  calls?: ToolCall[];
  executions?: ToolExecutionRecord[];
  content?: string;
  source?: 'history' | 'storage';
  url?: string;
  createdAt?: number;
  metadata?: ToolPayload;
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
  parent_message_id: number | null;
  preempt: boolean;
  prompt: string;
  ref_file_ids: string[];
  search_enabled: boolean;
  thinking_enabled: boolean;
  action?: string;
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
  | { type: 'SAVE_MEMORY'; payload: NewMemory }
  | { type: 'DELETE_MEMORY'; payload: { id: number } }
  | { type: 'UPDATE_MEMORY'; payload: Memory }
  | { type: 'SAVE_SKILL'; payload: Skill }
  | { type: 'DELETE_SKILL'; payload: { name: string } }
  | { type: 'GET_PRESETS' }
  | { type: 'SAVE_PRESET'; payload: SystemPromptPreset }
  | { type: 'DELETE_PRESET'; payload: { id: string } }
  | { type: 'SET_ACTIVE_PRESET'; payload: { id: string | null } }
  | { type: 'GET_ACTIVE_PRESET' }
  | { type: 'GET_MCP_SERVERS' }
  | { type: 'GET_MCP_SERVER'; payload: { id: McpServerId } }
  | { type: 'CREATE_MCP_SERVER'; payload: McpServerCreateInput }
  | { type: 'UPDATE_MCP_SERVER'; payload: { id: McpServerId; patch: McpServerUpdateInput } }
  | { type: 'DELETE_MCP_SERVER'; payload: { id: McpServerId } }
  | { type: 'GET_MCP_TOOL_CACHE'; payload: { serverId: McpServerId } }
  | { type: 'REFRESH_MCP_SERVER_TOOLS'; payload: { serverId: McpServerId } }
  | { type: 'GET_TOOL_DESCRIPTORS' }
  | { type: 'REFRESH_TOOL_DESCRIPTORS' }
  | { type: 'EXECUTE_TOOL_CALL'; payload: ToolCall }
  | { type: 'GET_TOOL_CALL_HISTORY'; payload?: { limit?: number } }
  | { type: 'CLEAR_TOOL_CALL_HISTORY' }
  | { type: 'GET_CONFIG' }
  | { type: 'GET_DEEPSEEK_THEME' }
  | { type: 'SET_DEEPSEEK_THEME'; payload: { theme: DeepSeekTheme } }
  | { type: 'GET_MODEL_TYPE' }
  | { type: 'SET_MODEL_TYPE'; payload: ModelType }
  | { type: 'GET_CHAT_MODES' }
  | { type: 'SET_CHAT_MODES'; payload: Partial<import('./chat/mode-store').ChatModes> }
  | { type: 'TOOL_CALL_EXECUTED'; payload: ToolCall }
  | { type: 'MEMORIES_UPDATED' }
  | { type: 'WEBDAV_TEST'; payload: Omit<SyncConfig, 'lastSyncAt'> }
  | { type: 'WEBDAV_UPLOAD_LOCAL' }
  | { type: 'WEBDAV_DOWNLOAD_REMOTE' }
  | { type: 'GET_SYNC_CONFIG' }
  | { type: 'SAVE_SYNC_CONFIG'; payload: SyncConfig }
  | { type: 'GET_BACKGROUND' }
  | { type: 'SAVE_BACKGROUND'; payload: BackgroundConfig }
  | { type: 'CLEAR_BACKGROUND' }
  | { type: 'GET_PET' }
  | { type: 'SAVE_PET'; payload: PetConfig }
  | { type: 'CLEAR_PET' };

export interface PromptConfig {
  memoryTokenBudget: number;
  systemTemplate: string;
}

export interface ScenarioConfig {
  id: string;
  label: string;
  template: string;
  builtIn: boolean;
  enabled: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatStreamChunk {
  text: string;
  done: boolean;
}
