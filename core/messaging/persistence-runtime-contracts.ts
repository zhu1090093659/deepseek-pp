import type {
  ArtifactRecord,
  BackgroundConfig,
  CurrentDeepSeekConversation,
  DeepSeekTheme,
  GitHubSkillImportResult,
  GitHubSkillPreview,
  GitHubSkillSource,
  GitHubSkillUpdatePreview,
  LocalSkillImportResponse,
  LocalSkillPreview,
  Memory,
  MessageAction,
  ModelType,
  PetConfig,
  ProjectContext,
  ProjectContextState,
  ProjectConversation,
  SavedItem,
  Skill,
  SkillImportSource,
  SystemPromptPreset,
} from '../types';
import type { PromptInjectionSettings } from '../prompt/settings';
import type { VoiceCapabilityState, VoiceSettings } from '../voice/settings';

type DeclaredRuntimeRequest<TType extends MessageAction['type']> = Extract<
  MessageAction,
  { type: TType }
>;

type Ack = { ok: true };
type DomainFailure = { ok: false; error: string };

export interface PersistenceRuntimeCommandContracts {
  GET_MEMORIES: {
    request: DeclaredRuntimeRequest<'GET_MEMORIES'>;
    response: Memory[];
  };
  GET_MEMORY_BY_ID: {
    request: DeclaredRuntimeRequest<'GET_MEMORY_BY_ID'>;
    response: Memory | null;
  };
  SAVE_MEMORY: {
    request: DeclaredRuntimeRequest<'SAVE_MEMORY'>;
    response: { id: number };
  };
  IMPORT_MEMORY_DRAFTS: {
    request: DeclaredRuntimeRequest<'IMPORT_MEMORY_DRAFTS'>;
    response: { ok: true; ids: number[]; count: number } | DomainFailure;
  };
  UPDATE_MEMORY: {
    request: DeclaredRuntimeRequest<'UPDATE_MEMORY'>;
    response: Ack;
  };
  DELETE_MEMORY: {
    request: DeclaredRuntimeRequest<'DELETE_MEMORY'>;
    response: Ack;
  };
  TOUCH_MEMORIES: {
    request: { type: 'TOUCH_MEMORIES'; payload: { ids: number[] } };
    response: Ack;
  };
  GET_SKILLS: {
    request: DeclaredRuntimeRequest<'GET_SKILLS'>;
    response: Skill[];
  };
  GET_SKILL_LIBRARY: {
    request: DeclaredRuntimeRequest<'GET_SKILL_LIBRARY'>;
    response: Skill[];
  };
  GET_SKILL_SOURCES: {
    request: DeclaredRuntimeRequest<'GET_SKILL_SOURCES'>;
    response: SkillImportSource[];
  };
  GET_GITHUB_SKILL_SOURCES: {
    request: DeclaredRuntimeRequest<'GET_GITHUB_SKILL_SOURCES'>;
    response: GitHubSkillSource[];
  };
  SAVE_SKILL: {
    request: DeclaredRuntimeRequest<'SAVE_SKILL'>;
    response: Ack;
  };
  DELETE_SKILL: {
    request: DeclaredRuntimeRequest<'DELETE_SKILL'>;
    response: Ack;
  };
  SET_SKILL_ENABLED: {
    request: DeclaredRuntimeRequest<'SET_SKILL_ENABLED'>;
    response: Ack;
  };
  SET_SKILLS_ENABLED: {
    request: DeclaredRuntimeRequest<'SET_SKILLS_ENABLED'>;
    response: Ack;
  };
  PREVIEW_GITHUB_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'PREVIEW_GITHUB_SKILL_SOURCE'>;
    response: GitHubSkillPreview;
  };
  IMPORT_GITHUB_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'IMPORT_GITHUB_SKILL_SOURCE'>;
    response: GitHubSkillImportResult;
  };
  PREVIEW_LOCAL_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'PREVIEW_LOCAL_SKILL_SOURCE'>;
    response: LocalSkillPreview;
  };
  PICK_LOCAL_SKILL_FOLDER: {
    request: DeclaredRuntimeRequest<'PICK_LOCAL_SKILL_FOLDER'>;
    response: { path: string };
  };
  IMPORT_LOCAL_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'IMPORT_LOCAL_SKILL_SOURCE'>;
    response: LocalSkillImportResponse;
  };
  CHECK_GITHUB_SKILL_SOURCE_UPDATES: {
    request: DeclaredRuntimeRequest<'CHECK_GITHUB_SKILL_SOURCE_UPDATES'>;
    response: GitHubSkillUpdatePreview;
  };
  UPDATE_GITHUB_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'UPDATE_GITHUB_SKILL_SOURCE'>;
    response: GitHubSkillImportResult;
  };
  DELETE_GITHUB_SKILL_SOURCE: {
    request: DeclaredRuntimeRequest<'DELETE_GITHUB_SKILL_SOURCE'>;
    response: Ack;
  };
  GET_PRESETS: {
    request: DeclaredRuntimeRequest<'GET_PRESETS'>;
    response: SystemPromptPreset[];
  };
  SAVE_PRESET: {
    request: DeclaredRuntimeRequest<'SAVE_PRESET'>;
    response: Ack;
  };
  DELETE_PRESET: {
    request: DeclaredRuntimeRequest<'DELETE_PRESET'>;
    response: Ack;
  };
  SET_ACTIVE_PRESET: {
    request: DeclaredRuntimeRequest<'SET_ACTIVE_PRESET'>;
    response: Ack;
  };
  GET_ACTIVE_PRESET: {
    request: DeclaredRuntimeRequest<'GET_ACTIVE_PRESET'>;
    response: SystemPromptPreset | null;
  };
  GET_PROMPT_INJECTION_SETTINGS: {
    request: DeclaredRuntimeRequest<'GET_PROMPT_INJECTION_SETTINGS'>;
    response: PromptInjectionSettings;
  };
  SAVE_PROMPT_INJECTION_SETTINGS: {
    request: DeclaredRuntimeRequest<'SAVE_PROMPT_INJECTION_SETTINGS'>;
    response: PromptInjectionSettings;
  };
  GET_SAVED_ITEMS: {
    request: DeclaredRuntimeRequest<'GET_SAVED_ITEMS'>;
    response: SavedItem[];
  };
  SAVE_SAVED_ITEM: {
    request: DeclaredRuntimeRequest<'SAVE_SAVED_ITEM'>;
    response: SavedItem;
  };
  DELETE_SAVED_ITEM: {
    request: DeclaredRuntimeRequest<'DELETE_SAVED_ITEM'>;
    response: Ack;
  };
  INSERT_SAVED_PROMPT_INTO_CHAT: {
    request: DeclaredRuntimeRequest<'INSERT_SAVED_PROMPT_INTO_CHAT'>;
    response: Ack | DomainFailure;
  };
  GET_VOICE_SETTINGS: {
    request: DeclaredRuntimeRequest<'GET_VOICE_SETTINGS'>;
    response: VoiceSettings;
  };
  SAVE_VOICE_SETTINGS: {
    request: DeclaredRuntimeRequest<'SAVE_VOICE_SETTINGS'>;
    response: VoiceSettings;
  };
  GET_VOICE_CAPABILITIES: {
    request: DeclaredRuntimeRequest<'GET_VOICE_CAPABILITIES'>;
    response: VoiceCapabilityState;
  };
  GET_PROJECT_CONTEXT_STATE: {
    request: DeclaredRuntimeRequest<'GET_PROJECT_CONTEXT_STATE'>;
    response: ProjectContextState;
  };
  CREATE_PROJECT_CONTEXT: {
    request: DeclaredRuntimeRequest<'CREATE_PROJECT_CONTEXT'>;
    response: ProjectContext;
  };
  UPDATE_PROJECT_CONTEXT: {
    request: DeclaredRuntimeRequest<'UPDATE_PROJECT_CONTEXT'>;
    response: ProjectContext;
  };
  DELETE_PROJECT_CONTEXT: {
    request: DeclaredRuntimeRequest<'DELETE_PROJECT_CONTEXT'>;
    response: { ok: true; deletedMemories: number };
  };
  ADD_CONVERSATION_TO_PROJECT: {
    request: DeclaredRuntimeRequest<'ADD_CONVERSATION_TO_PROJECT'>;
    response: { ok: true; conversation: ProjectConversation };
  };
  REMOVE_CONVERSATION_FROM_PROJECT: {
    request: DeclaredRuntimeRequest<'REMOVE_CONVERSATION_FROM_PROJECT'>;
    response: Ack;
  };
  SET_PENDING_PROJECT_CONTEXT: {
    request: DeclaredRuntimeRequest<'SET_PENDING_PROJECT_CONTEXT'>;
    response: Ack;
  };
  GET_CURRENT_DEEPSEEK_CONVERSATION: {
    request: DeclaredRuntimeRequest<'GET_CURRENT_DEEPSEEK_CONVERSATION'>;
    response: { ok: true; conversation: CurrentDeepSeekConversation } | DomainFailure;
  };
  GET_PROJECT_CONTEXT_FOR_CONVERSATION: {
    request: DeclaredRuntimeRequest<'GET_PROJECT_CONTEXT_FOR_CONVERSATION'>;
    response: { projectId: string; context: string | null } | null;
  };
  GET_ARTIFACT: {
    request: DeclaredRuntimeRequest<'GET_ARTIFACT'>;
    response: { ok: true; artifact: ArtifactRecord } | { ok: false; error: 'artifact_not_found' };
  };
  GET_DEEPSEEK_THEME: {
    request: DeclaredRuntimeRequest<'GET_DEEPSEEK_THEME'>;
    response: DeepSeekTheme | null;
  };
  SET_DEEPSEEK_THEME: {
    request: DeclaredRuntimeRequest<'SET_DEEPSEEK_THEME'>;
    response: Ack | { ok: false; error: 'invalid_theme' };
  };
  GET_MODEL_TYPE: {
    request: DeclaredRuntimeRequest<'GET_MODEL_TYPE'>;
    response: ModelType;
  };
  SET_MODEL_TYPE: {
    request: DeclaredRuntimeRequest<'SET_MODEL_TYPE'>;
    response: Ack;
  };
  GET_BACKGROUND: {
    request: DeclaredRuntimeRequest<'GET_BACKGROUND'>;
    response: BackgroundConfig | null;
  };
  SAVE_BACKGROUND: {
    request: DeclaredRuntimeRequest<'SAVE_BACKGROUND'>;
    response: Ack;
  };
  CLEAR_BACKGROUND: {
    request: DeclaredRuntimeRequest<'CLEAR_BACKGROUND'>;
    response: Ack;
  };
  GET_PET: {
    request: DeclaredRuntimeRequest<'GET_PET'>;
    response: PetConfig;
  };
  SAVE_PET: {
    request: DeclaredRuntimeRequest<'SAVE_PET'>;
    response: Ack;
  };
  CLEAR_PET: {
    request: DeclaredRuntimeRequest<'CLEAR_PET'>;
    response: Ack;
  };
}
