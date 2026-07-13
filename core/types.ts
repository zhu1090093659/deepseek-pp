import type {
  McpServerCreateInput,
  McpServerId,
  McpServerUpdateInput,
} from './mcp/types';
import type {
  CurrentDeepSeekConversation,
  ProjectContextCreateInput,
  ProjectContextState,
  ProjectContextUpdateInput,
  ProjectConversationInput,
} from './project/types';
import type { PromptInjectionSettings as PromptInjectionSettingsType } from './prompt/settings';
import type { SandboxRunRequest as SandboxRunRequestType } from './sandbox/types';
import type {
  SavedItemInput,
} from './saved-items/types';
import type {
  OfficialApiChatConfig as OfficialApiChatConfigType,
} from './chat/official-api-config';
import type {
  MultimodalSettingsPatch as MultimodalSettingsPatchType,
} from './multimodal/settings';
import type {
  MultimodalMediaAnalyzeRequest as MultimodalMediaAnalyzeRequestType,
} from './multimodal/media';
import type { VoiceSettings as VoiceSettingsType } from './voice/settings';
import type {
  ToolCall as GenericToolCall,
  ToolPayload,
  ToolProviderIdentity,
  ToolResult as GenericToolResult,
} from './tool/types';
import type {
  UsageRangeDays as UsageRangeDaysType,
  UsageTurnInput as UsageTurnInputType,
} from './usage/types';

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
  ToolAuthorizationDescriptorSnapshot,
  ToolAuthorizationGrantSummary,
  ToolAuthorizationId,
  ToolAuthorizationSubject,
  ToolAuthorizationSurface,
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
  RuntimeToolAuthorizationContext,
  ToolGrantExecutionContext,
  TrustedToolExecutionContext,
  ToolTransportKind,
} from './tool/types';

export type {
  CurrentDeepSeekConversation,
  ProjectContext,
  ProjectContextCreateInput,
  ProjectContextState,
  ProjectContextUpdateInput,
  ProjectConversation,
  ProjectConversationInput,
  ProjectPromptContext,
} from './project/types';

export type {
  ArtifactFile,
  ArtifactKind,
  ArtifactOutput,
  ArtifactPreviewMode,
  ArtifactRecord,
  ArtifactRuntimeLanguage,
  ArtifactView,
} from './artifact/types';

export type {
  PromptInjectionSettings,
  PromptPresetCadence,
  ForcedResponseLanguage,
} from './prompt/settings';

export type {
  SavedItem,
  SavedItemInput,
  SavedItemKind,
  SavedItemsState,
} from './saved-items/types';

export type {
  OfficialApiChatConfig,
  OfficialDeepSeekModel,
  OfficialDeepSeekReasoningEffort,
  OfficialDeepSeekThinkingMode,
} from './chat/official-api-config';

export type {
  MultimodalSettings,
  MultimodalSettingsPatch,
  MultimodalSettingsStatus,
} from './multimodal/settings';

export type {
  MultimodalMediaAnalysisItem,
  MultimodalMediaAnalysisSubject,
  MultimodalMediaAnalyzeRequest,
  MultimodalMediaAnalyzeResponse,
  MultimodalMediaInput,
  MultimodalMediaKind,
} from './multimodal/media';

export type {
  UsageDailyModelSummary,
  UsageDailySummary,
  UsageHeatmapCell,
  UsageModelSummary,
  UsageRangeDays,
  UsageRecordSource,
  UsageSummary,
  UsageTurnInput,
  UsageTurnRecord,
} from './usage/types';

export type {
  VoiceCapabilityState,
  VoiceSettings,
} from './voice/settings';

export type {
  SandboxExecutionResult,
  SandboxLanguage,
  SandboxRunRequest,
} from './sandbox/types';

export type {
  PlatformCapability,
  PlatformCapabilityMap,
  PlatformDownload,
  PlatformEnvironment,
  PlatformFilePicker,
  PlatformKind,
  PlatformPickedFile,
  PlatformRuntime,
  PlatformServices,
  PlatformStorage,
} from './platform';

export type MemoryType = 'user' | 'feedback' | 'topic' | 'reference';
export type MemoryScope = 'global' | 'project';

export type ModelType = 'expert' | 'vision' | null;

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
  scope: MemoryScope;
  projectId?: string;
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
  'id' | 'syncId' | 'scope' | 'projectId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'
> & {
  syncId?: string;
  scope?: MemoryScope;
  projectId?: string;
};

export interface SyncConfigBase {
  lastSyncAt: number | null;
}

export interface WebdavSyncConfig extends SyncConfigBase {
  provider: 'webdav';
  url: string;
  username: string;
  password: string;
  remotePath: string;
}

export interface GDriveSyncConfig extends SyncConfigBase {
  provider: 'gdrive';
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

export interface OneDriveSyncConfig extends SyncConfigBase {
  provider: 'onedrive';
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

export type SyncConfig = WebdavSyncConfig | GDriveSyncConfig | OneDriveSyncConfig;

export type SyncProvider = SyncConfig['provider'];

// Distributive Omit: applies Omit to each member of a union separately,
// preserving provider discrimination when stripping shared fields like lastSyncAt.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

// Strip lastSyncAt from any SyncConfig variant for "save without timestamp" flows.
export type SyncConfigDraft = DistributiveOmit<SyncConfig, 'lastSyncAt'>;

export interface SyncCounts {
  memories: number;
  skills: number;
  presets: number;
  projects: number;
  projectConversations: number;
  savedItems: number;
}

export type SkillSource = 'builtin' | 'third-party' | 'official' | 'custom' | 'remote';

export type ImportedSkillProvider = 'github' | 'local';

export interface RemoteSkillFile {
  path: string;
  bytes: number;
}

export interface RemoteSkillMetadata {
  provider: ImportedSkillProvider;
  sourceId: string;
  sourceUrl?: string;
  repository?: string;
  ref?: string;
  commitSha?: string;
  path: string;
  originalName: string;
  importedAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
  localRootPath?: string;
  localDirectory?: string;
  localDisplayName?: string;
  licenseName?: string;
  licenseSpdxId?: string;
  upstreamVersion?: string;
  upstreamUpdatedAt?: string;
  includedFiles: RemoteSkillFile[];
  omittedFiles: RemoteSkillFile[];
  scriptFiles?: RemoteSkillFile[];
  warnings: string[];
}

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  memoryEnabled: boolean;
  enabled?: boolean;
  metadata?: Record<string, string>;
  remote?: RemoteSkillMetadata;
}

export type SaveSkillPayload = Skill | { skill: Skill; previousName?: string };

export interface GitHubSkillSource {
  id: string;
  provider: 'github';
  url: string;
  owner: string;
  repo: string;
  repository: string;
  ref: string;
  rootPath: string;
  commitSha: string;
  defaultBranch: string;
  repoUrl: string;
  licenseName?: string;
  licenseSpdxId?: string;
  packageVersion?: string;
  description?: string;
  skillPaths: string[];
  importedSkillNames: string[];
  importedAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
}

export interface LocalSkillSource {
  id: string;
  provider: 'local';
  rootPath: string;
  displayName: string;
  directoryName: string;
  skillPaths: string[];
  importedSkillNames: string[];
  importedAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
  warnings: string[];
}

export type SkillImportSource = GitHubSkillSource | LocalSkillSource;

export interface GitHubSkillPreviewItem {
  path: string;
  name: string;
  importName: string;
  description: string;
  version?: string;
  lastUpdated?: string;
  bytes: number;
  bodyBytes: number;
  includedFiles: RemoteSkillFile[];
  omittedFiles: RemoteSkillFile[];
  warnings: string[];
  nameChanged: boolean;
  existingSkillName?: string;
  existingSourceId?: string;
}

export interface GitHubSkillPreview {
  source: GitHubSkillSource;
  skills: GitHubSkillPreviewItem[];
  warnings: string[];
  truncated: boolean;
}

export interface GitHubSkillImportRequest {
  url: string;
  selectedPaths: string[];
}

export interface GitHubSkillImportResult {
  ok: true;
  source: GitHubSkillSource;
  imported: Skill[];
  replaced: number;
  renamed: number;
  warnings: string[];
}

export type LocalSkillImportBlockCode =
  | 'shell_host_update_required'
  | 'shell_reader_unavailable'
  | 'shell_discovery_failed';

export interface LocalSkillImportBlock {
  code: LocalSkillImportBlockCode;
  detail?: string;
}

export interface LocalSkillPreviewItem {
  path: string;
  name: string;
  importName: string;
  description: string;
  version?: string;
  lastUpdated?: string;
  bytes: number;
  bodyBytes: number;
  includedFiles: RemoteSkillFile[];
  omittedFiles: RemoteSkillFile[];
  scriptFiles: RemoteSkillFile[];
  warnings: string[];
  importBlock?: LocalSkillImportBlock;
  nameChanged: boolean;
  existingSkillName?: string;
  existingSourceId?: string;
}

export interface LocalSkillPreview {
  source: LocalSkillSource;
  skills: LocalSkillPreviewItem[];
  warnings: string[];
  truncated: boolean;
}

export interface LocalSkillImportRequest {
  rootPath: string;
  selectedPaths: string[];
  selectedImportNames?: Record<string, string>;
}

export interface LocalSkillImportResult {
  ok: true;
  source: LocalSkillSource;
  imported: Skill[];
  replaced: number;
  renamed: number;
  warnings: string[];
}

export interface LocalSkillImportFailure {
  ok: false;
  error: string;
  importBlock: LocalSkillImportBlock;
}

export type LocalSkillImportResponse = LocalSkillImportResult | LocalSkillImportFailure;

export interface GitHubSkillUpdatePreview {
  source: GitHubSkillSource;
  latestCommitSha: string;
  latestVersion?: string;
  hasUpdates: boolean;
  changedPaths: string[];
  missingPaths: string[];
  newPaths: string[];
  warnings: string[];
  checkedAt: number;
}

export interface SkillInvocation {
  skillName: string;
  args: string;
  rawInput: string;
}

export interface ToolCall extends GenericToolCall {}

export interface ToolCardResult extends Pick<GenericToolResult, 'ok' | 'summary' | 'detail' | 'output' | 'truncated' | 'error'> {}

export interface ToolExecutionRecord {
  callId?: string;
  pending?: boolean;
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
  | { type: 'GET_SKILL_LIBRARY' }
  | { type: 'GET_SKILL_SOURCES' }
  | { type: 'GET_GITHUB_SKILL_SOURCES' }
  | { type: 'PREVIEW_GITHUB_SKILL_SOURCE'; payload: { url: string } }
  | { type: 'IMPORT_GITHUB_SKILL_SOURCE'; payload: GitHubSkillImportRequest }
  | { type: 'PREVIEW_LOCAL_SKILL_SOURCE'; payload: { rootPath: string } }
  | { type: 'PICK_LOCAL_SKILL_FOLDER'; payload?: { defaultPath?: string } }
  | { type: 'IMPORT_LOCAL_SKILL_SOURCE'; payload: LocalSkillImportRequest }
  | { type: 'CHECK_GITHUB_SKILL_SOURCE_UPDATES'; payload: { sourceId: string } }
  | { type: 'UPDATE_GITHUB_SKILL_SOURCE'; payload: { sourceId: string } }
  | { type: 'DELETE_GITHUB_SKILL_SOURCE'; payload: { sourceId: string } }
  | { type: 'SAVE_MEMORY'; payload: NewMemory }
  | { type: 'IMPORT_MEMORY_DRAFTS'; payload: { memories: NewMemory[] } }
  | { type: 'DELETE_MEMORY'; payload: { id: number } }
  | { type: 'UPDATE_MEMORY'; payload: Memory }
  | { type: 'SAVE_SKILL'; payload: SaveSkillPayload }
  | { type: 'DELETE_SKILL'; payload: { name: string } }
  | { type: 'SET_SKILL_ENABLED'; payload: { name: string; enabled: boolean } }
  | { type: 'SET_SKILLS_ENABLED'; payload: { updates: Array<{ name: string; enabled: boolean }> } }
  | { type: 'GET_PRESETS' }
  | { type: 'SAVE_PRESET'; payload: SystemPromptPreset }
  | { type: 'DELETE_PRESET'; payload: { id: string } }
  | { type: 'SET_ACTIVE_PRESET'; payload: { id: string | null } }
  | { type: 'GET_ACTIVE_PRESET' }
  | { type: 'GET_PROMPT_INJECTION_SETTINGS' }
  | { type: 'SAVE_PROMPT_INJECTION_SETTINGS'; payload: Partial<PromptInjectionSettingsType> }
  | { type: 'GET_SAVED_ITEMS' }
  | { type: 'SAVE_SAVED_ITEM'; payload: SavedItemInput }
  | { type: 'DELETE_SAVED_ITEM'; payload: { id: string } }
  | { type: 'INSERT_SAVED_PROMPT_INTO_CHAT'; payload: { text: string } }
  | { type: 'GET_VOICE_SETTINGS' }
  | { type: 'SAVE_VOICE_SETTINGS'; payload: Partial<VoiceSettingsType> }
  | { type: 'GET_VOICE_CAPABILITIES' }
  | { type: 'GET_MCP_SERVERS' }
  | { type: 'GET_MCP_SERVER'; payload: { id: McpServerId } }
  | { type: 'CREATE_MCP_SERVER'; payload: McpServerCreateInput }
  | { type: 'UPDATE_MCP_SERVER'; payload: { id: McpServerId; patch: McpServerUpdateInput } }
  | { type: 'DELETE_MCP_SERVER'; payload: { id: McpServerId } }
  | { type: 'GET_MCP_TOOL_CACHE'; payload: { serverId: McpServerId } }
  | { type: 'REFRESH_MCP_SERVER_TOOLS'; payload: { serverId: McpServerId } }
  | { type: 'GET_MULTIMODAL_SETTINGS_STATUS' }
  | { type: 'SAVE_MULTIMODAL_SETTINGS'; payload: MultimodalSettingsPatchType }
  | { type: 'CLEAR_MULTIMODAL_SETTINGS' }
  | { type: 'ANALYZE_MULTIMODAL_MEDIA'; payload: MultimodalMediaAnalyzeRequestType }
  | { type: 'GET_TOOL_DESCRIPTORS' }
  | { type: 'REFRESH_TOOL_DESCRIPTORS' }
  | { type: 'CREATE_TOOL_AUTHORIZATION'; payload: { requestId: string; trigger: 'manual_chat' | 'agent_run'; chatSessionId: string | null; runId?: string; descriptorIds?: string[] } }
  | { type: 'CLOSE_TOOL_AUTHORIZATION'; payload: { authorizationId: string } }
  | { type: 'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK'; payload: { authorizationId: string; callId: string; invocationName: string; chunk: string } }
  | { type: 'EXECUTE_TOOL_CALL'; payload: ToolCall & { authorizationId?: string } }
  | { type: 'RUN_ARTIFACT_CODE'; payload: SandboxRunRequestType }
  | { type: 'GET_TOOL_CALL_HISTORY'; payload?: { limit?: number } }
  | { type: 'CLEAR_TOOL_CALL_HISTORY' }
  | { type: 'GET_PLATFORM_CAPABILITIES' }
  | { type: 'GET_PROJECT_CONTEXT_STATE' }
  | { type: 'CREATE_PROJECT_CONTEXT'; payload: ProjectContextCreateInput }
  | { type: 'UPDATE_PROJECT_CONTEXT'; payload: { projectId: string; patch: ProjectContextUpdateInput } }
  | { type: 'DELETE_PROJECT_CONTEXT'; payload: { projectId: string } }
  | { type: 'ADD_CONVERSATION_TO_PROJECT'; payload: { projectId: string; conversation: ProjectConversationInput } }
  | { type: 'REMOVE_CONVERSATION_FROM_PROJECT'; payload: { conversationId: string } }
  | { type: 'SET_PENDING_PROJECT_CONTEXT'; payload: { projectId: string | null } }
  | { type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' }
  | { type: 'GET_PROJECT_CONTEXT_FOR_CONVERSATION'; payload: { conversation: ProjectConversationInput; bindPendingProject?: boolean } }
  | { type: 'GET_ARTIFACT'; payload: { id: string } }
  | { type: 'GET_CONFIG' }
  | { type: 'GET_DEEPSEEK_THEME' }
  | { type: 'SET_DEEPSEEK_THEME'; payload: { theme: DeepSeekTheme } }
  | { type: 'GET_MODEL_TYPE' }
  | { type: 'SET_MODEL_TYPE'; payload: ModelType }
  | { type: 'RECORD_USAGE_TURN'; payload: UsageTurnInputType }
  | { type: 'GET_USAGE_SUMMARY'; payload?: { rangeDays?: UsageRangeDaysType } }
  | { type: 'CLEAR_USAGE_STATS' }
  | { type: 'GET_OFFICIAL_API_CHAT_CONFIG' }
  | { type: 'SAVE_OFFICIAL_API_CHAT_CONFIG'; payload: Partial<OfficialApiChatConfigType> }
  | { type: 'TOOL_CALL_EXECUTED'; payload: ToolCall }
  | { type: 'MEMORIES_UPDATED' }
  | { type: 'WEBDAV_TEST'; payload: SyncConfigDraft }
  | { type: 'WEBDAV_UPLOAD_LOCAL' }
  | { type: 'WEBDAV_DOWNLOAD_REMOTE' }
  | { type: 'SYNC_AUTHORIZE'; payload: SyncConfigDraft }
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
  reasoningText?: string;
}

export interface ChatStreamChunk {
  text: string;
  done: boolean;
  reasoningText?: string;
  phase?: 'reasoning' | 'answer';
}
