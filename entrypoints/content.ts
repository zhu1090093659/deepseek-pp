import type {
  BackgroundConfig,
  DeepSeekTheme,
  Memory,
  ModelType,
  PetConfig,
  PetCustomPosition,
  PromptInjectionSettings,
  Skill,
  SystemPromptPreset,
  McpServerConfig,
  ToolCall,
  ToolCardResult,
  ToolCallRestoreRecord,
  ToolAuthorizationGrantSummary,
  ToolDescriptor,
  ToolExecutionRecord,
} from '../core/types';
import { normalizePetConfig } from '../core/pet/config';
import { pickPetLine, type PetState } from '../core/pet/lines';
import { createToolInvocationCatalog } from '../core/tool/invocation';
import { createLatestSyncGate, type LatestSyncLease } from '../core/tool/latest-sync';
import { DEFAULT_PROMPT_INJECTION_SETTINGS, normalizePromptInjectionSettings } from '../core/prompt/settings';
import { normalizeBackgroundConfig } from '../core/background/config';
import {
  LEGACY_TOOL_CALLS_OPEN_TAG,
  stripToolCalls,
} from '../core/interceptor/tool-parser';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { containsInternalPromptMarker, sanitizeInternalPromptText } from '../core/prompt';
import { createRestoredArtifactToolResult } from '../core/artifact';
import type { ResponseCompletePayload, ResponseTokenSpeedPayload } from '../core/interceptor/fetch-hook';
import { shouldIgnoreEmptyTokenSpeedProgress } from '../core/interceptor/token-speed';
import { runInlineAgentLoop } from '../core/inline-agent/loop';
import {
  INCOMPLETE_TOOL_CALL_ERROR_CODE,
  selectContinuableToolExecutions,
} from '../core/inline-agent/execution-policy';
import {
  INLINE_AGENT_CONTINUATION_PLACEHOLDER,
  isInlineAgentContinuationRequest,
  isInlineAgentContinuationStructure,
  normalizeInlineAgentFinalAnswerText,
  replaceTaskCompleteBlocks,
} from '../core/inline-agent/prompt';
import type {
  InlineAgentStartPayload,
  InlineAgentStreamChunkMsg,
  InlineAgentStepCompleteMsg,
  InlineAgentLoopCompleteMsg,
  InlineAgentLoopErrorMsg,
  InlineAgentTraceRecord,
  InlineAgentTraceStepRecord,
} from '../core/inline-agent/types';
import {
  injectInlineAgentStyles,
  createAgentContainer,
  createAgentStepElement,
  updateStepStreamText,
  updateStepStatus,
  addToolResultToStep,
  createAgentFooter,
} from '../core/inline-agent/renderer';
import { renderInlineMarkdown } from '../core/inline-agent/markdown';
import {
  createTranslator,
  DEFAULT_LOCALE,
  type LocaleMessageKey,
  type MessageParams,
  type SupportedLocale,
} from '../core/i18n';
import {
  getResolvedLocaleState,
  watchLocalePreference,
} from '../core/i18n/store';
import {
  registerDefaultToolResultRenderers,
  renderToolResultWithRegistry,
} from '../core/ui/tool-result-renderer';
import { injectInjectedThemeStyles } from '../core/ui/injected-theme';
import {
  findPromptTextarea,
  insertTextIntoPromptTextarea,
} from '../core/ui/prompt-text-insertion';
import {
  normalizeRestoredToolExecution,
  sanitizeToolExecutionForRestoreStorage,
} from '../core/tool/execution-restore';
import {
  chainExternalizedPayloadWrite,
  isExternalizedToolPayloadCall,
} from '../core/tool/externalized-payload';
import {
  createToolRestoreBlockId,
  createToolRestoreBlockUrl,
} from '../core/tool/restore-block';
import { PendingRequestRegistry } from '../core/tool/pending-request-registry';
import { PendingAuthorizationCorrelations } from '../core/tool/pending-authorization-correlations';
import { shouldRequestWebFetchPermission } from '../core/tool/web-fetch-permission';
import {
  BRIDGE_HANDSHAKE_TYPES,
  BRIDGE_READY_TYPE,
  BRIDGE_SOURCES,
  createBridgeSessionController,
  isBridgeHandshakeMessage,
  validateBridgeMessage,
  type BridgeSessionController,
  type BridgeSessionContext,
} from '../core/messaging/schema';
import {
  BACKGROUND_RUNTIME_PATHNAMES,
  createExtensionRuntimeMessageContext,
  createRuntimeBoundaryErrorResponse,
  decodeRuntimeMessageEnvelope,
} from '../core/messaging/runtime-boundary';
import { isToolDescriptorRecord } from '../core/messaging/tool-record-codec';
import { startDeepSeekHistoryOrganizer, type HistoryOrganizerController } from './content/adapters/history-organizer';
import { startDeepSeekProjectSidebarOrganizer, type ProjectSidebarOrganizerController } from './content/adapters/project-sidebar-organizer';
import { startContentUxPolish, type ContentUxPolishController } from './content/adapters/ux-polish';
import {
  MULTIMODAL_MEDIA_IMAGE_MAX_BYTES,
  MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN,
  MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES,
  buildMultimodalAnalysisPrompt,
  hasDeepSeekChatSessionRoute,
  selectMultimodalMediaRouteKeyForRequest,
  shouldPreserveInitialMultimodalMediaRoute,
  type MultimodalMediaAnalyzeResponse,
  type MultimodalMediaInput,
  type MultimodalMediaKind,
} from '../core/multimodal/media';
import {
  calculateMultimodalRequestAugmentationTimeoutMs,
  canUseMultimodalMediaInput,
} from '../core/multimodal';

import { buildDeepSeekSessionUrl, createClientHeaders, rememberDeepSeekClientHeaders, saveClientHeadersToStorage } from '../core/deepseek/adapter';
import type {
  ConversationExportArtifact,
  ConversationExportProgress,
  ConversationExportResult,
} from '../core/export/types';
import type { ToolCallPayloadChunk } from '../core/interceptor/streaming-tool-call-parser';

const TOOL_BLOCK_ID = 'dpp-tool-block';
const TOOL_BLOCK_STYLE_ID = 'dpp-tool-block-css';
const ASSISTANT_RESPONSE_CONTENT_SELECTOR = '._74c0879, .ds-assistant-message-main-content';
const REASONING_HOST_META_RE = /\b(?:reason|reasoning|think|thinking|thought)\b/i;
const REASONING_HOST_TEXT_RE = /^(?:已(?:深度)?思考|深度思考|思考过程|思考中|正在思考|thinking|reasoning|thought)(?:[\s（(:：]|$)/i;
const REASONING_HOST_ANCESTOR_SCAN_DEPTH = 4;
const TOKEN_SPEED_BADGE_ID = 'dpp-token-speed-badge';
const TOKEN_SPEED_STYLE_ID = 'dpp-token-speed-css';
const MULTIMODAL_MEDIA_BUTTON_ID = 'dpp-multimodal-media-button';
const MULTIMODAL_MEDIA_FILE_INPUT_ID = 'dpp-multimodal-media-file-input';
const MULTIMODAL_MEDIA_TRAY_ID = 'dpp-multimodal-media-tray';
const MULTIMODAL_MEDIA_STATUS_ID = 'dpp-multimodal-media-status';
const MULTIMODAL_MEDIA_STYLE_ID = 'dpp-multimodal-media-css';
const EXPORT_ACTION_CLASS = 'dpp-export-action';
const EXPORT_ACTION_STYLE_ID = 'dpp-export-action-css';
const EXPORT_ACTION_TOAST_CLASS = 'dpp-export-toast';
const CONTENT_TOAST_CLASS = 'dpp-content-toast';
const CONTENT_TOAST_STYLE_ID = 'dpp-content-toast-css';
const EXPORT_ACTION_MENU_CLASS = 'dpp-export-menu';
const DEEPSEEK_ACTION_CONTROL_SELECTOR = 'button, [role="button"].ds-button';
const EXPORT_ACTION_MOUNT_DEBOUNCE_MS = 250;
const EXPORT_ACTION_RETRY_MS = 250;
const EXPORT_ACTION_RETRY_LIMIT = 20;
const EXPORT_ACTION_TOAST_VISIBLE_MS = 4000;
const PET_HOST_ID = 'dpp-pet-host';
const PET_STYLE_ID = 'dpp-pet-css';
const TOKEN_SPEED_BOOTSTRAP_RETRY_MS = 250;
const TOKEN_SPEED_BOOTSTRAP_RETRY_LIMIT = 40;
const TOKEN_SPEED_MOUNT_DEBOUNCE_MS = 500;
const MULTIMODAL_MEDIA_MOUNT_DEBOUNCE_MS = 250;
const TOKEN_SPEED_ROUTE_CHECK_MS = 500;
const TOOL_BLOCK_ROUTE_CHECK_MS = 500;
const TOOL_RESTORE_STORAGE_KEY = 'dpp_tool_execution_blocks';
const INLINE_AGENT_TRACE_STORAGE_KEY = 'dpp_inline_agent_traces';
const INLINE_AGENT_TRACE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const INLINE_AGENT_TRACE_LIMIT = 100;
const INLINE_AGENT_TRACE_WRITE_DEBOUNCE_MS = 300;
const INLINE_AGENT_STEP_RENDER_MAX_CHARS = 8000;
const INLINE_AGENT_FINAL_RENDER_MAX_CHARS = 12000;
const CLEANABLE_TEXT_DEEP_SCAN_MAX_CHARS = 120_000;
const CLEANUP_MESSAGE_SCAN_LIMIT = 24;
const THEME_BOOTSTRAP_RETRY_MS = 250;
const THEME_BOOTSTRAP_RETRY_LIMIT = 20;
const PET_IDLE_DELAY_MS = 900;
const PET_SIDE_OFFSET_PX = 24;
const PET_BOTTOM_OFFSET_PX = 92;
const PET_CUSTOM_EDGE_MARGIN_PX = 12;
const PET_HEIGHT_RATIO = 1;
const PET_FEEDBACK_DELAY_MS = 1400;
const PET_SLEEP_DELAY_MS = 12000;
const PET_SPRITE_PATH = 'pet/deepseek-whale-pet-states.png';
const DEEPSEEK_POW_WASM_PATH = 'deepseek/sha3_wasm_bg.wasm';
const MAIN_WORLD_SOURCE = BRIDGE_SOURCES.mainWorld;
const CONTENT_SOURCE = BRIDGE_SOURCES.content;
const BRIDGE_REQUEST_TYPE = BRIDGE_HANDSHAKE_TYPES.request;
const BRIDGE_INIT_TYPE = BRIDGE_HANDSHAKE_TYPES.init;
const PET_BUBBLE_VISIBLE_MS = 6000;
const PET_BUBBLE_REPEAT_MIN_MS = 8000;
const PET_BUBBLE_REPEAT_MAX_MS = 12000;
const PET_BUBBLE_RECENT_LIMIT = 3;
type ExportResponse = ConversationExportResult | { ok: false; exportId?: string; error: string };
interface ResolvedProjectAugmentationContext {
  projectId: string;
  context: string | null;
}

interface ConversationExportFormatOption {
  format: ConversationExportArtifact['format'];
  labelKey: LocaleMessageKey;
  defaultChecked: boolean;
}

const CONVERSATION_EXPORT_FORMAT_OPTIONS: ConversationExportFormatOption[] = [
  { format: 'html', labelKey: 'content.export.formatHtml', defaultChecked: true },
  { format: 'markdown', labelKey: 'content.export.formatMarkdown', defaultChecked: false },
  { format: 'pdf', labelKey: 'content.export.formatPdf', defaultChecked: false },
  { format: 'image_manifest', labelKey: 'content.export.formatImageManifest', defaultChecked: false },
];
// These states keep rotating pet lines during long stays; other states speak once on entry.
const PET_BUBBLE_LOOPING_STATES: ReadonlySet<PetState> = new Set<PetState>([
  'idle',
  'thinking',
  'speaking',
  'working',
]);

interface PetDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
}

interface PersistedToolBlock extends ToolCallRestoreRecord {
  source: 'storage';
  url: string;
  createdAt: number;
}

interface ActiveToolBlockSession {
  id: string;
  url: string;
  chatSessionId: string | null;
  requestId: string | null;
  parentMessageId: number | null;
  content: string;
  executions: ToolExecutionRecord[];
  createdAt: number;
  updatedAt: number;
}

interface PendingStartedToolCall {
  call: ToolCall;
  session: ActiveToolBlockSession;
}

interface PendingMultimodalMedia {
  id: string;
  kind: MultimodalMediaKind;
  file: File;
  name: string;
  mimeType: string;
  sizeBytes: number;
  objectUrl: string | null;
  routeKey: string;
  createdAt: number;
}

let toolExecutions: ToolExecutionRecord[] = [];
let toolBlockEl: HTMLElement | null = null;
let activeToolBlockSessionId: string | null = null;
let activeStreamingToolCount = 0;
const activeToolBlockSessions = new Map<string, ActiveToolBlockSession>();
const pendingExternalToolPayloadWrites = new Map<string, Promise<void>>();
const activeToolAuthorizations = new Map<string, ToolAuthorizationGrantSummary>();
const toolAuthorizationRequestAliases = new Map<string, string>();
const pendingToolAuthorizationCorrelations = new PendingAuthorizationCorrelations();
const pendingToolExecutionTasksByRequest = new Map<string, Set<Promise<ToolCardResult>>>();
const pendingStartedToolCallsByRequest = new PendingRequestRegistry<PendingStartedToolCall>();
let responseGeneration = 0;
let tokenSpeedEl: HTMLElement | null = null;
let tokenSpeedBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
let tokenSpeedBootstrapAttempts = 0;
let tokenSpeedMountObserver: MutationObserver | null = null;
let tokenSpeedMountTimer: ReturnType<typeof setTimeout> | null = null;
let lastTokenSpeedProgress: ResponseTokenSpeedPayload = createIdleTokenSpeedProgress();
let tokenSpeedRouteKey = '';
let tokenSpeedRouteTimer: ReturnType<typeof setInterval> | null = null;
const recordedUsageProgressSignatures = new Map<string, string>();
let multimodalMediaObserver: MutationObserver | null = null;
let multimodalMediaMountTimer: ReturnType<typeof setTimeout> | null = null;
let multimodalMediaButtonEl: HTMLButtonElement | null = null;
let multimodalMediaFileInputEl: HTMLInputElement | null = null;
let multimodalMediaTrayEl: HTMLElement | null = null;
let multimodalMediaStatusEl: HTMLElement | null = null;
let multimodalMediaBusy = false;
let multimodalMediaInputEnabled = false;
const pendingMultimodalMedia = new Map<string, PendingMultimodalMedia>();
let toolBlockRouteKey = '';
let toolBlockRouteTimer: ReturnType<typeof setInterval> | null = null;
let exportActionObserver: MutationObserver | null = null;
let exportActionMountTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionRetryTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionRetryAttempts = 0;
let activeConversationExportId: string | null = null;
let exportActionToastTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionMenuEl: HTMLElement | null = null;
let exportActionMenuButton: HTMLButtonElement | null = null;
let exportActionMenuSessionId: string | null = null;
let historyOrganizerController: HistoryOrganizerController | null = null;
let projectSidebarOrganizerController: ProjectSidebarOrganizerController | null = null;
let contentUxPolishController: ContentUxPolishController | null = null;
const restoredToolRecords = new Map<string, ToolCallRestoreRecord>();
let restoredRenderTimer: ReturnType<typeof setTimeout> | null = null;
let restoredRenderAttempts = 0;
const pendingToolExecutionTasks = new Set<Promise<ToolCardResult>>();
let backgroundPatchObserver: MutationObserver | null = null;
let themeObserver: MutationObserver | null = null;
let themeTreeObserver: MutationObserver | null = null;
let themeMediaQuery: MediaQueryList | null = null;
let themeMediaListener: ((event: MediaQueryListEvent) => void) | null = null;
let themeSyncTimer: ReturnType<typeof setTimeout> | null = null;
let themeBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
let themeBootstrapAttempts = 0;
let currentDeepSeekTheme: DeepSeekTheme | null = null;
let currentPetConfig: PetConfig | null = null;
let petHostEl: HTMLElement | null = null;
let petIdleTimer: ReturnType<typeof setTimeout> | null = null;
let petSleepTimer: ReturnType<typeof setTimeout> | null = null;
let petDragState: PetDragState | null = null;
let petResizeListenerInstalled = false;
let petBubbleEl: HTMLElement | null = null;
let petBubbleTextEl: HTMLElement | null = null;
let petBubbleHideTimer: ReturnType<typeof setTimeout> | null = null;
let petBubbleRepeatTimer: ReturnType<typeof setTimeout> | null = null;
let petBubbleState: PetState | null = null;
const petRecentLines: string[] = [];
let inlineAgentContainer: HTMLElement | null = null;
let inlineAgentCurrentStep: HTMLElement | null = null;
let inlineAgentLoopId: string | null = null;
let inlineAgentContainerObserver: MutationObserver | null = null;
let inlineAgentContinuationMessageObserver: MutationObserver | null = null;
let activeInlineAgentTrace: InlineAgentTraceRecord | null = null;
let inlineAgentTraceWriteTimer: ReturnType<typeof setTimeout> | null = null;
let inlineAgentStreamRenderFrame: number | null = null;
let pendingInlineAgentStreamChunk: InlineAgentStreamChunkMsg | null = null;
const restoredInlineAgentTraces = new Map<string, InlineAgentTraceRecord>();
let restoredInlineAgentRenderTimer: ReturnType<typeof setTimeout> | null = null;
let restoredInlineAgentRenderAttempts = 0;
let currentMemories: Memory[] = [];
let currentSkills: Skill[] = [];
let currentActivePreset: SystemPromptPreset | null = null;
let currentModelType: ModelType = null;
let currentPromptSettings: PromptInjectionSettings = DEFAULT_PROMPT_INJECTION_SETTINGS;
let currentContentLocale: SupportedLocale = DEFAULT_LOCALE;
let currentContentTranslator = createTranslator(DEFAULT_LOCALE);
let currentToolDescriptors: ToolDescriptor[] = [];
const toolDescriptorSyncGate = createLatestSyncGate();
let currentRequestMessageCount = 0;
let mainWorldPort: MessagePort | null = null;
let mainWorldBridgeReady = false;
let activeAgentAbort: AbortController | null = null;
let toolOpenTagRe = buildToolOpenTagRegex(currentToolDescriptors);
let toolMarkerRe = buildToolMarkerRegex(currentToolDescriptors);
let extensionContextValid = true;

function contentT(key: LocaleMessageKey, params?: MessageParams): string {
  return currentContentTranslator.t(key, params);
}

async function refreshContentLocale(): Promise<void> {
  const resolved = await getResolvedLocaleState();
  currentContentLocale = resolved.locale;
  currentContentTranslator = createTranslator(resolved.locale);
  refreshLocalizedContentSurfaces();
}

function refreshLocalizedContentSurfaces(): void {
  setConversationExportButtonsStatus(activeConversationExportId ? 'running' : 'idle');
  if (exportActionMenuEl && exportActionMenuButton) {
    showConversationExportMenu(exportActionMenuButton);
  }
  historyOrganizerController?.refreshLabels();
  projectSidebarOrganizerController?.refreshLabels();
  contentUxPolishController?.refreshLabels();
  renderTokenSpeedIndicator(lastTokenSpeedProgress);
  renderActiveToolBlockForCurrentRoute();
  scheduleRenderRestoredToolBlocks();
  scheduleRenderRestoredInlineAgentTraces();
  renderMultimodalMediaTray();
}

function getAgentRendererLabels() {
  return {
    step: (stepNumber: number) => contentT('content.agent.step', { index: stepNumber }),
    streaming: contentT('content.agent.streaming'),
    stop: contentT('content.agent.stop'),
    footerComplete: (totalSteps: number, totalTools: number) =>
      contentT('content.agent.footerComplete', { steps: totalSteps, tools: totalTools }),
    footerError: (totalSteps: number, totalTools: number) =>
      contentT('content.agent.footerError', { steps: totalSteps, tools: totalTools }),
  };
}

function getHistoryOrganizerLabels() {
  return {
    enhancedSearchTitle: contentT('content.historyOrganizer.enhancedSearchTitle'),
    tagFilterLabel: contentT('content.historyOrganizer.tagFilterLabel'),
    tagPlaceholder: contentT('content.historyOrganizer.tagPlaceholder'),
    currentTagsLabel: contentT('content.historyOrganizer.currentTagsLabel'),
    currentTagsPlaceholder: contentT('content.historyOrganizer.currentTagsPlaceholder'),
    emptySearchStatus: contentT('content.historyOrganizer.emptySearchStatus'),
    visibleStatus: (visibleCount: number, totalCount: number) =>
      contentT('content.historyOrganizer.visibleStatus', { visible: visibleCount, total: totalCount }),
    storageError: (action: 'load' | 'save', message: string) =>
      contentT(
        action === 'load'
          ? 'content.historyOrganizer.loadError'
          : 'content.historyOrganizer.saveError',
        { message },
      ),
  };
}

function getProjectSidebarOrganizerLabels() {
  return {
    title: contentT('content.projectSidebar.title'),
    empty: contentT('content.projectSidebar.empty'),
    expandProject: (name: string) => contentT('content.projectSidebar.expandProject', { name }),
    collapseProject: (name: string) => contentT('content.projectSidebar.collapseProject', { name }),
    showMore: contentT('content.projectSidebar.showMore'),
    showLess: contentT('content.projectSidebar.showLess'),
    moveCurrentToProject: (name: string) => contentT('content.projectSidebar.moveCurrentToProject', { name }),
    removeCurrentFromProject: (name: string) => contentT('content.projectSidebar.removeCurrentFromProject', { name }),
    joinProject: contentT('content.projectSidebar.joinProject'),
    joinProjectNamed: (name: string) => contentT('content.projectSidebar.joinProjectNamed', { name }),
    moveToProjectNamed: (name: string) => contentT('content.projectSidebar.moveToProjectNamed', { name }),
    currentProjectNamed: (name: string) => contentT('content.projectSidebar.currentProjectNamed', { name }),
    removeFromProjectNamed: (name: string) => contentT('content.projectSidebar.removeFromProjectNamed', { name }),
    conversationActions: contentT('content.projectSidebar.conversationActions'),
    newConversationInProject: (name: string) => contentT('content.projectSidebar.newConversationInProject', { name }),
    useNextConversation: (name: string) => contentT('content.projectSidebar.useNextConversation', { name }),
    cancelNextConversation: (name: string) => contentT('content.projectSidebar.cancelNextConversation', { name }),
    pendingNextConversation: contentT('content.projectSidebar.pendingNextConversation'),
    untitledConversation: contentT('content.conversation.untitled'),
    operationFailed: (message: string) => contentT('content.projectSidebar.operationFailed', { message }),
    age: (timestamp: number) => formatContentAge(timestamp),
  };
}

function getContentUxPolishLabels() {
  return {
    codeDownloadButton: contentT('content.uxPolish.downloadCode'),
    messageMarkdownButton: contentT('content.uxPolish.downloadMessageMarkdownButton'),
    messageMarkdownTitle: contentT('content.uxPolish.downloadMessageMarkdownTitle'),
  };
}

function formatContentAge(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return contentT('content.projectSidebar.age.justNow');
  if (mins < 60) return contentT('content.projectSidebar.age.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return contentT('content.projectSidebar.age.hoursAgo', { count: hours });
  return contentT('content.projectSidebar.age.daysAgo', { count: Math.floor(hours / 24) });
}

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {
    registerDefaultToolResultRenderers();
    await refreshContentLocale();
    watchLocalePreference(() => {
      void refreshContentLocale()
        .then(() => loadAndSyncRuntimeState())
        .catch((error) => console.error('[DeepSeek++] content locale refresh failed', error));
    });
    installExtensionInvalidationGuards();
    installMainWorldBridge();

    const handleMainWorldMessage = async (data: any) => {
      if (data?.source !== MAIN_WORLD_SOURCE) return;
      try {
        switch (data.type) {
          case 'TOOL_CALL_STARTED': {
            const call = data.data as ToolCall;
            showPendingToolExecution(call);
            break;
          }
          case 'TOOL_CALL': {
            const call = ensureToolCallId(data.data as ToolCall);
            setPetState('working');
            void runToolExecution(call);
            break;
          }
          case 'TOOL_CALL_CHUNK': {
            await appendExternalToolPayloadChunk(data.data as ToolCallPayloadChunk);
            break;
          }
          case 'RESTORE_TOOL_CALLS': {
            rememberRestoredToolRecords(data.records as ToolCallRestoreRecord[]);
            break;
          }
          case 'MEMORIES_USED': {
            const ids = data.ids as number[];
            await sendRuntimeMessage({ type: 'TOUCH_MEMORIES', payload: { ids } });
            break;
          }
          case 'HEADERS_CAPTURED': {
            await persistDeepSeekClientHeaders(normalizeCapturedClientHeaders(data.headers));
            break;
          }
          case 'RESPONSE_COMPLETE': {
            const complete = normalizeResponseCompletePayload(data.payload, data.text);
            const gen = ++responseGeneration;
            activeStreamingToolCount = 0;
            await waitForPendingToolExecutions(complete.requestId);
            await finalizeInterruptedToolStarts(complete.requestId);
            if (gen !== responseGeneration) break;
            const session = getActiveToolBlockSessionForComplete(complete);
            const completedExecutions = session ? [...session.executions] : [...toolExecutions];
            if (session && session.executions.length > 0) {
              await persistToolBlockSession(session, complete.text, complete);
              const renderedBlock = (findRestoredToolBlock(session.id) as HTMLElement | null) ?? toolBlockEl;
              collapseToolBlock(renderedBlock);
              activeToolBlockSessions.delete(session.id);
              if (activeToolBlockSessionId === session.id) {
                activeToolBlockSessionId = null;
                toolExecutions = [];
                toolBlockEl = null;
              }
            } else if (toolExecutions.length > 0) {
              const fallbackSession = getCurrentRouteActiveToolBlockSession();
              if (fallbackSession) {
                await persistToolBlockSession(fallbackSession, complete.text, complete);
              }
              collapseToolBlock(toolBlockEl);
              toolExecutions = [];
              toolBlockEl = null;
            }
            void startInlineAgentIfNeeded(complete, completedExecutions);
            schedulePetIdle();
            break;
          }
          case 'REQUEST_TERMINAL': {
            const requestId = data.payload?.requestId;
            if (typeof requestId === 'string') {
              if (
                activeToolAuthorizations.has(requestId) ||
                toolAuthorizationRequestAliases.has(requestId)
              ) {
                pendingToolAuthorizationCorrelations.terminate(requestId);
                await waitForPendingToolExecutions(requestId);
                await finalizeInterruptedToolStarts(requestId);
                await closeContentToolAuthorization(requestId);
              } else {
                pendingToolAuthorizationCorrelations.terminate(requestId);
              }
            }
            break;
          }
          case 'RESPONSE_TOKEN_SPEED': {
            const progress = normalizeResponseTokenSpeedPayload(data.payload);
            if (progress) {
              updateTokenSpeedIndicator(progress);
              updatePetFromTokenSpeed(progress);
            }
            break;
          }
        }
      } catch (error) {
        if (isExtensionInvalidatedError(error)) {
          invalidateExtensionContext();
        } else {
          console.error('[DeepSeek++] main-world message handling failed', error);
        }
      }
    };

    setMainWorldMessageHandler(handleMainWorldMessage);

    void loadAndSyncRuntimeState();

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    startDeepSeekThemeSync();
    startTokenSpeedIndicatorBootstrap();
    startTokenSpeedIndicatorMountObserver();
    startTokenSpeedRouteWatcher();
    startToolBlockRouteWatcher();
    void refreshMultimodalMediaInputAvailability();
    startConversationExportActionInjector();
    historyOrganizerController = startDeepSeekHistoryOrganizer(getHistoryOrganizerLabels);
    projectSidebarOrganizerController = startDeepSeekProjectSidebarOrganizer(getProjectSidebarOrganizerLabels);
    contentUxPolishController = startContentUxPolish(getContentUxPolishLabels);

    startRenderedToolCallCleaner();
    startInlineAgentContinuationMessageHider();
    void restorePersistedToolBlocks();
    void restorePersistedInlineAgentTraces();

    sendRuntimeMessage<BackgroundConfig | null>({ type: 'GET_BACKGROUND' }).then((cfg) => {
      applyBackground(cfg ?? null);
    });
    sendRuntimeMessage<PetConfig | null>({ type: 'GET_PET' }).then((cfg) => {
      applyPetConfig(cfg ?? null);
    });

    addRuntimeMessageListener((message, sender, sendResponse) => {
      let envelope;
      try {
        envelope = decodeRuntimeMessageEnvelope(message);
        createExtensionRuntimeMessageContext(sender, {
          runtimeId: chrome.runtime.id,
          extensionOrigin: chrome.runtime.getURL('/'),
          allowedPathnames: BACKGROUND_RUNTIME_PATHNAMES,
        });
      } catch (error) {
        sendResponse(createRuntimeBoundaryErrorResponse(error, envelope));
        return false;
      }
      if (message.type === 'STATE_UPDATED') {
        syncToMainWorld(
          message.memories,
          message.skills,
          message.activePreset,
          message.modelType,
          currentToolDescriptors,
          normalizePromptInjectionSettings(message.promptSettings),
        );
      } else if (message.type === 'TOOL_DESCRIPTORS_UPDATED') {
        const syncLease = toolDescriptorSyncGate.begin();
        try {
          const descriptors = decodeToolDescriptors(message.toolDescriptors);
          syncLease.commit(() => syncToMainWorld(
            currentMemories,
            currentSkills,
            currentActivePreset,
            currentModelType,
            descriptors,
            currentPromptSettings,
          ));
        } catch (error) {
          syncLease.commit(() => reportToolDescriptorSyncFailure(error));
        }
      } else if (message.type === 'MCP_SERVERS_UPDATED') {
        if (Array.isArray(message.servers)) {
          setMultimodalMediaInputEnabled(shouldEnableMultimodalMediaInput(message.servers));
        } else {
          void refreshMultimodalMediaInputAvailability();
        }
        void refreshToolDescriptorsFromBackground();
      } else if (message.type === 'BACKGROUND_UPDATED') {
        applyBackground(message.config as BackgroundConfig | null);
      } else if (message.type === 'PET_UPDATED') {
        applyPetConfig(message.config as PetConfig | null);
      } else if (message.type === 'REFRESH_DEEPSEEK_AUTH') {
        persistDeepSeekClientHeaders()
          .then((hasToken) => sendResponse({ ok: hasToken, hasToken }))
          .catch((error) => sendResponse({
            ok: false,
            hasToken: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        return true;
      } else if (message.type === 'DEEPSEEK_EXPORT_PROGRESS') {
        updateConversationExportProgress(message.progress as ConversationExportProgress | undefined);
      } else if (message.type === 'INSERT_PROMPT_TEXT') {
        const text = typeof message.text === 'string' ? message.text : '';
        sendResponse(insertPromptText(text));
        return true;
      } else if (message.type === 'GET_CURRENT_DEEPSEEK_CONVERSATION') {
        const conversationId = getCurrentChatSessionId();
        sendResponse(conversationId
          ? {
            ok: true,
            conversation: {
              conversationId,
              title: getCurrentConversationTitle(),
              url: location.href,
            },
          }
          : { ok: false, error: 'no_current_conversation' });
        return true;
      }
      return undefined;
    });
  },
});

let mainWorldMessageHandler: ((data: any) => void | Promise<void>) | null = null;
const pendingMainWorldMessages: Record<string, unknown>[] = [];
let mainWorldBridgeSessions: BridgeSessionController | null = null;

function setMainWorldMessageHandler(handler: (data: any) => void | Promise<void>): void {
  mainWorldMessageHandler = handler;
}

function installMainWorldBridge(): void {
  mainWorldBridgeSessions = createBridgeSessionController(window.location.origin);
  window.addEventListener('pagehide', () => disconnectMainWorldPort());
  window.addEventListener('message', (event) => {
    if (!isBridgeHandshakeMessage({
      value: event.data,
      actualOrigin: event.origin,
      expectedOrigin: window.location.origin,
      expectedSource: MAIN_WORLD_SOURCE,
      expectedType: BRIDGE_REQUEST_TYPE,
      alreadyConnected: Boolean(mainWorldPort),
      actualWindowSource: event.source,
      expectedWindowSource: window,
      actualTopLevel: window === window.top,
      requireTopLevel: true,
    })) return;
    connectMainWorldPort();
  });
}

function connectMainWorldPort(): void {
  if (mainWorldPort) return;

  const channel = new MessageChannel();
  const bridgeSession = mainWorldBridgeSessions?.open(
    crypto.randomUUID(),
    window.location.origin,
    window === window.top,
  );
  if (!bridgeSession) return;
  mainWorldPort = channel.port1;
  mainWorldPort.onmessage = (event) => {
    void handleMainWorldPortMessage(event.data, bridgeSession);
  };
  mainWorldPort.onmessageerror = () => {
    console.error('[DeepSeek++] main-world bridge message could not be decoded');
  };
  mainWorldPort.start();

  window.postMessage(
    { source: CONTENT_SOURCE, type: BRIDGE_INIT_TYPE },
    window.location.origin,
    [channel.port2],
  );
}

async function handleMainWorldPortMessage(
  data: unknown,
  bridgeSession: BridgeSessionContext,
): Promise<void> {
  if (!mainWorldBridgeSessions?.accepts(
    bridgeSession,
    window.location.origin,
    window === window.top,
  )) return;

  const message = validateBridgeMessage(data, MAIN_WORLD_SOURCE);
  if (!message) return;

  if (message.type === BRIDGE_READY_TYPE) {
    mainWorldBridgeReady = true;
    flushMainWorldMessages();
    syncCurrentRuntimeStateToMainWorld();
    return;
  }

  if (message.type === 'SYNC_HOOK_STATE_REQUEST') {
    syncCurrentRuntimeStateToMainWorld();
    return;
  }

  if (message.type === 'AUGMENT_REQUEST_BODY') {
    await handleAugmentRequestBody(message);
    return;
  }

  await mainWorldMessageHandler?.(message);
}

function disconnectMainWorldPort(bridgeSession?: BridgeSessionContext): void {
  if (!mainWorldBridgeSessions?.close(bridgeSession)) return;
  pendingToolAuthorizationCorrelations.terminateAll();
  void closeAllContentToolAuthorizations().catch((error) => {
    console.error('[DeepSeek++] failed to close tool authorizations on bridge disconnect', error);
  });
  mainWorldPort?.close();
  mainWorldPort = null;
  mainWorldBridgeReady = false;
  pendingMainWorldMessages.length = 0;
}

async function handleAugmentRequestBody(data: {
  id?: unknown;
  requestId?: unknown;
  body?: unknown;
}): Promise<void> {
  const id = typeof data.id === 'string' ? data.id : '';
  const mainRequestId = typeof data.requestId === 'string' ? data.requestId : '';
  if (!id) return;

  let authorization: ToolAuthorizationGrantSummary | null = null;
  let requestId = '';
  let tracksPendingAlias = false;
  try {
    if (typeof data.body !== 'string') {
      throw new Error('Request body must be a string.');
    }
    if (!mainRequestId) {
      throw new Error('Request authorization identity is missing.');
    }
    if (
      toolAuthorizationRequestAliases.has(mainRequestId) ||
      !pendingToolAuthorizationCorrelations.begin(mainRequestId)
    ) {
      throw new Error('Request authorization correlation is already active.');
    }
    tracksPendingAlias = true;
    requestId = crypto.randomUUID();

    const bodyWithMultimodalMedia = await consumePendingMultimodalMediaForRequest(data.body, {
      onLongRunning(timeoutMs) {
        postToMainWorld({
          type: 'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
          id,
          timeoutMs,
        });
      },
    });
    authorization = await createContentToolAuthorization({
      requestId,
      trigger: 'manual_chat',
      chatSessionId: readRequestChatSessionId(bodyWithMultimodalMedia),
    });
    activeToolAuthorizations.set(requestId, authorization);
    toolAuthorizationRequestAliases.set(mainRequestId, requestId);
    const project = await resolveProjectContextForRequestBody(bodyWithMultimodalMedia);
    const result = augmentRequestBody(bodyWithMultimodalMedia, {
      memories: currentMemories,
      skills: currentSkills,
      activePreset: currentActivePreset,
      projectContext: project?.context ?? null,
      projectId: project?.projectId ?? null,
      modelType: currentModelType,
      toolDescriptors: authorization.descriptors,
      messageCount: currentRequestMessageCount,
      locale: currentContentLocale,
      promptSettings: currentPromptSettings,
    });

    if (result) {
      currentRequestMessageCount = result.messageCount;
      if (result.usedMemoryIds.length > 0) {
        await sendRuntimeMessage({ type: 'TOUCH_MEMORIES', payload: { ids: result.usedMemoryIds } });
      }
    } else {
      await closeContentToolAuthorization(requestId);
    }

    const requestAlreadyEnded = pendingToolAuthorizationCorrelations.activate(mainRequestId);
    tracksPendingAlias = false;
    if (requestAlreadyEnded) {
      throw new Error('Request ended before its tool authorization became active.');
    }

    postToMainWorld({
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id,
      ok: true,
      result: result
        ? {
            body: result.body,
            agentTaskPrompt: result.agentTaskPrompt,
            requestId,
            toolDescriptors: authorization.descriptors,
          }
        : null,
    });
  } catch (error) {
    if (authorization) await closeContentToolAuthorization(requestId);
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
      postToMainWorld({
        type: 'AUGMENT_REQUEST_BODY_RESULT',
        id,
        ok: true,
        result: null,
      });
      return;
    }

    postToMainWorld({
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (tracksPendingAlias) {
      pendingToolAuthorizationCorrelations.finish(mainRequestId);
    }
  }
}

async function resolveProjectContextForRequestBody(bodyStr: string): Promise<ResolvedProjectAugmentationContext | null> {
  let body: { chat_session_id?: unknown; parent_message_id?: unknown; prompt?: unknown };
  try {
    body = JSON.parse(bodyStr) as { chat_session_id?: unknown; parent_message_id?: unknown; prompt?: unknown };
  } catch {
    return null;
  }

  const sessionId = typeof body.chat_session_id === 'string' && body.chat_session_id.trim()
    ? body.chat_session_id.trim()
    : getCurrentChatSessionId();
  if (!sessionId) return null;

  const bindPendingProject = body.parent_message_id === null;
  const project = await sendRuntimeMessageStrict<ResolvedProjectAugmentationContext | null>({
    type: 'GET_PROJECT_CONTEXT_FOR_CONVERSATION',
    payload: {
      bindPendingProject,
      conversation: {
        conversationId: sessionId,
        title: getCurrentConversationTitle(),
        url: buildDeepSeekSessionUrl(sessionId),
      },
    },
  });
  return project ?? null;
}

function readRequestChatSessionId(bodyStr: string): string | null {
  try {
    const body = JSON.parse(bodyStr) as { chat_session_id?: unknown };
    return typeof body.chat_session_id === 'string' && body.chat_session_id.trim()
      ? body.chat_session_id.trim()
      : getCurrentChatSessionId();
  } catch {
    return getCurrentChatSessionId();
  }
}

async function createContentToolAuthorization(input: {
  requestId: string;
  trigger: 'manual_chat' | 'agent_run';
  chatSessionId: string | null;
  runId?: string;
  descriptorIds?: string[];
}): Promise<ToolAuthorizationGrantSummary> {
  return sendRuntimeMessageStrict<ToolAuthorizationGrantSummary>({
    type: 'CREATE_TOOL_AUTHORIZATION',
    payload: input,
  });
}

async function closeContentToolAuthorization(requestId: string): Promise<void> {
  const authoritativeRequestId = activeToolAuthorizations.has(requestId)
    ? requestId
    : toolAuthorizationRequestAliases.get(requestId);
  if (!authoritativeRequestId) return;
  const authorization = activeToolAuthorizations.get(authoritativeRequestId);
  if (!authorization) return;
  if (!hasLiveExtensionContext()) {
    removeLocalToolAuthorization(authoritativeRequestId, authorization.id);
    return;
  }
  try {
    await sendRuntimeMessageStrict({
      type: 'CLOSE_TOOL_AUTHORIZATION',
      payload: { authorizationId: authorization.id },
    });
    removeLocalToolAuthorization(authoritativeRequestId, authorization.id);
  } catch (error) {
    if (!isExtensionInvalidatedError(error)) throw error;
    invalidateExtensionContext();
    removeLocalToolAuthorization(authoritativeRequestId, authorization.id);
  }
}

function removeLocalToolAuthorization(requestId: string, authorizationId: string): void {
  activeToolAuthorizations.delete(requestId);
  for (const key of pendingExternalToolPayloadWrites.keys()) {
    if (key.startsWith(`${authorizationId}:`)) pendingExternalToolPayloadWrites.delete(key);
  }
  for (const [alias, target] of toolAuthorizationRequestAliases) {
    if (target === requestId) toolAuthorizationRequestAliases.delete(alias);
  }
}

async function closeAllContentToolAuthorizations(): Promise<void> {
  await Promise.all([...activeToolAuthorizations.keys()].map(async (requestId) => {
    await waitForPendingToolExecutions(requestId);
    await finalizeInterruptedToolStarts(requestId);
    await closeContentToolAuthorization(requestId);
  }));
}

function postToMainWorld(message: Record<string, unknown>): void {
  if (!mainWorldPort || !mainWorldBridgeReady) {
    pendingMainWorldMessages.push(message);
    return;
  }
  mainWorldPort.postMessage({ source: CONTENT_SOURCE, ...message });
}

function flushMainWorldMessages(): void {
  if (!mainWorldPort || !mainWorldBridgeReady) return;
  while (pendingMainWorldMessages.length > 0) {
    const message = pendingMainWorldMessages.shift()!;
    mainWorldPort.postMessage({ source: CONTENT_SOURCE, ...message });
  }
}

async function loadAndSyncRuntimeState(
  syncLease: LatestSyncLease = toolDescriptorSyncGate.begin(),
): Promise<void> {
  const descriptorResultPromise = (async () => {
    try {
      const value = await sendRuntimeMessageStrict<ToolDescriptor[]>({
        type: 'GET_TOOL_DESCRIPTORS',
      });
      return { ok: true as const, descriptors: decodeToolDescriptors(value) };
    } catch (error) {
      return { ok: false as const, error };
    }
  })();

  const runtimeStateSync = Promise.all([
    sendRuntimeMessage<Memory[]>({ type: 'GET_MEMORIES' }),
    sendRuntimeMessage<Skill[]>({ type: 'GET_SKILLS' }),
    sendRuntimeMessage<SystemPromptPreset | null>({ type: 'GET_ACTIVE_PRESET' }),
    sendRuntimeMessage<ModelType>({ type: 'GET_MODEL_TYPE' }),
    sendRuntimeMessage<PromptInjectionSettings>({ type: 'GET_PROMPT_INJECTION_SETTINGS' }),
  ]).then(
    ([memories, skills, activePreset, modelType, promptSettings]) => syncToMainWorld(
      memories ?? [],
      skills ?? [],
      activePreset ?? null,
      modelType ?? null,
      currentToolDescriptors,
      normalizePromptInjectionSettings(promptSettings),
    ),
    (error: unknown) => console.error('[DeepSeek++] runtime state sync failed', error),
  );

  const descriptorSync = descriptorResultPromise.then((descriptorResult) => {
    if (descriptorResult.ok) {
      syncLease.commit(() => syncToMainWorld(
        currentMemories,
        currentSkills,
        currentActivePreset,
        currentModelType,
        descriptorResult.descriptors,
        currentPromptSettings,
      ));
    } else {
      syncLease.commit(() => reportToolDescriptorSyncFailure(descriptorResult.error));
    }
  });

  await Promise.all([runtimeStateSync, descriptorSync]);
}

async function refreshToolDescriptorsFromBackground(): Promise<void> {
  const syncLease = toolDescriptorSyncGate.begin();
  try {
    const descriptors = decodeToolDescriptors(
      await sendRuntimeMessageStrict<ToolDescriptor[]>({ type: 'GET_TOOL_DESCRIPTORS' }),
    );
    syncLease.commit(() => syncToMainWorld(
      currentMemories,
      currentSkills,
      currentActivePreset,
      currentModelType,
      descriptors,
      currentPromptSettings,
    ));
  } catch (error) {
    syncLease.commit(() => reportToolDescriptorSyncFailure(error));
  }
}

function hasLiveExtensionContext(): boolean {
  if (!extensionContextValid) return false;

  try {
    if (typeof chrome === 'undefined') {
      invalidateExtensionContext();
      return false;
    }
    const runtime = chrome.runtime;
    if (!runtime?.id || typeof runtime.sendMessage !== 'function') {
      invalidateExtensionContext();
      return false;
    }
    return true;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
    return false;
  }
}

function installExtensionInvalidationGuards() {
  const suppressInvalidation = (event: PromiseRejectionEvent | ErrorEvent) => {
    const error = 'reason' in event ? event.reason : event.error ?? event.message;
    if (!isExtensionInvalidatedError(error)) return;
    invalidateExtensionContext();
    event.preventDefault();
  };

  window.addEventListener('unhandledrejection', suppressInvalidation);
  window.addEventListener('error', suppressInvalidation);
}

function isExtensionInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Extension context invalidated') ||
    message.includes('context invalidated') ||
    message.includes('Extension context is unavailable');
}

function invalidateExtensionContext() {
  if (!extensionContextValid) return;
  extensionContextValid = false;
  backgroundPatchObserver?.disconnect();
  backgroundPatchObserver = null;
  removePet();
  stopDeepSeekThemeSync();
  if (restoredRenderTimer) {
    clearTimeout(restoredRenderTimer);
    restoredRenderTimer = null;
  }
  if (restoredInlineAgentRenderTimer) {
    clearTimeout(restoredInlineAgentRenderTimer);
    restoredInlineAgentRenderTimer = null;
  }
  if (inlineAgentTraceWriteTimer) {
    clearTimeout(inlineAgentTraceWriteTimer);
    inlineAgentTraceWriteTimer = null;
  }
  cancelPendingInlineAgentStreamRender();
  stopTokenSpeedIndicatorBootstrap();
  stopTokenSpeedIndicatorMountObserver();
  stopTokenSpeedRouteWatcher();
  stopToolBlockRouteWatcher();
  stopMultimodalMediaInput();
  removeTokenSpeedIndicator();
  stopConversationExportActionInjector();
  historyOrganizerController?.stop();
  historyOrganizerController = null;
  projectSidebarOrganizerController?.stop();
  projectSidebarOrganizerController = null;
  contentUxPolishController?.stop();
  contentUxPolishController = null;
}

/** Isolated world writes captured DeepSeek request headers to chrome.storage. */
async function persistDeepSeekClientHeaders(capturedHeaders?: Record<string, string> | null): Promise<boolean> {
  try {
    const headers = capturedHeaders ?? createClientHeaders();
    if (headers) {
      rememberDeepSeekClientHeaders(headers);
      const saved = await saveClientHeadersToStorage();
      if (!saved) return false;
      // Ask the sidepanel to re-check login status.
      chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED' }).catch(() => {});
      return true;
    }
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
  }
  return false;
}

function startConversationExportActionInjector() {
  injectConversationExportActionStyles();
  mountConversationExportActions();

  exportActionObserver?.disconnect();
  exportActionObserver = new MutationObserver(() => scheduleConversationExportActionMount());
  exportActionObserver.observe(document.body, { childList: true, subtree: true });
  armConversationExportActionRetry();
}

function stopConversationExportActionInjector() {
  exportActionObserver?.disconnect();
  exportActionObserver = null;
  clearConversationExportActionTimers();
  closeConversationExportMenu();
  document.querySelectorAll(`.${EXPORT_ACTION_CLASS}, .${EXPORT_ACTION_TOAST_CLASS}`)
    .forEach((el) => el.remove());
  document.getElementById(EXPORT_ACTION_STYLE_ID)?.remove();
}

function clearConversationExportActionTimers() {
  if (exportActionMountTimer) {
    clearTimeout(exportActionMountTimer);
    exportActionMountTimer = null;
  }
  if (exportActionRetryTimer) {
    clearTimeout(exportActionRetryTimer);
    exportActionRetryTimer = null;
  }
  if (exportActionToastTimer) {
    clearTimeout(exportActionToastTimer);
    exportActionToastTimer = null;
  }
}

function scheduleConversationExportActionMount() {
  if (exportActionMountTimer) return;
  exportActionMountTimer = setTimeout(() => {
    exportActionMountTimer = null;
    mountConversationExportActions();
  }, EXPORT_ACTION_MOUNT_DEBOUNCE_MS);
}

function armConversationExportActionRetry() {
  if (exportActionRetryAttempts >= EXPORT_ACTION_RETRY_LIMIT) return;
  if (exportActionRetryTimer) clearTimeout(exportActionRetryTimer);
  exportActionRetryTimer = setTimeout(() => {
    exportActionRetryTimer = null;
    exportActionRetryAttempts += 1;
    const mountedCount = mountConversationExportActions();
    if (mountedCount === 0) armConversationExportActionRetry();
  }, EXPORT_ACTION_RETRY_MS);
}

function mountConversationExportActions(): number {
  const sessionId = getCurrentChatSessionId();
  closeConversationExportMenuIfSessionChanged(sessionId);
  if (!sessionId) {
    removeConversationExportActions();
    return 0;
  }

  const messages = getAssistantExportMessages();
  const mountedRows = new Set<HTMLElement>();
  let mountedCount = 0;

  for (const message of messages) {
    const officialRow = findAssistantMessageActionRow(message);
    if (officialRow) {
      ensureConversationExportButton(officialRow, sessionId);
      mountedRows.add(officialRow);
      mountedCount += 1;
    }
  }

  for (const row of findGlobalAssistantActionRows()) {
    if (mountedRows.has(row)) continue;
    ensureConversationExportButton(row, sessionId);
    mountedRows.add(row);
    mountedCount += 1;
  }

  renderTokenSpeedIndicator(lastTokenSpeedProgress);
  return mountedCount;
}

function removeConversationExportActions() {
  document.querySelectorAll(`.${EXPORT_ACTION_CLASS}`)
    .forEach((el) => el.remove());
  removeTokenSpeedIndicator();
}

function getAssistantExportMessages(): Element[] {
  return Array.from(document.querySelectorAll('.ds-message'))
    .filter((message) => getAssistantContentHosts(message).length > 0);
}

function findAssistantMessageActionRow(message: Element): HTMLElement | null {
  const responseHost = getAssistantResponseHost(message);
  const controls = getDeepSeekActionControls(message)
    .filter((control) => isOfficialActionControlCandidate(control, responseHost));

  for (const control of controls) {
    const row = findCompactActionRow(control, message, responseHost);
    if (row) return row;
  }

  return null;
}

function getDeepSeekActionControls(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(DEEPSEEK_ACTION_CONTROL_SELECTOR));
}

function isOfficialActionControlCandidate(control: HTMLElement, responseHost: Element): boolean {
  if (control.classList.contains(EXPORT_ACTION_CLASS)) return false;
  if (responseHost.contains(control)) return false;
  if (control.closest('.dpp-tool-block, .dpp-agent-container')) return false;
  if (!isVisibleElement(control)) return false;

  const rect = control.getBoundingClientRect();
  if (rect.width > 64 || rect.height > 64) return false;
  return true;
}

function findCompactActionRow(
  control: HTMLElement,
  message: Element,
  responseHost: Element,
): HTMLElement | null {
  let el: HTMLElement | null = control.parentElement;
  let depth = 0;
  while (el && el !== message && depth < 6) {
    const rowControls = getDeepSeekActionControls(el)
      .filter((candidate) => isOfficialActionControlCandidate(candidate, responseHost));
    if (rowControls.length >= 4 && isCompactActionRow(el, responseHost)) return el;
    el = el.parentElement;
    depth += 1;
  }
  return null;
}

function isCompactActionRow(row: HTMLElement, responseHost: Element): boolean {
  const rowRect = row.getBoundingClientRect();
  const responseRect = responseHost.getBoundingClientRect();
  if (rowRect.width === 0 || rowRect.height === 0) return false;
  if (rowRect.height > 72) return false;
  if (responseRect.height > 0 && rowRect.top < responseRect.bottom - 12) return false;
  return true;
}

function findGlobalAssistantActionRows(): HTMLElement[] {
  const rows = new Set<HTMLElement>();
  const controls = getDeepSeekActionControls(document)
    .filter(isGlobalActionControlCandidate);

  for (const control of controls) {
    const row = findGlobalCompactActionRow(control);
    if (row) rows.add(row);
  }

  return [...rows].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

function isGlobalActionControlCandidate(control: HTMLElement): boolean {
  if (control.classList.contains(EXPORT_ACTION_CLASS)) return false;
  if (control.closest('.dpp-tool-block, .dpp-agent-container')) return false;
  if (control.closest('aside, nav, header, [role="navigation"], [role="banner"]')) return false;
  if (findDeepSeekInputBox()?.contains(control)) return false;
  if (!isVisibleElement(control)) return false;

  const rect = control.getBoundingClientRect();
  if (rect.width > 64 || rect.height > 64) return false;
  if (rect.left < getConversationViewportLeft()) return false;

  const textarea = getPromptTextarea();
  const textareaTop = textarea?.getBoundingClientRect().top ?? window.innerHeight;
  if (rect.bottom >= textareaTop - 12) return false;
  return true;
}

function findGlobalCompactActionRow(control: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = control.parentElement;
  let depth = 0;
  while (el && el !== document.body && depth < 6) {
    const rowControls = getDeepSeekActionControls(el)
      .filter(isGlobalActionControlCandidate);
    if (rowControls.length >= 4 && isLikelyReplyActionRow(el, rowControls)) return el;
    el = el.parentElement;
    depth += 1;
  }
  return null;
}

function isLikelyReplyActionRow(row: HTMLElement, rowControls: HTMLElement[]): boolean {
  const rowRect = row.getBoundingClientRect();
  if (rowRect.width === 0 || rowRect.height === 0) return false;
  if (rowRect.height > 72) return false;

  const textarea = getPromptTextarea();
  const textareaTop = textarea?.getBoundingClientRect().top ?? window.innerHeight;
  if (rowRect.bottom >= textareaTop - 12) return false;

  const sortedControls = rowControls
    .map((control) => control.getBoundingClientRect())
    .sort((a, b) => a.left - b.left);
  const first = sortedControls[0];
  const last = sortedControls[sortedControls.length - 1];
  if (!first || !last) return false;
  return last.right - first.left <= 260;
}

function getConversationViewportLeft(): number {
  const textarea = getPromptTextarea();
  const inputBox = findDeepSeekInputBox();
  const rect = (inputBox ?? textarea)?.getBoundingClientRect();
  if (rect?.left && rect.left > 0) return Math.max(180, rect.left - 80);
  return 180;
}

function ensureConversationExportButton(row: HTMLElement, sessionId: string): HTMLButtonElement {
  let button = row.querySelector<HTMLButtonElement>(`:scope > .${EXPORT_ACTION_CLASS}`);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = EXPORT_ACTION_CLASS;
    button.innerHTML = createConversationExportActionIcon();
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (activeConversationExportId) return;
      toggleConversationExportMenu(button!);
    });
  }

  placeConversationExportButton(row, button);
  button.dataset.dppExportSessionId = sessionId;
  applyConversationExportButtonStatus(button, activeConversationExportId ? 'running' : 'idle');
  return button;
}

function placeConversationExportButton(row: HTMLElement, button: HTMLButtonElement): void {
  const officialControls = getDeepSeekActionControls(row)
    .filter((control) => !control.classList.contains(EXPORT_ACTION_CLASS) && isVisibleElement(control))
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  const lastOfficialControl = officialControls[officialControls.length - 1];

  if (!lastOfficialControl || lastOfficialControl.parentElement !== row) {
    if (button.parentElement !== row) row.appendChild(button);
    return;
  }

  if (lastOfficialControl.nextElementSibling !== button) {
    lastOfficialControl.insertAdjacentElement('afterend', button);
  }
}

function applyConversationExportButtonStatus(button: HTMLButtonElement, status: 'idle' | 'running') {
  const running = status === 'running';
  button.disabled = running;
  button.dataset.status = status;
  button.title = running ? contentT('content.export.buttonRunning') : contentT('content.export.buttonIdle');
  button.setAttribute('aria-label', button.title);
}

function setConversationExportButtonsStatus(status: 'idle' | 'running') {
  document.querySelectorAll<HTMLButtonElement>(`.${EXPORT_ACTION_CLASS}`)
    .forEach((button) => applyConversationExportButtonStatus(button, status));
}

function toggleConversationExportMenu(button: HTMLButtonElement) {
  if (exportActionMenuEl && exportActionMenuButton === button) {
    closeConversationExportMenu();
    return;
  }
  showConversationExportMenu(button);
}

function showConversationExportMenu(button: HTMLButtonElement) {
  closeConversationExportMenu();

  const sessionId = getCurrentChatSessionId();
  if (!sessionId) {
    showConversationExportToast(contentT('content.export.emptyConversation'), 'error');
    return;
  }

  const menu = document.createElement('div');
  menu.className = EXPORT_ACTION_MENU_CLASS;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', contentT('content.export.formatDialogLabel'));
  menu.addEventListener('click', (event) => event.stopPropagation());

  const form = document.createElement('form');
  const title = document.createElement('div');
  title.className = 'dpp-export-menu-title';
  title.textContent = contentT('content.export.formatTitle');
  form.appendChild(title);

  for (const option of CONVERSATION_EXPORT_FORMAT_OPTIONS) {
    const label = document.createElement('label');
    label.className = 'dpp-export-menu-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'format';
    input.value = option.format;
    input.checked = option.defaultChecked;
    const text = document.createElement('span');
    text.textContent = contentT(option.labelKey);
    label.append(input, text);
    form.appendChild(label);
  }

  const actions = document.createElement('div');
  actions.className = 'dpp-export-menu-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = contentT('common.cancel');
  cancel.addEventListener('click', () => closeConversationExportMenu());
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = contentT('content.export.submit');
  actions.append(cancel, submit);
  form.appendChild(actions);

  form.addEventListener('change', () => {
    submit.disabled = getSelectedConversationExportFormats(menu).length === 0;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formats = getSelectedConversationExportFormats(menu);
    if (formats.length === 0) return;
    closeConversationExportMenu();
    void startCurrentConversationExport(formats);
  });

  menu.appendChild(form);
  document.body.appendChild(menu);
  exportActionMenuEl = menu;
  exportActionMenuButton = button;
  exportActionMenuSessionId = sessionId;
  positionConversationExportMenu(menu, button);
  document.addEventListener('click', handleConversationExportMenuDocumentClick, true);
  document.addEventListener('keydown', handleConversationExportMenuKeydown, true);
}

function positionConversationExportMenu(menu: HTMLElement, button: HTMLButtonElement) {
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const belowTop = buttonRect.bottom + gap;
  const aboveTop = buttonRect.top - menuRect.height - gap;
  const top = belowTop + menuRect.height <= window.innerHeight - margin
    ? belowTop
    : Math.max(margin, aboveTop);
  const left = Math.min(
    window.innerWidth - menuRect.width - margin,
    Math.max(margin, buttonRect.left + buttonRect.width / 2 - menuRect.width / 2),
  );
  menu.style.top = `${Math.round(top)}px`;
  menu.style.left = `${Math.round(left)}px`;
}

function getSelectedConversationExportFormats(menu: HTMLElement): ConversationExportArtifact['format'][] {
  return Array.from(menu.querySelectorAll<HTMLInputElement>('input[name="format"]:checked'))
    .map((input) => input.value)
    .filter(isConversationExportUiFormat);
}

function isConversationExportUiFormat(value: string): value is ConversationExportArtifact['format'] {
  return CONVERSATION_EXPORT_FORMAT_OPTIONS.some((option) => option.format === value);
}

function closeConversationExportMenu() {
  document.removeEventListener('click', handleConversationExportMenuDocumentClick, true);
  document.removeEventListener('keydown', handleConversationExportMenuKeydown, true);
  exportActionMenuEl?.remove();
  exportActionMenuEl = null;
  exportActionMenuButton = null;
  exportActionMenuSessionId = null;
}

function closeConversationExportMenuIfSessionChanged(sessionId = getCurrentChatSessionId()) {
  if (!exportActionMenuEl) return;
  if (sessionId === exportActionMenuSessionId) return;
  closeConversationExportMenu();
}

function handleConversationExportMenuDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (exportActionMenuEl?.contains(target)) return;
  if (exportActionMenuButton?.contains(target)) return;
  closeConversationExportMenu();
}

function handleConversationExportMenuKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  closeConversationExportMenu();
}

async function startCurrentConversationExport(
  selectedFormats: ConversationExportArtifact['format'][] = ['html'],
) {
  if (activeConversationExportId) return;
  const sessionId = getCurrentChatSessionId();
  if (!sessionId) {
    showConversationExportToast(contentT('content.export.emptyConversation'), 'error');
    return;
  }

  const formats = dedupeConversationExportUiFormats(selectedFormats);
  const exportId = crypto.randomUUID();
  activeConversationExportId = exportId;
  setConversationExportButtonsStatus('running');
  showConversationExportToast(contentT('content.export.progress'), 'info');

  try {
    const response = await sendConversationExportRequest(exportId, sessionId, formats);
    if (!response?.ok) {
      throw new Error(response?.error ?? contentT('content.export.failed'));
    }

    for (const artifact of response.artifacts) {
      if (formats.includes(artifact.format)) {
        downloadConversationExportArtifact(artifact);
      }
    }

    const warning = response.summary.failedSessionCount > 0;
    showConversationExportToast(
      warning
        ? contentT('content.export.partialSuccess')
        : getConversationExportSuccessMessage(formats),
      warning ? 'warning' : 'success',
    );
  } catch (error) {
    showConversationExportToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    if (activeConversationExportId === exportId) {
      activeConversationExportId = null;
      setConversationExportButtonsStatus('idle');
    }
  }
}

function dedupeConversationExportUiFormats(formats: ConversationExportArtifact['format'][]): ConversationExportArtifact['format'][] {
  const values = formats.filter(isConversationExportUiFormat);
  const deduped = values.filter((format, index) => values.indexOf(format) === index);
  return deduped.length > 0 ? deduped : ['html'];
}

function getConversationExportSuccessMessage(formats: ConversationExportArtifact['format'][]): string {
  if (formats.includes('pdf')) {
    return contentT('content.export.success');
  }
  return contentT('content.export.success');
}

async function sendConversationExportRequest(
  exportId: string,
  sessionId: string,
  formats: ConversationExportArtifact['format'][],
): Promise<ExportResponse | undefined> {
  if (!hasLiveExtensionContext()) return undefined;
  try {
    return await chrome.runtime.sendMessage({
      type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
      payload: {
        exportId,
        request: {
          mode: 'sanitized',
          formats,
          includeAttachmentMetadata: true,
          includeFileBodies: false,
          sessionIds: [sessionId],
        },
      },
    }) as ExportResponse;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
      return undefined;
    }
    throw error;
  }
}

function updateConversationExportProgress(progress: ConversationExportProgress | undefined) {
  if (!progress || progress.exportId !== activeConversationExportId) return;
  if (progress.status === 'running') {
    setConversationExportButtonsStatus('running');
  }
}

function getCurrentChatSessionId(): string | null {
  const match = location.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function getCurrentConversationTitle(): string {
  const title = document.title
    .replace(/\s*[-|]\s*DeepSeek.*$/i, '')
    .trim();
  return title || contentT('content.conversation.untitled');
}

async function refreshMultimodalMediaInputAvailability() {
  try {
    const servers = await sendRuntimeMessageStrict<McpServerConfig[]>({ type: 'GET_MCP_SERVERS' });
    setMultimodalMediaInputEnabled(shouldEnableMultimodalMediaInput(servers));
  } catch (error) {
    setMultimodalMediaInputEnabled(false);
    if (hasLiveExtensionContext()) {
      console.warn('[DeepSeek++] Failed to load MCP servers for multimodal media input.', error);
    }
  }
}

function shouldEnableMultimodalMediaInput(servers: unknown): boolean {
  return Array.isArray(servers) &&
    servers.some((server) => Boolean(server && typeof server === 'object') &&
      canUseMultimodalMediaInput(server as McpServerConfig));
}

function setMultimodalMediaInputEnabled(enabled: boolean) {
  if (multimodalMediaInputEnabled === enabled) {
    if (enabled) mountMultimodalMediaControls();
    return;
  }

  multimodalMediaInputEnabled = enabled;
  if (enabled) {
    startMultimodalMediaInput();
    return;
  }
  stopMultimodalMediaInput();
}

function startMultimodalMediaInput() {
  if (!multimodalMediaInputEnabled) return;
  injectMultimodalMediaStyles();
  mountMultimodalMediaControls();

  multimodalMediaObserver?.disconnect();
  multimodalMediaObserver = new MutationObserver(() => scheduleMultimodalMediaMount());
  multimodalMediaObserver.observe(document.body, { childList: true, subtree: true });
  document.removeEventListener('paste', handleMultimodalMediaPaste, true);
  document.addEventListener('paste', handleMultimodalMediaPaste, true);
}

function stopMultimodalMediaInput() {
  multimodalMediaObserver?.disconnect();
  multimodalMediaObserver = null;
  if (multimodalMediaMountTimer) {
    clearTimeout(multimodalMediaMountTimer);
    multimodalMediaMountTimer = null;
  }
  document.removeEventListener('paste', handleMultimodalMediaPaste, true);
  removeMultimodalMediaControls();
  clearPendingMultimodalMedia();
  document.getElementById(MULTIMODAL_MEDIA_STYLE_ID)?.remove();
}

function scheduleMultimodalMediaMount() {
  if (!multimodalMediaInputEnabled) return;
  if (multimodalMediaMountTimer) return;
  multimodalMediaMountTimer = setTimeout(() => {
    multimodalMediaMountTimer = null;
    mountMultimodalMediaControls();
  }, MULTIMODAL_MEDIA_MOUNT_DEBOUNCE_MS);
}

function mountMultimodalMediaControls() {
  if (!multimodalMediaInputEnabled) {
    removeMultimodalMediaControls();
    return;
  }
  injectMultimodalMediaStyles();
  const inputBox = findDeepSeekInputBox();
  if (!inputBox) return;

  if (multimodalMediaButtonEl?.isConnected && multimodalMediaButtonEl.parentElement === inputBox) {
    updateMultimodalMediaButtonPlacement(inputBox);
    if (multimodalMediaTrayEl) placeMultimodalMediaTray(inputBox, multimodalMediaTrayEl);
    renderMultimodalMediaTray();
    return;
  }

  removeMultimodalMediaControls({ keepMedia: true });
  inputBox.setAttribute('data-dpp-multimodal-media-anchor', '');

  const fileInput = document.createElement('input');
  fileInput.id = MULTIMODAL_MEDIA_FILE_INPUT_ID;
  fileInput.type = 'file';
  fileInput.accept = 'image/*,video/*';
  fileInput.multiple = true;
  fileInput.className = 'dpp-mm-file-input';
  fileInput.addEventListener('click', stopMultimodalMediaFileInputEvent, true);
  fileInput.addEventListener('input', stopMultimodalMediaFileInputEvent, true);
  fileInput.addEventListener('change', (event) => {
    stopMultimodalMediaFileInputEvent(event);
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void addPendingMultimodalFiles(files, 'picker');
  }, true);

  const button = document.createElement('button');
  button.id = MULTIMODAL_MEDIA_BUTTON_ID;
  button.type = 'button';
  button.className = 'dpp-mm-button';
  button.title = contentT('content.multimodalMedia.buttonTitle');
  button.setAttribute('aria-label', contentT('content.multimodalMedia.buttonTitle'));
  button.innerHTML = createMultimodalMediaButtonIcon();
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openMultimodalMediaPicker(fileInput);
  });

  const tray = document.createElement('div');
  tray.id = MULTIMODAL_MEDIA_TRAY_ID;
  tray.className = 'dpp-mm-tray';

  const status = document.createElement('div');
  status.id = MULTIMODAL_MEDIA_STATUS_ID;
  status.className = 'dpp-mm-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  tray.append(status);
  document.body.append(fileInput);
  placeMultimodalMediaTray(inputBox, tray);
  inputBox.append(button);
  multimodalMediaFileInputEl = fileInput;
  multimodalMediaButtonEl = button;
  multimodalMediaTrayEl = tray;
  multimodalMediaStatusEl = status;
  updateMultimodalMediaButtonPlacement(inputBox);
  renderMultimodalMediaTray();
}

function placeMultimodalMediaTray(inputBox: HTMLElement, tray: HTMLElement) {
  const parent = inputBox.parentElement;
  if (!parent) return;
  if (tray.parentElement === parent && tray.nextElementSibling === inputBox) return;
  parent.insertBefore(tray, inputBox);
}

async function openMultimodalMediaPicker(fileInput: HTMLInputElement) {
  const picker = getBrowserFilePicker();
  if (!picker) {
    fileInput.click();
    return;
  }

  try {
    const handles = await picker({
      multiple: true,
      excludeAcceptAllOption: false,
      types: [
        {
          description: 'Images and videos',
          accept: {
            'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
            'video/*': ['.mp4', '.mov', '.webm', '.m4v'],
          },
        },
      ],
    });
    const files = await Promise.all(handles.map((handle) => handle.getFile()));
    await addPendingMultimodalFiles(files, 'picker');
  } catch (error) {
    if (isFilePickerAbort(error)) return;
    throw error;
  }
}

function getBrowserFilePicker(): ((options: {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}) => Promise<Array<{ getFile(): Promise<File> }>>) | null {
  const candidate = (window as Window & {
    showOpenFilePicker?: (options: {
      multiple?: boolean;
      excludeAcceptAllOption?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<Array<{ getFile(): Promise<File> }>>;
  }).showOpenFilePicker;
  return typeof candidate === 'function' ? candidate.bind(window) : null;
}

function isFilePickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function stopMultimodalMediaFileInputEvent(event: Event) {
  if (event.type !== 'click') event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function removeMultimodalMediaControls(options: { keepMedia?: boolean } = {}) {
  const parent = multimodalMediaButtonEl?.parentElement ?? multimodalMediaTrayEl?.parentElement;
  multimodalMediaButtonEl?.remove();
  multimodalMediaFileInputEl?.remove();
  multimodalMediaTrayEl?.remove();
  multimodalMediaStatusEl?.remove();
  parent?.removeAttribute('data-dpp-multimodal-media-anchor');
  parent?.removeAttribute('data-dpp-multimodal-media-has-native');
  parent?.removeAttribute('data-dpp-multimodal-media-has-items');
  multimodalMediaButtonEl = null;
  multimodalMediaFileInputEl = null;
  multimodalMediaTrayEl = null;
  multimodalMediaStatusEl = null;
  if (!options.keepMedia) clearPendingMultimodalMedia();
}

function updateMultimodalMediaButtonPlacement(inputBox: HTMLElement) {
  inputBox.setAttribute(
    'data-dpp-multimodal-media-has-native',
    hasNativePromptAttachmentButton(inputBox) ? 'true' : 'false',
  );
}

function hasNativePromptAttachmentButton(inputBox: HTMLElement): boolean {
  const inputRect = inputBox.getBoundingClientRect();
  const buttons = Array.from(inputBox.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter((button) => button.id !== MULTIMODAL_MEDIA_BUTTON_ID)
    .filter((button) => {
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const centerX = rect.left + rect.width / 2;
      return centerX > inputRect.right - 220;
    });
  return buttons.length >= 2;
}

function renderMultimodalMediaTray() {
  if (!multimodalMediaTrayEl?.isConnected) return;
  const items = getCurrentRoutePendingMultimodalMedia();
  const anchor = multimodalMediaButtonEl?.parentElement;
  const hasVisibleStatus = Boolean(
    multimodalMediaStatusEl?.textContent &&
    (multimodalMediaBusy || multimodalMediaStatusEl.dataset.tone === 'error'),
  );
  const isVisible = items.length > 0 || hasVisibleStatus;
  anchor?.setAttribute(
    'data-dpp-multimodal-media-has-items',
    isVisible ? 'true' : 'false',
  );
  multimodalMediaTrayEl.dataset.visible = isVisible ? 'true' : 'false';
  multimodalMediaButtonEl?.toggleAttribute('disabled', multimodalMediaBusy);
  multimodalMediaButtonEl?.classList.toggle('is-busy', multimodalMediaBusy);

  multimodalMediaTrayEl.textContent = '';
  const list = document.createElement('div');
  list.className = 'dpp-mm-list';
  for (const item of items) {
    const chip = document.createElement('div');
    chip.className = 'dpp-mm-chip';

    if (item.kind === 'image' && item.objectUrl) {
      const preview = document.createElement('img');
      preview.className = 'dpp-mm-preview';
      preview.src = item.objectUrl;
      preview.alt = '';
      chip.append(preview);
    } else {
      const preview = document.createElement('span');
      preview.className = 'dpp-mm-preview dpp-mm-preview-file';
      preview.textContent = item.kind === 'video' ? 'V' : 'I';
      chip.append(preview);
    }

    const label = document.createElement('span');
    label.className = 'dpp-mm-name';
    label.textContent = `${item.name} · ${formatMultimodalMediaBytes(item.sizeBytes)}`;
    chip.append(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dpp-mm-remove';
    remove.title = contentT('content.multimodalMedia.removeTitle', { name: item.name });
    remove.setAttribute('aria-label', contentT('content.multimodalMedia.removeTitle', { name: item.name }));
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      removePendingMultimodalMedia(item.id);
      renderMultimodalMediaTray();
    });
    chip.append(remove);

    list.append(chip);
  }
  multimodalMediaTrayEl.append(list);
  if (multimodalMediaStatusEl && hasVisibleStatus) {
    multimodalMediaTrayEl.append(multimodalMediaStatusEl);
  }
}

async function addPendingMultimodalFiles(files: readonly File[], source: 'picker' | 'paste') {
  if (!multimodalMediaInputEnabled) return;
  const mediaFiles = files.filter((file) => classifyMultimodalFile(file) !== null);
  if (mediaFiles.length === 0) return;

  const existing = getCurrentRoutePendingMultimodalMedia().length;
  if (existing + mediaFiles.length > MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN) {
    setMultimodalMediaStatus(contentT('content.multimodalMedia.tooMany', {
      count: MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN,
    }), 'error');
    return;
  }

  let addedCount = 0;
  let hasValidationError = false;
  for (const file of mediaFiles) {
    const kind = classifyMultimodalFile(file);
    if (!kind) continue;
    const error = validateMultimodalFile(file, kind);
    if (error) {
      hasValidationError = true;
      setMultimodalMediaStatus(error, 'error');
      continue;
    }
    const id = crypto.randomUUID();
    const objectUrl = kind === 'image' ? URL.createObjectURL(file) : null;
    pendingMultimodalMedia.set(id, {
      id,
      kind,
      file,
      name: file.name ||
        (source === 'paste' ? contentT('content.multimodalMedia.pastedFileName') : 'media'),
      mimeType: file.type,
      sizeBytes: file.size,
      objectUrl,
      routeKey: getTokenSpeedRouteKey(),
      createdAt: Date.now(),
    });
    addedCount++;
  }

  if (addedCount > 0 && !hasValidationError) {
    clearMultimodalMediaStatus();
  } else {
    renderMultimodalMediaTray();
  }
}

function handleMultimodalMediaPaste(event: ClipboardEvent) {
  if (!multimodalMediaInputEnabled) return;
  if (!isPromptPasteTarget(event.target)) return;
  const files = extractMultimodalFilesFromDataTransfer(event.clipboardData);
  if (files.length === 0) return;

  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') ?? '';
  if (text) insertPromptText(text);
  void addPendingMultimodalFiles(files, 'paste');
}

function extractMultimodalFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];

  const directFiles = dedupeClipboardMultimodalFiles(Array.from(dataTransfer.files ?? []));
  if (directFiles.length > 0) return directFiles;

  return dedupeClipboardMultimodalFiles(
    Array.from(dataTransfer.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()),
  );
}

function dedupeClipboardMultimodalFiles(candidates: Array<File | null>): File[] {
  const files: File[] = [];
  const seen = new Set<string>();
  const addFile = (file: File | null) => {
    if (!file || !classifyMultimodalFile(file)) return;
    const key = `${file.name}\0${file.type}\0${file.size}`;
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const file of candidates) {
    addFile(file);
  }
  return files;
}

function isPromptPasteTarget(target: EventTarget | null): boolean {
  const textarea = getPromptTextarea();
  if (!textarea || !(target instanceof Node)) return false;
  if (target === textarea) return true;
  return Boolean(findDeepSeekInputBox()?.contains(target));
}

function insertPromptText(text: string) {
  return insertTextIntoPromptTextarea(text, getPromptTextarea());
}

async function consumePendingMultimodalMediaForRequest(
  bodyStr: string,
  options: { onLongRunning?: (timeoutMs: number) => void } = {},
): Promise<string> {
  if (!multimodalMediaInputEnabled) {
    clearPendingMultimodalMedia();
    return bodyStr;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    throw new Error(contentT('content.multimodalMedia.invalidRequest'));
  }

  const mediaRouteKey = selectPendingMultimodalMediaRouteKey(body);
  if (!mediaRouteKey) return bodyStr;

  const media = getPendingMultimodalMediaForRoute(mediaRouteKey);
  if (media.length === 0) return bodyStr;

  const originalPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!originalPrompt.trim()) {
    throw new Error(contentT('content.multimodalMedia.emptyPrompt'));
  }
  options.onLongRunning?.(calculateMultimodalRequestAugmentationTimeoutMs(media));

  try {
    multimodalMediaBusy = true;
    renderMultimodalMediaTray();
    setMultimodalMediaStatus(contentT('content.multimodalMedia.analyzing', { count: media.length }), 'info');

    const inputs = await Promise.all(media.map(readPendingMultimodalMediaInput));
    const response = await sendRuntimeMessageStrict<MultimodalMediaAnalyzeResponse>({
      type: 'ANALYZE_MULTIMODAL_MEDIA',
      payload: {
        prompt: originalPrompt,
        media: inputs,
        chatSessionId: typeof body.chat_session_id === 'string'
          ? body.chat_session_id
          : getCurrentChatSessionId(),
        parentMessageId: normalizeContentMessageId(body.parent_message_id),
      },
    });
    if (!response.ok) throw new Error(response.error || 'Multimodal analysis failed.');

    body.prompt = buildMultimodalAnalysisPrompt(originalPrompt, response.analyses);
    clearPendingMultimodalMediaItems(media);
    setMultimodalMediaStatus(contentT('content.multimodalMedia.analyzed', { count: response.analyses.length }), 'info');
    return JSON.stringify(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setMultimodalMediaStatus(contentT('content.multimodalMedia.failed', { message }), 'error');
    throw error;
  } finally {
    multimodalMediaBusy = false;
    renderMultimodalMediaTray();
  }
}

async function readPendingMultimodalMediaInput(item: PendingMultimodalMedia): Promise<MultimodalMediaInput> {
  if (item.kind === 'image') {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      dataUrl: await readFileAsDataUrl(item.file),
    };
  }

  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    base64Data: await readFileAsBase64(item.file),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name || 'media file'}.`));
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`Failed to read ${file.name || 'media file'}.`));
    };
    reader.readAsDataURL(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function classifyMultimodalFile(file: File): MultimodalMediaKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

function validateMultimodalFile(file: File, kind: MultimodalMediaKind): string | null {
  if (!file.type) return contentT('content.multimodalMedia.unsupported', { name: file.name || 'media' });
  const maxBytes = kind === 'image' ? MULTIMODAL_MEDIA_IMAGE_MAX_BYTES : MULTIMODAL_MEDIA_VIDEO_INLINE_MAX_BYTES;
  if (file.size > maxBytes) {
    return contentT(
      kind === 'image'
        ? 'content.multimodalMedia.imageTooLarge'
        : 'content.multimodalMedia.videoTooLarge',
      { name: file.name || 'media', limit: formatMultimodalMediaBytes(maxBytes) },
    );
  }
  return null;
}

function getCurrentRoutePendingMultimodalMedia(): PendingMultimodalMedia[] {
  return getPendingMultimodalMediaForRoute(getTokenSpeedRouteKey());
}

function getPendingMultimodalMediaForRoute(routeKey: string): PendingMultimodalMedia[] {
  return Array.from(pendingMultimodalMedia.values())
    .filter((item) => item.routeKey === routeKey)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function selectPendingMultimodalMediaRouteKey(body: Record<string, unknown>): string | null {
  return selectMultimodalMediaRouteKeyForRequest(
    Array.from(pendingMultimodalMedia.values()),
    getTokenSpeedRouteKey(),
    { parentMessageId: normalizeContentMessageId(body.parent_message_id) },
  );
}

function handleMultimodalMediaRouteChange(previousRouteKey: string, nextRouteKey: string) {
  if (shouldPreserveInitialMultimodalMediaRoute(previousRouteKey, nextRouteKey)) {
    renderMultimodalMediaTray();
    return;
  }
  if (hasDeepSeekChatSessionRoute(previousRouteKey) && !hasDeepSeekChatSessionRoute(nextRouteKey)) {
    clearPendingMultimodalMedia();
    renderMultimodalMediaTray();
    return;
  }
  clearInactiveMultimodalMedia(nextRouteKey);
}

function clearInactiveMultimodalMedia(routeKey: string) {
  for (const item of Array.from(pendingMultimodalMedia.values())) {
    if (item.routeKey !== routeKey) removePendingMultimodalMedia(item.id);
  }
  renderMultimodalMediaTray();
}

function clearPendingMultimodalMediaItems(items: readonly PendingMultimodalMedia[]) {
  for (const item of items) removePendingMultimodalMedia(item.id);
  renderMultimodalMediaTray();
}

function clearPendingMultimodalMedia() {
  for (const item of Array.from(pendingMultimodalMedia.values())) {
    removePendingMultimodalMedia(item.id);
  }
}

function removePendingMultimodalMedia(id: string) {
  const item = pendingMultimodalMedia.get(id);
  if (!item) return;
  if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
  pendingMultimodalMedia.delete(id);
}

function setMultimodalMediaStatus(message: string, tone: 'info' | 'error') {
  if (!multimodalMediaStatusEl) return;
  multimodalMediaStatusEl.textContent = message;
  multimodalMediaStatusEl.dataset.tone = tone;
  renderMultimodalMediaTray();
}

function clearMultimodalMediaStatus() {
  if (!multimodalMediaStatusEl) return;
  multimodalMediaStatusEl.textContent = '';
  delete multimodalMediaStatusEl.dataset.tone;
  renderMultimodalMediaTray();
}

function normalizeContentMessageId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMultimodalMediaBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function createMultimodalMediaButtonIcon(): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Z" />
      <path d="m8 15 2.4-2.4a1.2 1.2 0 0 1 1.7 0L15 15.5l1-1a1 1 0 0 1 1.4 0L20 17" />
      <path d="M8.5 9.5h.01" />
      <path d="M16 4v4" />
      <path d="M14 6h4" />
    </svg>
  `;
}

function injectMultimodalMediaStyles() {
  if (document.getElementById(MULTIMODAL_MEDIA_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MULTIMODAL_MEDIA_STYLE_ID;
  style.textContent = `
    [data-dpp-multimodal-media-anchor] {
      position: relative !important;
    }

    .dpp-mm-file-input {
      display: none !important;
    }

    .dpp-mm-button {
      position: absolute;
      right: 64px;
      bottom: 18px;
      z-index: 35;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 999px;
      background: rgba(238, 243, 255, 0.94);
      color: #4d6bfe;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
      transition: background 120ms ease, color 120ms ease, transform 120ms ease, opacity 120ms ease;
    }

    [data-dpp-multimodal-media-has-native="true"] .dpp-mm-button {
      right: 102px;
    }

    .dpp-mm-button:hover {
      background: rgba(224, 233, 255, 0.98);
      transform: translateY(-1px);
    }

    .dpp-mm-button:disabled {
      cursor: wait;
      opacity: 0.62;
      transform: none;
    }

    .dpp-mm-button svg {
      width: 19px;
      height: 19px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .dpp-mm-tray {
      all: initial;
      box-sizing: border-box;
      position: relative;
      z-index: 34;
      display: none;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      width: 100%;
      max-width: 100%;
      margin: 0 0 8px 0;
      padding: 0 14px;
      overflow: visible;
      color: #1f2937;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
    }

    .dpp-mm-tray[data-visible="true"] {
      display: flex;
    }

    .dpp-mm-list {
      all: initial;
      box-sizing: border-box;
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(160px, 220px);
      align-items: center;
      gap: 8px;
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0 2px 4px 2px;
      scrollbar-width: thin;
      font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
    }

    .dpp-mm-chip {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      max-width: 210px;
      height: 36px;
      flex: 0 0 auto;
      padding: 4px 6px 4px 4px;
      border: 1px solid rgba(77, 107, 254, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.92);
      color: #1f2937;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    .dpp-mm-preview {
      box-sizing: border-box;
      display: block;
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      border-radius: 6px;
      object-fit: cover;
      background: #eef3ff;
    }

    .dpp-mm-preview-file {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #4d6bfe;
      font: 700 11px/1 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
    }

    .dpp-mm-name {
      box-sizing: border-box;
      min-width: 0;
      overflow: hidden;
      color: inherit;
      font: 500 12px/1.2 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dpp-mm-remove {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      font: 600 16px/1 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
    }

    .dpp-mm-remove:hover {
      background: rgba(15, 23, 42, 0.08);
      color: #111827;
    }

    .dpp-mm-status {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: min(100%, 280px);
      height: 24px;
      flex: 0 0 auto;
      padding: 0 8px;
      border-radius: 999px;
      background: rgba(238, 243, 255, 0.78);
      overflow: hidden;
      color: #4b5563;
      font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }

    .dpp-mm-status:empty {
      display: none;
    }

    .dpp-mm-status[data-tone="error"] {
      color: var(--dpp-ui-error, #b42318);
    }

    body.dpp-theme-dark .dpp-mm-button {
      background: rgba(48, 56, 82, 0.9);
      color: var(--dpp-ui-accent, #9fb2ff);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.26);
    }

    body.dpp-theme-dark .dpp-mm-button:hover {
      background: rgba(61, 72, 105, 0.96);
    }

    body.dpp-theme-dark .dpp-mm-chip {
      border-color: rgba(125, 145, 255, 0.24);
      background: rgba(28, 32, 44, 0.92);
      color: #e5e7eb;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.24);
    }

    body.dpp-theme-dark .dpp-mm-preview {
      background: rgba(72, 85, 130, 0.44);
    }

    body.dpp-theme-dark .dpp-mm-remove {
      color: #aab1c4;
    }

    body.dpp-theme-dark .dpp-mm-remove:hover {
      background: rgba(255, 255, 255, 0.08);
      color: #f8fafc;
    }

    body.dpp-theme-dark .dpp-mm-status {
      background: rgba(72, 85, 130, 0.32);
      color: #bac3d8;
    }

    body.dpp-theme-dark .dpp-mm-status[data-tone="error"] {
      color: var(--dpp-ui-error, #ffb4a8);
    }
  `;
  document.head.appendChild(style);
}

function downloadConversationExportArtifact(artifact: ConversationExportArtifact) {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function showConversationExportToast(message: string, tone: 'info' | 'success' | 'warning' | 'error') {
  let toast = document.querySelector<HTMLElement>(`.${EXPORT_ACTION_TOAST_CLASS}`);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = EXPORT_ACTION_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.dataset.visible = 'true';
  if (exportActionToastTimer) clearTimeout(exportActionToastTimer);
  exportActionToastTimer = setTimeout(() => {
    exportActionToastTimer = null;
    toast.dataset.visible = 'false';
  }, EXPORT_ACTION_TOAST_VISIBLE_MS);
}

let contentToastTimer: ReturnType<typeof setTimeout> | null = null;
const CONTENT_TOAST_VISIBLE_MS = 6000;

/**
 * Generic status toast for content-script-initiated notices (e.g. the inline
 * agent concurrency guard in issue #298). Distinct from the export toast so
 * the two never overwrite each other.
 */
function showContentToast(message: string, tone: 'info' | 'warning' = 'info'): void {
  injectContentToastStyles();
  let toast = document.querySelector<HTMLElement>(`.${CONTENT_TOAST_CLASS}`);
  if (!toast) {
    toast = document.createElement('div');
    toast.className = CONTENT_TOAST_CLASS;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.dataset.visible = 'true';
  if (contentToastTimer) clearTimeout(contentToastTimer);
  contentToastTimer = setTimeout(() => {
    contentToastTimer = null;
    toast!.dataset.visible = 'false';
  }, CONTENT_TOAST_VISIBLE_MS);
}

function injectContentToastStyles(): void {
  if (document.getElementById(CONTENT_TOAST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = CONTENT_TOAST_STYLE_ID;
  style.textContent = `
    .${CONTENT_TOAST_CLASS} {
      position: fixed;
      left: 50%;
      bottom: 88px;
      transform: translate(-50%, 12px);
      transform-origin: center bottom;
      max-width: min(520px, calc(100vw - 32px));
      padding: 10px 16px;
      border-radius: 10px;
      background: rgba(30, 32, 40, 0.95);
      color: #fff;
      font-size: 13px;
      line-height: 1.45;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
      z-index: 2147483646;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.18s ease, transform 0.18s ease;
    }
    .${CONTENT_TOAST_CLASS}[data-visible="true"] {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .${CONTENT_TOAST_CLASS}[data-tone="warning"] {
      background: rgba(180, 110, 0, 0.96);
    }
  `;
  document.head.appendChild(style);
}

function isVisibleElement(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number(style.opacity) !== 0;
}

function createConversationExportActionIcon(): string {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3v12"></path>
      <path d="m7 10 5 5 5-5"></path>
      <path d="M5 21h14"></path>
    </svg>
  `;
}

function injectConversationExportActionStyles() {
  if (document.getElementById(EXPORT_ACTION_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EXPORT_ACTION_STYLE_ID;
  style.textContent = `
    .${EXPORT_ACTION_CLASS} {
      display: inline-flex;
      flex: 0 0 28px;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      width: 28px;
      height: 28px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #8a8f99;
      cursor: pointer;
      vertical-align: middle;
      transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
    }
    .${EXPORT_ACTION_CLASS}:hover {
      color: #4d6bfe;
      background: rgba(77, 107, 254, 0.09);
    }
    .${EXPORT_ACTION_CLASS}:disabled {
      cursor: default;
      opacity: 0.68;
    }
    .${EXPORT_ACTION_CLASS}[data-status="running"] svg {
      animation: dpp-export-pulse 0.9s ease-in-out infinite;
    }
    .${EXPORT_ACTION_CLASS} svg {
      width: 18px;
      height: 18px;
      pointer-events: none;
    }
    .${EXPORT_ACTION_MENU_CLASS} {
      position: fixed;
      z-index: 2147483647;
      min-width: 176px;
      box-sizing: border-box;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 16px 38px rgba(15, 23, 42, 0.18);
      color: #111827;
      font-size: 13px;
      line-height: 1.35;
    }
    .${EXPORT_ACTION_MENU_CLASS} form {
      margin: 0;
    }
    .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-title {
      margin: 0 0 8px;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
    }
    .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      border-radius: 7px;
      padding: 4px 6px;
      cursor: pointer;
      user-select: none;
    }
    .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-option:hover {
      background: rgba(77, 107, 254, 0.08);
    }
    .${EXPORT_ACTION_MENU_CLASS} input {
      width: 14px;
      height: 14px;
      margin: 0;
      accent-color: #4d6bfe;
    }
    .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(15, 23, 42, 0.08);
    }
    .${EXPORT_ACTION_MENU_CLASS} button {
      min-width: 48px;
      height: 28px;
      border: 0;
      border-radius: 7px;
      padding: 0 10px;
      font: inherit;
      cursor: pointer;
    }
    .${EXPORT_ACTION_MENU_CLASS} button[type="button"] {
      background: transparent;
      color: #64748b;
    }
    .${EXPORT_ACTION_MENU_CLASS} button[type="submit"] {
      background: #4d6bfe;
      color: #ffffff;
    }
    .${EXPORT_ACTION_MENU_CLASS} button:disabled {
      cursor: default;
      opacity: 0.55;
    }
    .${EXPORT_ACTION_TOAST_CLASS} {
      position: fixed;
      left: 50%;
      bottom: 104px;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px));
      transform: translate(-50%, 10px);
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 10px;
      padding: 9px 12px;
      background: rgba(255, 255, 255, 0.96);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
      color: #111827;
      font-size: 13px;
      line-height: 1.45;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.16s ease, transform 0.16s ease;
    }
    .${EXPORT_ACTION_TOAST_CLASS}[data-visible="true"] {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .${EXPORT_ACTION_TOAST_CLASS}[data-tone="success"] {
      border-color: rgba(34, 197, 94, 0.28);
    }
    .${EXPORT_ACTION_TOAST_CLASS}[data-tone="warning"] {
      border-color: rgba(245, 158, 11, 0.34);
    }
    .${EXPORT_ACTION_TOAST_CLASS}[data-tone="error"] {
      border-color: rgba(239, 68, 68, 0.34);
      color: #b91c1c;
    }
    @media (prefers-color-scheme: dark) {
      .${EXPORT_ACTION_MENU_CLASS} {
        border-color: rgba(255, 255, 255, 0.12);
        background: rgba(31, 41, 55, 0.98);
        color: #f9fafb;
        box-shadow: 0 16px 38px rgba(0, 0, 0, 0.38);
      }
      .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-title,
      .${EXPORT_ACTION_MENU_CLASS} button[type="button"] {
        color: #cbd5e1;
      }
      .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-option:hover {
        background: rgba(96, 165, 250, 0.14);
      }
      .${EXPORT_ACTION_MENU_CLASS} .dpp-export-menu-actions {
        border-top-color: rgba(255, 255, 255, 0.1);
      }
      .${EXPORT_ACTION_TOAST_CLASS} {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(31, 41, 55, 0.96);
        color: #f9fafb;
      }
      .${EXPORT_ACTION_TOAST_CLASS}[data-tone="error"] {
        color: #fca5a5;
      }
    }
    @keyframes dpp-export-pulse {
      0%, 100% { transform: translateY(0); opacity: 1; }
      50% { transform: translateY(1px); opacity: 0.62; }
    }
  `;
  document.head.appendChild(style);
}

function normalizeCapturedClientHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null;
  const headers = value as Record<string, unknown>;
  const authorization = headers.Authorization;
  if (typeof authorization !== 'string' || !authorization) return null;

  const normalized: Record<string, string> = { Authorization: authorization };
  for (const [key, entry] of Object.entries(headers)) {
    if (key === 'Authorization') continue;
    if (typeof entry === 'string' && entry) normalized[key] = entry;
  }
  return normalized;
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T | undefined> {
  if (!hasLiveExtensionContext()) return undefined;

  try {
    const result = await chrome.runtime.sendMessage(message);
    // Guard against background error responses being misinterpreted as valid data
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
      return undefined;
    }
    return result as T;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
      return undefined;
    }
    return undefined;
  }
}

async function sendRuntimeMessageStrict<T>(message: unknown): Promise<T> {
  if (!hasLiveExtensionContext()) {
    throw new Error('Extension context is unavailable.');
  }

  try {
    const result = await chrome.runtime.sendMessage(message);
    if (isRuntimeFailureResponse(result)) {
      throw new Error(result.error ? String(result.error) : 'Runtime request failed.');
    }
    return result as T;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
    throw error;
  }
}

function isRuntimeFailureResponse(value: unknown): value is { ok: false; error?: unknown } {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

async function getLocalStorageValue<T>(key: string): Promise<T | undefined> {
  const storage = getLocalStorageArea();
  if (!storage) return undefined;

  try {
    const stored = await storage.get(key);
    return stored?.[key] as T | undefined;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
    return undefined;
  }
}

async function setLocalStorageValue(key: string, value: unknown): Promise<void> {
  const storage = getLocalStorageArea();
  if (!storage) return;

  try {
    await storage.set({ [key]: value });
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
  }
}

function getLocalStorageArea(): chrome.storage.LocalStorageArea | null {
  if (!hasLiveExtensionContext()) return null;

  try {
    const storage = chrome.storage?.local;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') return null;
    return storage;
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
    return null;
  }
}

function addRuntimeMessageListener(
  listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0],
) {
  if (!hasLiveExtensionContext()) return;

  try {
    chrome.runtime.onMessage.addListener(listener);
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
    }
  }
}

function startDeepSeekThemeSync() {
  syncDeepSeekTheme();

  themeObserver?.disconnect();
  themeObserver = new MutationObserver(scheduleDeepSeekThemeSync);
  observeThemeHost(document.documentElement);
  observeThemeHost(document.body);
  observeThemeHost(document.getElementById('root'));

  themeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  themeMediaListener = () => scheduleDeepSeekThemeSync();
  themeMediaQuery.addEventListener('change', themeMediaListener);

  startThemeBootstrapSync();
}

function stopDeepSeekThemeSync() {
  themeObserver?.disconnect();
  themeObserver = null;
  stopThemeBootstrapSync();
  if (themeSyncTimer) {
    clearTimeout(themeSyncTimer);
    themeSyncTimer = null;
  }
  if (themeMediaQuery && themeMediaListener) {
    themeMediaQuery.removeEventListener('change', themeMediaListener);
  }
  themeMediaQuery = null;
  themeMediaListener = null;
}

function startThemeBootstrapSync() {
  stopThemeBootstrapSync();
  themeBootstrapAttempts = 0;
  themeTreeObserver = new MutationObserver(() => {
    observeThemeTree(document.getElementById('root'));
    scheduleDeepSeekThemeSync();
  });

  observeThemeTree(document.body);
  observeThemeTree(document.getElementById('root'));
  scheduleThemeBootstrapRetry();
}

function stopThemeBootstrapSync() {
  themeTreeObserver?.disconnect();
  themeTreeObserver = null;
  if (themeBootstrapTimer) {
    clearTimeout(themeBootstrapTimer);
    themeBootstrapTimer = null;
  }
}

function observeThemeHost(element: Element | null) {
  if (!element || !themeObserver) return;
  themeObserver.observe(element, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode', 'data-mode', 'color-scheme'],
  });
}

function observeThemeTree(element: Element | null) {
  if (!element || !themeTreeObserver) return;
  themeTreeObserver.observe(element, { childList: true, subtree: true });
}

function scheduleThemeBootstrapRetry() {
  if (themeBootstrapTimer) return;
  themeBootstrapTimer = setTimeout(() => {
    themeBootstrapTimer = null;
    themeBootstrapAttempts += 1;
    syncDeepSeekTheme();

    if (themeBootstrapAttempts >= THEME_BOOTSTRAP_RETRY_LIMIT) {
      stopThemeBootstrapSync();
      return;
    }
    scheduleThemeBootstrapRetry();
  }, THEME_BOOTSTRAP_RETRY_MS);
}

function scheduleDeepSeekThemeSync() {
  if (themeSyncTimer) clearTimeout(themeSyncTimer);
  themeSyncTimer = setTimeout(() => {
    themeSyncTimer = null;
    syncDeepSeekTheme();
  }, 50);
}

function syncDeepSeekTheme() {
  const theme = detectDeepSeekTheme();
  applyDeepSeekThemeClass(theme);
  if (theme === currentDeepSeekTheme) return;
  currentDeepSeekTheme = theme;
  void sendRuntimeMessage({ type: 'SET_DEEPSEEK_THEME', payload: { theme } });
}

function applyDeepSeekThemeClass(theme: DeepSeekTheme) {
  document.body.classList.toggle('dpp-theme-dark', theme === 'dark');
  document.body.classList.toggle('dpp-theme-light', theme === 'light');
}

function detectDeepSeekTheme(): DeepSeekTheme {
  return detectExplicitTheme() ??
    detectBackgroundTheme() ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function detectExplicitTheme(): DeepSeekTheme | null {
  const hosts = [document.documentElement, document.body, document.getElementById('root')]
    .filter((element): element is HTMLElement => Boolean(element));
  const attributeNames = ['data-theme', 'data-color-mode', 'data-mode', 'color-scheme'];

  for (const host of hosts) {
    for (const name of attributeNames) {
      const theme = parseThemeText(host.getAttribute(name));
      if (theme) return theme;
    }

    const themeFromClass = parseThemeText(typeof host.className === 'string' ? host.className : '');
    if (themeFromClass) return themeFromClass;

    const scheme = getComputedStyle(host).colorScheme.toLowerCase().trim();
    if (scheme === 'dark' || scheme === 'light') return scheme;
  }

  return null;
}

function parseThemeText(value: string | null): DeepSeekTheme | null {
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (/(^|[\s_-])(dark|black|night)([\s_-]|$)/.test(normalized)) return 'dark';
  if (/(^|[\s_-])(light|white|day)([\s_-]|$)/.test(normalized)) return 'light';
  return null;
}

function detectBackgroundTheme(): DeepSeekTheme | null {
  const sampled = document.elementFromPoint(
    Math.max(0, Math.floor(window.innerWidth / 2)),
    Math.max(0, Math.min(Math.floor(window.innerHeight / 2), 240)),
  );
  const candidates = [
    sampled,
    document.querySelector('main'),
    document.getElementById('root'),
    document.body,
    document.documentElement,
  ].filter((element): element is Element => Boolean(element));

  for (const candidate of candidates) {
    let element: Element | null = candidate;
    while (element && element !== document.documentElement.parentElement) {
      const theme = themeFromBackgroundColor(getComputedStyle(element).backgroundColor);
      if (theme) return theme;
      element = element.parentElement;
    }
  }

  return null;
}

function themeFromBackgroundColor(color: string): DeepSeekTheme | null {
  const rgb = parseRgbColor(color);
  if (!rgb || rgb.alpha < 0.2) return null;
  return relativeLuminance(rgb.red, rgb.green, rgb.blue) < 0.45 ? 'dark' : 'light';
}

function parseRgbColor(color: string): { red: number; green: number; blue: number; alpha: number } | null {
  const match = color.match(/^rgba?\((.+)\)$/);
  if (!match) return null;

  const parts = match[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const [red, green, blue] = parts.slice(0, 3).map(Number);
  const alpha = parts[3] === undefined ? 1 : Number(parts[3]);
  if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) return null;
  return { red, green, blue, alpha };
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function startInlineAgentIfNeeded(
  complete: ResponseCompletePayload,
  executions: ToolExecutionRecord[],
): void {
  if (isInlineAgentResponseComplete(complete)) return;

  // Concurrency guard (issue #298): if an inline agent loop is already running
  // for this conversation, do NOT start a second one off a user-initiated turn
  // (e.g. a "continue" prompt because the long-running agent looked stuck).
  // Starting a second loop previously left two agent panels racing in the DOM.
  // Continuation turns are produced by the agent loop itself and are already
  // handled by isInlineAgentResponseComplete above.
  if (isInlineAgentRunning()) {
    showContentToast(
      contentT('content.agent.concurrencyGuard'),
      'warning',
    );
    return;
  }


  // Collect executions that should trigger a continuation:
  // MCP tools + local web and browser-control tools.
  const continuableExecutions = selectContinuableToolExecutions(executions);
  if (continuableExecutions.length === 0) return;
  if (!complete.chatSessionId || complete.assistantMessageId == null) return;

  const loopId = crypto.randomUUID();

  const payload: InlineAgentStartPayload = {
    loopId,
    chatSessionId: complete.chatSessionId,
    parentMessageId: complete.assistantMessageId,
    originalPrompt: complete.agentTaskPrompt || complete.originalPrompt,
    agentTaskPrompt: complete.agentTaskPrompt || complete.originalPrompt,
    toolExecutions: continuableExecutions,
    promptOptions: {
      modelType: complete.promptOptions.modelType,
      searchEnabled: complete.promptOptions.searchEnabled,
      thinkingEnabled: complete.promptOptions.thinkingEnabled,
      refFileIds: complete.promptOptions.refFileIds,
    },
    toolDescriptors: currentToolDescriptors.filter(
      (d) =>
        d.provider?.kind === 'mcp' ||
        d.provider?.id === 'web' ||
        d.provider?.id === 'browser_control' ||
        d.name === 'web_search' ||
        d.name === 'web_fetch' ||
        d.name.startsWith('browser_'),
    ),
    locale: currentContentLocale,
    powWasmUrl: chrome.runtime.getURL(DEEPSEEK_POW_WASM_PATH),
  };

  injectInlineAgentStyles();
  const container = createAgentContainer();
  container.setAttribute('data-dpp-agent-loop-id', loopId);

  const messages = getAssistantMessages();
  const anchorContent = getInlineAgentAnchorContent(complete);
  const target = findInlineAgentLiveTarget(complete, messages, anchorContent);
  if (!target) return;
  const anchorMessageIndex = messages.indexOf(target);

  inlineAgentLoopId = loopId;
  activeInlineAgentTrace = createInlineAgentTrace(
    complete,
    loopId,
    continuableExecutions.length,
    anchorMessageIndex,
    anchorContent,
  );
  void writeInlineAgentTrace(activeInlineAgentTrace);

  inlineAgentContainer = container;
  mountInlineAgentContainer(target, container);

  void startInlineAgentLoop(payload);
}

function isInlineAgentResponseComplete(complete: ResponseCompletePayload): boolean {
  return isInlineAgentContinuationRequest(complete.originalPrompt, complete.agentTaskPrompt);
}

function mountInlineAgentContainer(message: Element, container: HTMLElement): void {
  const placeContainer = () => {
    const responseHost = getAssistantResponseHost(message);
    if (container.parentElement !== responseHost) {
      responseHost.appendChild(container);
      return;
    }
    if (container.nextSibling) {
      responseHost.appendChild(container);
    }
  };

  placeContainer();

  inlineAgentContainerObserver?.disconnect();
  inlineAgentContainerObserver = new MutationObserver(placeContainer);
  inlineAgentContainerObserver.observe(message, { childList: true, subtree: true });
}

function findInlineAgentLiveTarget(
  complete: ResponseCompletePayload,
  messages: Element[],
  anchorContent: string,
): Element | null {
  const messageId = complete.assistantMessageId == null ? null : String(complete.assistantMessageId);
  if (messageId) {
    const byId = messages.find((message) => elementHasMessageId(message, messageId));
    if (byId) return byId;
  }

  const byContent = findAssistantMessageByContentSnippet(messages, anchorContent, new Set());
  if (byContent) return byContent;

  return messages[messages.length - 1] ?? null;
}

/**
 * True when an inline agent loop is mid-flight (an AbortController exists and
 * has not been aborted). Used by the concurrency guard in
 * {@link startInlineAgentIfNeeded} to skip launching a duplicate loop when the
 * user sends a follow-up message while a previous agent is still running
 * (issue #298).
 */
function isInlineAgentRunning(): boolean {
  const controller = activeAgentAbort;
  return controller !== null && !controller.signal.aborted;
}

/**
 * Synchronously detach the current agent panel and reset the module-level
 * bookkeeping. Does NOT abort the loop (the caller owns that) and does NOT
 * render a footer — used when a new loop supersedes an in-flight one so the
 * old panel disappears immediately instead of lingering until the aborted
 * stream settles (issue #298).
 */
function teardownInlineAgentPanel(): void {
  flushPendingInlineAgentStreamRender();
  if (inlineAgentContainer) {
    inlineAgentContainer.remove();
  }
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
  activeInlineAgentTrace = null;
  inlineAgentContainerObserver?.disconnect();
  inlineAgentContainerObserver = null;
}

function stopInlineAgent(): void {
  const container = inlineAgentContainer;
  updateActiveInlineAgentTrace((trace) => ({
    ...trace,
    status: 'stopping',
    error: contentT('content.agent.stopped'),
  }), { immediate: true });
  // Reset module state (DOM bookkeeping + observers). The container itself is
  // retained momentarily to append the "stopped" footer, then detached.
  flushPendingInlineAgentStreamRender();
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
  activeInlineAgentTrace = null;
  inlineAgentContainerObserver?.disconnect();
  inlineAgentContainerObserver = null;
  activeAgentAbort?.abort();
  activeAgentAbort = null;
  if (container) {
    const footer = createAgentFooter(0, 0, false, contentT('content.agent.stopped'), getAgentRendererLabels());
    container.appendChild(footer);
  }
}

async function startInlineAgentLoop(payload: InlineAgentStartPayload): Promise<void> {
  // Abort any previously running loop AND tear down its panel synchronously
  // before mounting the new one. Previously the old panel stayed in the DOM
  // until the aborted stream settled, so two agent panels briefly raced
  // (issue #298).
  if (activeAgentAbort) {
    activeAgentAbort.abort();
    teardownInlineAgentPanel();
  }
  const abort = new AbortController();
  activeAgentAbort = abort;

  const authorizationRequestId = `agent:${payload.loopId}`;
  let authorization: ToolAuthorizationGrantSummary;
  try {
    authorization = await createContentToolAuthorization({
      requestId: authorizationRequestId,
      trigger: 'agent_run',
      chatSessionId: payload.chatSessionId,
      runId: payload.loopId,
      descriptorIds: payload.toolDescriptors.map((descriptor) => descriptor.id),
    });
    activeToolAuthorizations.set(authorizationRequestId, authorization);
  } catch (error) {
    handleAgentLoopError({
      loopId: payload.loopId,
      stepIndex: 0,
      totalTools: payload.toolExecutions.length,
      error: error instanceof Error ? error.message : String(error),
    });
    if (activeAgentAbort === abort) activeAgentAbort = null;
    return;
  }

  const post = (type: string, data: unknown) => {
    handleInlineAgentLoopEvent(type, data);
  };

  const executeTool = async (call: ToolCall): Promise<ToolExecutionRecord> => {
    const enrichedCall: ToolCall = ensureToolCallId({
      ...call,
      source: {
        trigger: 'agent_run',
        requestId: authorizationRequestId,
        chatSessionId: payload.chatSessionId,
        runId: payload.loopId,
      },
    });
    const result = await executeToolCall(enrichedCall, authorization.id);
    return {
      name: call.name,
      result: {
        ok: result.ok,
        summary: result.summary,
        detail: result.detail,
        output: result.output,
        error: result.error,
        truncated: result.truncated,
      },
      provider: call.provider,
      descriptorId: call.descriptorId,
    };
  };

  try {
    await runInlineAgentLoop({
      ...payload,
      toolDescriptors: authorization.descriptors,
    }, { post, executeTool, signal: abort.signal });
  } finally {
    await closeContentToolAuthorization(authorizationRequestId);
    if (activeAgentAbort === abort) activeAgentAbort = null;
  }
}

function handleInlineAgentLoopEvent(type: string, data: unknown): void {
  switch (type) {
    case 'AGENT_STEP_STARTED':
      setPetState('working');
      handleAgentStepStarted(data as { loopId: string; stepIndex: number });
      break;
    case 'AGENT_STREAM_CHUNK':
      setPetState('speaking');
      handleAgentStreamChunk(data as InlineAgentStreamChunkMsg);
      break;
    case 'AGENT_TOKEN_SPEED': {
      const progress = normalizeResponseTokenSpeedPayload(data);
      if (progress) {
        updateTokenSpeedIndicator(progress);
        updatePetFromTokenSpeed(progress);
      }
      break;
    }
    case 'AGENT_TOOL_DETECTED':
      break;
    case 'AGENT_STEP_COMPLETE':
      handleAgentStepComplete(data as InlineAgentStepCompleteMsg);
      schedulePetIdle();
      break;
    case 'AGENT_LOOP_COMPLETE':
      handleAgentLoopComplete(data as InlineAgentLoopCompleteMsg);
      setPetState('success');
      schedulePetIdle(PET_FEEDBACK_DELAY_MS);
      break;
    case 'AGENT_LOOP_ERROR':
      setPetState('error');
      handleAgentLoopError(data as InlineAgentLoopErrorMsg);
      schedulePetIdle(PET_FEEDBACK_DELAY_MS);
      break;
  }
}

function handleAgentStepStarted(data: { loopId: string; stepIndex: number }): void {
  if (data.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;

  const stepEl = createAgentStepElement(data.stepIndex, stopInlineAgent, getAgentRendererLabels());
  inlineAgentCurrentStep = stepEl;
  inlineAgentContainer.appendChild(stepEl);
  updateActiveInlineAgentTrace((trace) => upsertInlineAgentTraceStep(trace, {
    index: data.stepIndex,
    status: 'streaming',
    text: '',
    toolExecutions: [],
    responseMessageId: null,
    collapsed: false,
  }));
}

function handleAgentStreamChunk(msg: InlineAgentStreamChunkMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentCurrentStep) return;
  pendingInlineAgentStreamChunk = msg;
  if (inlineAgentStreamRenderFrame !== null) return;

  inlineAgentStreamRenderFrame = requestAnimationFrame(() => {
    inlineAgentStreamRenderFrame = null;
    const next = pendingInlineAgentStreamChunk;
    pendingInlineAgentStreamChunk = null;
    if (next) renderInlineAgentStreamChunk(next);
  });
}

function renderInlineAgentStreamChunk(msg: InlineAgentStreamChunkMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentCurrentStep) return;
  const previousText = getInlineAgentStepText(inlineAgentCurrentStep);
  const nextText = clampText(getInlineAgentDisplayStepText(msg.fullText) || previousText, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '';
  updateStepStreamText(inlineAgentCurrentStep, nextText);
  updateActiveInlineAgentTrace((trace) => updateInlineAgentTraceStep(trace, msg.stepIndex, {
    text: nextText,
    status: 'streaming',
    collapsed: false,
  }));
}

function flushPendingInlineAgentStreamRender(): void {
  if (inlineAgentStreamRenderFrame !== null) {
    cancelAnimationFrame(inlineAgentStreamRenderFrame);
    inlineAgentStreamRenderFrame = null;
  }

  const next = pendingInlineAgentStreamChunk;
  pendingInlineAgentStreamChunk = null;
  if (next) renderInlineAgentStreamChunk(next);
}

function cancelPendingInlineAgentStreamRender(): void {
  if (inlineAgentStreamRenderFrame !== null) {
    cancelAnimationFrame(inlineAgentStreamRenderFrame);
    inlineAgentStreamRenderFrame = null;
  }
  pendingInlineAgentStreamChunk = null;
}

function handleAgentStepComplete(msg: InlineAgentStepCompleteMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentCurrentStep) return;
  flushPendingInlineAgentStreamRender();

  for (const exec of msg.toolExecutions) {
    addToolResultToStep(inlineAgentCurrentStep, exec.name, exec.result.ok, exec.result.summary);
  }

  const label = msg.toolExecutions.length > 0
    ? contentT('content.agent.completeWithTools', { count: msg.toolExecutions.length })
    : contentT('content.agent.complete');
  updateStepStatus(inlineAgentCurrentStep, 'complete', label);
  const fullText = getInlineAgentStepText(inlineAgentCurrentStep);
  updateActiveInlineAgentTrace((trace) => updateInlineAgentTraceStep(trace, msg.stepIndex, {
    status: 'complete',
    text: fullText,
    toolExecutions: msg.toolExecutions,
    responseMessageId: msg.responseMessageId,
    collapsed: true,
  }), { immediate: true });

  const completedStep = inlineAgentCurrentStep;
  setTimeout(() => {
    completedStep.setAttribute('data-collapsed', 'true');
  }, 800);

  inlineAgentCurrentStep = null;
}

function handleAgentLoopComplete(msg: InlineAgentLoopCompleteMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;
  flushPendingInlineAgentStreamRender();

  try {
    inlineAgentContainerObserver?.disconnect();
    inlineAgentContainerObserver = null;

    const finalText = getInlineAgentDisplayFinalText(msg.finalText);
    appendInlineAgentFinalAnswer(inlineAgentContainer, finalText, msg.loopId);

    const footer = createAgentFooter(msg.totalSteps, msg.totalTools, false, undefined, getAgentRendererLabels());
    inlineAgentContainer.appendChild(footer);
    updateActiveInlineAgentTrace((trace) => ({
      ...trace,
      status: 'complete',
      totalSteps: msg.totalSteps,
      totalTools: msg.totalTools,
      finalText,
    }), { immediate: true });
  } catch (err) {
    console.error('[DeepSeek++] handleAgentLoopComplete error:', err);
  } finally {
    // ALWAYS clean up state — even if rendering throws, the next agent loop
    // must start fresh. Otherwise subsequent searches silently fail.
    inlineAgentLoopId = null;
    inlineAgentContainer = null;
    inlineAgentCurrentStep = null;
    activeInlineAgentTrace = null;
    inlineAgentContainerObserver?.disconnect();
    inlineAgentContainerObserver = null;

    // Note: no silent refresh — it breaks the extension's tool execution state.
    // After manual page refresh, DeepSeek's native renderer will show the
    // continuation message with proper Markdown.
  }
}

function getInlineAgentDisplayFinalText(text: string): string {
  const withoutToolCalls = stripToolCalls(text, { descriptors: currentToolDescriptors });
  return normalizeInlineAgentFinalAnswerText(withoutToolCalls);
}

function getInlineAgentDisplayStepText(text: string): string {
  return getInlineAgentDisplayFinalText(text);
}

function appendInlineAgentFinalAnswer(container: HTMLElement, text: string, loopId: string): void {
  const renderText = clampText(text, INLINE_AGENT_FINAL_RENDER_MAX_CHARS) ?? '';
  if (!renderText) return;
  const parent = container.parentNode;
  if (!parent) return;

  const textDiv = document.createElement('div');
  textDiv.innerHTML = renderInlineMarkdown(renderText);
  textDiv.setAttribute('data-dpp-body-text', 'true');
  textDiv.setAttribute('data-dpp-agent-loop-id', loopId);
  parent.appendChild(textDiv);
}

function handleAgentLoopError(msg: InlineAgentLoopErrorMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;
  flushPendingInlineAgentStreamRender();

  try {
    if (inlineAgentCurrentStep) {
      updateStepStatus(inlineAgentCurrentStep, 'error', msg.error);
    }

    const footer = createAgentFooter(msg.stepIndex, msg.totalTools, true, msg.error, getAgentRendererLabels());
    inlineAgentContainer.appendChild(footer);
    updateActiveInlineAgentTrace((trace) => ({
      ...trace,
      status: 'error',
      totalSteps: msg.stepIndex,
      error: msg.error,
    }), { immediate: true });
  } catch (err) {
    console.error('[DeepSeek++] handleAgentLoopError:', err);
  } finally {
    inlineAgentLoopId = null;
    inlineAgentContainer = null;
    inlineAgentCurrentStep = null;
    activeInlineAgentTrace = null;
    inlineAgentContainerObserver?.disconnect();
    inlineAgentContainerObserver = null;
  }
}

function runToolExecution(call: ToolCall): Promise<ToolCardResult> {
  const session = getOrCreateActiveToolBlockSession(call);
  if (activeStreamingToolCount > 0) activeStreamingToolCount--;
  const task = (async () => {
    if (isExternalizedToolPayloadCall(call)) {
      await waitForExternalToolPayloadWrites(call);
    }
    return executeToolCall(call);
  })()
    .catch((err): ToolCardResult => ({
      ok: false,
      summary: contentT('content.toolBlock.summaries.failed'),
      detail: err instanceof Error ? err.message : String(err),
    }))
    .then((result) => {
      removePendingToolExecution(session, call);
      const execution = { callId: call.id, name: call.name, result, provider: call.provider, descriptorId: call.descriptorId };
      session.executions.push(execution);
      activeToolBlockSessionId = session.id;
      toolExecutions = session.executions;
      renderToolBlock(session);
      void persistToolBlockSession(session);
      showPetResult(result);
      return result;
    });

  pendingToolExecutionTasks.add(task);
  const requestId = call.source?.requestId;
  if (requestId) {
    const requestTasks = pendingToolExecutionTasksByRequest.get(requestId) ?? new Set();
    requestTasks.add(task);
    pendingToolExecutionTasksByRequest.set(requestId, requestTasks);
  }
  void task.finally(() => {
    pendingToolExecutionTasks.delete(task);
    if (!requestId) return;
    const requestTasks = pendingToolExecutionTasksByRequest.get(requestId);
    requestTasks?.delete(task);
    if (requestTasks?.size === 0) pendingToolExecutionTasksByRequest.delete(requestId);
  });
  return task;
}

function ensureToolCallId(call: ToolCall): ToolCall {
  if (call.id) return call;
  const identity = JSON.stringify({
    requestId: call.source?.requestId ?? null,
    descriptorId: call.descriptorId ?? null,
    providerId: call.provider?.id ?? null,
    name: call.name,
    invocationName: call.invocationName ?? null,
    raw: call.raw,
  });
  return { ...call, id: `legacy:${hashString(identity)}` };
}

function getToolAuthorizationForCall(
  call: ToolCall,
): ToolAuthorizationGrantSummary | undefined {
  const requestId = call.source?.requestId;
  return requestId ? activeToolAuthorizations.get(requestId) : undefined;
}

function showPendingToolExecution(call: ToolCall): void {
  const session = getOrCreateActiveToolBlockSession(call);
  if (session.executions.some((execution) => isMatchingPendingToolExecution(execution, call))) return;

  session.executions.push({
    callId: call.id,
    pending: true,
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    result: {
      ok: true,
      summary: contentT('content.toolBlock.summaries.running'),
    },
  });
  session.updatedAt = Date.now();
  registerPendingToolStart(call, session);
  activeToolBlockSessionId = session.id;
  toolExecutions = session.executions;
  setPetState('working');
  activeStreamingToolCount++;
  renderToolBlock(session, { skipCleanup: true });
}

function removePendingToolExecution(session: ActiveToolBlockSession, call: ToolCall): void {
  const index = session.executions.findIndex((execution) => isMatchingPendingToolExecution(execution, call));
  if (index >= 0) {
    session.executions.splice(index, 1);
  }
  unregisterPendingToolStart(call);
}

function registerPendingToolStart(call: ToolCall, session: ActiveToolBlockSession): void {
  const requestId = call.source?.requestId;
  if (!requestId) return;
  pendingStartedToolCallsByRequest.set(
    requestId,
    createPendingToolStartKey(call),
    { call, session },
  );
}

function unregisterPendingToolStart(call: ToolCall): void {
  const requestId = call.source?.requestId;
  if (!requestId) return;
  pendingStartedToolCallsByRequest.delete(requestId, createPendingToolStartKey(call));
}

function createPendingToolStartKey(call: ToolCall): string {
  return call.id ?? `${call.descriptorId ?? ''}:${call.name}:${call.raw}`;
}

async function finalizeInterruptedToolStarts(requestId: string): Promise<void> {
  const authoritativeRequestId = activeToolAuthorizations.has(requestId)
    ? requestId
    : toolAuthorizationRequestAliases.get(requestId) ?? requestId;
  const pending = pendingStartedToolCallsByRequest.drain(authoritativeRequestId);
  if (pending.length === 0) return;

  for (const { call, session } of pending) {
    removePendingToolExecution(session, call);
    const result: ToolCardResult = {
      ok: false,
      summary: contentT('content.toolBlock.summaries.failed'),
      detail: contentT('tool.runtime.incomplete'),
      error: {
        code: INCOMPLETE_TOOL_CALL_ERROR_CODE,
        message: contentT('tool.runtime.incomplete'),
        retryable: false,
      },
    };
    session.executions.push({
      callId: call.id,
      name: call.name,
      provider: call.provider,
      descriptorId: call.descriptorId,
      result,
    });
    session.updatedAt = Date.now();
    activeStreamingToolCount = Math.max(0, activeStreamingToolCount - 1);
    activeToolBlockSessionId = session.id;
    toolExecutions = session.executions;
    renderToolBlock(session);
    await persistToolBlockSession(session);
    showPetResult(result);
  }
}

function isMatchingPendingToolExecution(execution: ToolExecutionRecord, call: ToolCall): boolean {
  if (!execution.pending) return false;
  if (call.id && execution.callId === call.id) return true;
  return execution.name === call.name && execution.descriptorId === call.descriptorId;
}

function showPetResult(result: ToolCardResult): void {
  setPetState(result.ok ? 'success' : 'error');
  schedulePetIdle(PET_FEEDBACK_DELAY_MS);
}

async function waitForPendingToolExecutions(requestId?: string) {
  while (true) {
    const tasks = requestId
      ? pendingToolExecutionTasksByRequest.get(requestId)
      : pendingToolExecutionTasks;
    if (!tasks || tasks.size === 0) return;
    await Promise.allSettled(Array.from(tasks));
  }
}

function normalizeResponseCompletePayload(payload: unknown, fallbackText: unknown): ResponseCompletePayload {
  const value = payload && typeof payload === 'object' ? payload as Partial<ResponseCompletePayload> : {};
  return {
    requestId: typeof value.requestId === 'string' ? value.requestId : '',
    text: typeof value.text === 'string' ? value.text : typeof fallbackText === 'string' ? fallbackText : '',
    originalPrompt: typeof value.originalPrompt === 'string' ? value.originalPrompt : '',
    agentTaskPrompt: typeof value.agentTaskPrompt === 'string' ? value.agentTaskPrompt : '',
    chatSessionId: typeof value.chatSessionId === 'string' ? value.chatSessionId : null,
    parentMessageId: typeof value.parentMessageId === 'number' ? value.parentMessageId : null,
    assistantMessageId: typeof value.assistantMessageId === 'number' ? value.assistantMessageId : null,
    promptOptions: {
      modelType: typeof value.promptOptions?.modelType === 'string' ? value.promptOptions.modelType : null,
      searchEnabled: value.promptOptions?.searchEnabled === true,
      thinkingEnabled: value.promptOptions?.thinkingEnabled === true,
      refFileIds: Array.isArray(value.promptOptions?.refFileIds)
        ? value.promptOptions.refFileIds.filter((item): item is string => typeof item === 'string')
        : [],
    },
  };
}

function normalizeResponseTokenSpeedPayload(payload: unknown): ResponseTokenSpeedPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Partial<ResponseTokenSpeedPayload>;
  const estimatedTokens = toFiniteNumber(value.estimatedTokens);
  const accumulatedTokens = value.accumulatedTokens === null ? null : toFiniteNumber(value.accumulatedTokens);
  const tokensPerSecond = toFiniteNumber(value.tokensPerSecond);
  const elapsedMs = toFiniteNumber(value.elapsedMs);
  const textLength = toFiniteNumber(value.textLength);

  if (
    estimatedTokens === null ||
    tokensPerSecond === null ||
    elapsedMs === null ||
    textLength === null
  ) {
    return null;
  }

  return {
    requestId: typeof value.requestId === 'string' ? value.requestId : undefined,
    chatSessionId: typeof value.chatSessionId === 'string' ? value.chatSessionId : null,
    assistantMessageId: typeof value.assistantMessageId === 'number' ? value.assistantMessageId : null,
    active: value.active === true,
    estimatedTokens,
    accumulatedTokens,
    tokensPerSecond,
    elapsedMs,
    textLength,
    tokenSource: value.tokenSource === 'server' ? 'server' : 'estimated',
    speedSource: value.speedSource === 'server' ? 'server' : 'estimated',
    modelType: typeof value.modelType === 'string' ? value.modelType : null,
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function updateTokenSpeedIndicator(progress: ResponseTokenSpeedPayload) {
  if (shouldIgnoreEmptyTokenSpeedProgress(progress, lastTokenSpeedProgress)) return;
  tokenSpeedRouteKey = getTokenSpeedRouteKey();
  lastTokenSpeedProgress = progress;
  renderTokenSpeedIndicator(progress);
  recordUsageProgress(progress);
}

function createIdleTokenSpeedProgress(): ResponseTokenSpeedPayload {
  return {
    requestId: undefined,
    chatSessionId: null,
    assistantMessageId: null,
    active: false,
    estimatedTokens: 0,
    accumulatedTokens: null,
    tokensPerSecond: 0,
    elapsedMs: 0,
    textLength: 0,
    tokenSource: 'estimated',
    speedSource: 'estimated',
    modelType: null,
  };
}

function recordUsageProgress(progress: ResponseTokenSpeedPayload) {
  if (progress.active || !progress.requestId) return;
  const totalTokens = progress.accumulatedTokens ?? progress.estimatedTokens;
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return;

  const signature = [
    Math.round(totalTokens),
    progress.tokenSource,
    Math.round(progress.tokensPerSecond * 100) / 100,
    progress.speedSource,
    progress.modelType ?? '',
    progress.assistantMessageId ?? '',
  ].join('|');

  if (recordedUsageProgressSignatures.get(progress.requestId) === signature) return;
  recordedUsageProgressSignatures.set(progress.requestId, signature);
  if (recordedUsageProgressSignatures.size > 200) {
    const firstKey = recordedUsageProgressSignatures.keys().next().value;
    if (typeof firstKey === 'string') recordedUsageProgressSignatures.delete(firstKey);
  }

  void sendRuntimeMessage({
    type: 'RECORD_USAGE_TURN',
    payload: {
      id: progress.requestId,
      recordedAt: Date.now(),
      source: 'deepseek-web',
      chatSessionId: progress.chatSessionId ?? getCurrentChatSessionId(),
      assistantMessageId: progress.assistantMessageId ?? null,
      modelType: progress.modelType,
      totalTokens: Math.round(totalTokens),
      tokenSource: progress.tokenSource,
      tps: progress.tokensPerSecond,
      speedSource: progress.speedSource,
      elapsedMs: progress.elapsedMs,
      messageCount: 2,
    },
  });
}

function renderTokenSpeedIndicator(progress: ResponseTokenSpeedPayload): boolean {
  const badge = ensureTokenSpeedIndicator();
  if (!badge) return false;

  const tokens = progress.accumulatedTokens ?? progress.estimatedTokens;
  const tokenText = formatTokenCount(tokens);
  const speed = formatTokenSpeed(progress.tokensPerSecond);
  badge.textContent = `${tokenText} tok · ${speed}`;
  badge.dataset.active = progress.active ? 'true' : 'false';
  badge.dataset.tokenSource = progress.tokenSource;
  badge.dataset.speedSource = progress.speedSource;
  badge.setAttribute('aria-label', `Accumulated tokens ${tokenText}, token output speed ${speed}`);
  badge.setAttribute('title', contentT('content.tokenSpeed.title', {
    tokens: `${tokenText} tok`,
    speed,
    idle: progress.active ? '' : contentT('content.tokenSpeed.idleSuffix'),
    tokenSource: progress.tokenSource === 'server'
      ? contentT('content.tokenSpeed.sourceServer')
      : contentT('content.tokenSpeed.sourceEstimated'),
    speedSource: progress.speedSource === 'server'
      ? contentT('content.tokenSpeed.sourceServer')
      : contentT('content.tokenSpeed.sourceEstimated'),
  }));
  return true;
}

function formatTokenCount(tokens: number): string {
  const safeTokens = Number.isFinite(tokens) && tokens > 0 ? Math.round(tokens) : 0;
  return new Intl.NumberFormat(currentContentLocale).format(safeTokens);
}

function formatTokenSpeed(tokensPerSecond: number): string {
  const safeRate = Number.isFinite(tokensPerSecond) && tokensPerSecond > 0 ? tokensPerSecond : 0;
  const value = safeRate >= 100 ? String(Math.round(safeRate)) : safeRate.toFixed(1);
  return `${value} tok/s`;
}

function startTokenSpeedIndicatorBootstrap() {
  stopTokenSpeedIndicatorBootstrap();
  tokenSpeedBootstrapAttempts = 0;
  scheduleTokenSpeedIndicatorBootstrap();
}

function stopTokenSpeedIndicatorBootstrap() {
  if (!tokenSpeedBootstrapTimer) return;
  clearTimeout(tokenSpeedBootstrapTimer);
  tokenSpeedBootstrapTimer = null;
}

function scheduleTokenSpeedIndicatorBootstrap() {
  if (tokenSpeedBootstrapTimer) return;

  tokenSpeedBootstrapTimer = setTimeout(() => {
    tokenSpeedBootstrapTimer = null;
    const rendered = renderTokenSpeedIndicator(lastTokenSpeedProgress);
    if (rendered) return;

    tokenSpeedBootstrapAttempts += 1;
    if (tokenSpeedBootstrapAttempts < TOKEN_SPEED_BOOTSTRAP_RETRY_LIMIT) {
      scheduleTokenSpeedIndicatorBootstrap();
    }
  }, tokenSpeedBootstrapAttempts === 0 ? 0 : TOKEN_SPEED_BOOTSTRAP_RETRY_MS);
}

function startTokenSpeedIndicatorMountObserver() {
  stopTokenSpeedIndicatorMountObserver();
  const root = document.getElementById('root') ?? document.body;
  if (!root) return;

  tokenSpeedMountObserver = new MutationObserver(scheduleTokenSpeedIndicatorMountRefresh);
  tokenSpeedMountObserver.observe(root, { childList: true, subtree: false });
  scheduleTokenSpeedIndicatorMountRefresh();
}

function stopTokenSpeedIndicatorMountObserver() {
  tokenSpeedMountObserver?.disconnect();
  tokenSpeedMountObserver = null;
  if (tokenSpeedMountTimer) {
    clearTimeout(tokenSpeedMountTimer);
    tokenSpeedMountTimer = null;
  }
}

function scheduleTokenSpeedIndicatorMountRefresh() {
  if (tokenSpeedMountTimer) return;

  tokenSpeedMountTimer = setTimeout(() => {
    tokenSpeedMountTimer = null;
    applyCurrentRouteChange();
    if (isTokenSpeedIndicatorMountedInConversation()) return;
    renderTokenSpeedIndicator(lastTokenSpeedProgress);
  }, TOKEN_SPEED_MOUNT_DEBOUNCE_MS);
}

function startTokenSpeedRouteWatcher() {
  stopTokenSpeedRouteWatcher();
  tokenSpeedRouteKey = getTokenSpeedRouteKey();
  window.addEventListener('popstate', handleTokenSpeedRouteChange);
  window.addEventListener('hashchange', handleTokenSpeedRouteChange);
  tokenSpeedRouteTimer = setInterval(handleTokenSpeedRouteChange, TOKEN_SPEED_ROUTE_CHECK_MS);
}

function stopTokenSpeedRouteWatcher() {
  window.removeEventListener('popstate', handleTokenSpeedRouteChange);
  window.removeEventListener('hashchange', handleTokenSpeedRouteChange);
  if (tokenSpeedRouteTimer) {
    clearInterval(tokenSpeedRouteTimer);
    tokenSpeedRouteTimer = null;
  }
}

function handleTokenSpeedRouteChange() {
  closeConversationExportMenuIfSessionChanged();
  scheduleMultimodalMediaMount();
  if (applyCurrentRouteChange()) {
    renderTokenSpeedIndicator(lastTokenSpeedProgress);
  }
}

function applyCurrentRouteChange(): boolean {
  const previousRouteKey = tokenSpeedRouteKey;
  const nextRouteKey = getTokenSpeedRouteKey();
  if (nextRouteKey === previousRouteKey) return false;
  handleMultimodalMediaRouteChange(previousRouteKey, nextRouteKey);
  tokenSpeedRouteKey = nextRouteKey;
  lastTokenSpeedProgress = createIdleTokenSpeedProgress();
  removeTokenSpeedIndicator();
  return true;
}

function startToolBlockRouteWatcher() {
  stopToolBlockRouteWatcher();
  toolBlockRouteKey = getTokenSpeedRouteKey();
  window.addEventListener('popstate', handleToolBlockRouteChange);
  window.addEventListener('hashchange', handleToolBlockRouteChange);
  toolBlockRouteTimer = setInterval(handleToolBlockRouteChange, TOOL_BLOCK_ROUTE_CHECK_MS);
}

function stopToolBlockRouteWatcher() {
  window.removeEventListener('popstate', handleToolBlockRouteChange);
  window.removeEventListener('hashchange', handleToolBlockRouteChange);
  if (toolBlockRouteTimer) {
    clearInterval(toolBlockRouteTimer);
    toolBlockRouteTimer = null;
  }
}

function handleToolBlockRouteChange() {
  const nextRouteKey = getTokenSpeedRouteKey();
  if (nextRouteKey === toolBlockRouteKey) return;
  toolBlockRouteKey = nextRouteKey;

  const activeSession = getActiveToolBlockSession();
  if (activeSession && !isToolBlockSessionOnCurrentRoute(activeSession)) {
    toolBlockEl = null;
    toolExecutions = [];
  }

  renderActiveToolBlockForCurrentRoute();
  void restorePersistedToolBlocks();
  scheduleRenderRestoredToolBlocks();
}

function getTokenSpeedRouteKey(): string {
  if (typeof location === 'undefined') return '';
  return `${location.pathname}${location.search}`;
}

function isTokenSpeedIndicatorMountedInConversation(): boolean {
  const sessionId = getCurrentChatSessionId();
  const previous = tokenSpeedEl?.previousElementSibling;
  return Boolean(
    tokenSpeedEl?.isConnected &&
    previous instanceof HTMLButtonElement &&
    previous.classList.contains(EXPORT_ACTION_CLASS) &&
    (!sessionId || previous.dataset.dppExportSessionId === sessionId),
  );
}

function removeTokenSpeedIndicator() {
  tokenSpeedEl?.remove();
  tokenSpeedEl = null;
}

function ensureTokenSpeedIndicator(): HTMLElement | null {
  injectTokenSpeedStyles();

  const anchorButton = findTokenStatsAnchorButton();
  if (!anchorButton) return null;

  if (tokenSpeedEl && tokenSpeedEl.isConnected && tokenSpeedEl.previousElementSibling === anchorButton) {
    return tokenSpeedEl;
  }

  tokenSpeedEl?.remove();

  const badge = document.createElement('div');
  badge.id = TOKEN_SPEED_BADGE_ID;
  badge.className = 'dpp-token-speed-badge';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  anchorButton.insertAdjacentElement('afterend', badge);
  tokenSpeedEl = badge;
  return badge;
}

function findTokenStatsAnchorButton(): HTMLButtonElement | null {
  const sessionId = getCurrentChatSessionId();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`.${EXPORT_ACTION_CLASS}`))
    .filter((button) => {
      if (!isVisibleElement(button)) return false;
      return !sessionId || button.dataset.dppExportSessionId === sessionId;
    })
    .sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.top - bRect.top || aRect.left - bRect.left;
    });
  return buttons[buttons.length - 1] ?? null;
}

function injectTokenSpeedStyles() {
  if (document.getElementById(TOKEN_SPEED_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOKEN_SPEED_STYLE_ID;
  style.textContent = `
    .dpp-token-speed-badge {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      min-height: 20px;
      max-width: min(180px, 45vw);
      margin-left: 4px;
      padding: 2px 8px;
      border: 1px solid rgba(77, 107, 254, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.88);
      color: #4b5563;
      font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }

    body.dpp-theme-dark .dpp-token-speed-badge {
      border-color: rgba(125, 145, 255, 0.28);
      background: rgba(22, 26, 36, 0.86);
      color: #d1d7e6;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
    }

    .dpp-token-speed-badge[data-active='false'] {
      opacity: 0.72;
    }
  `;
  document.head.appendChild(style);
}




function clampText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? value.slice(0, maxLength) + '\n...[truncated]' : value;
}

function syncToMainWorld(
  memories: Memory[],
  skills: Skill[],
  activePreset: SystemPromptPreset | null,
  modelType: ModelType,
  toolDescriptors: ToolDescriptor[],
  promptSettings: PromptInjectionSettings = currentPromptSettings,
) {
  currentMemories = memories;
  currentSkills = skills;
  currentActivePreset = activePreset;
  currentModelType = modelType;
  currentToolDescriptors = toolDescriptors;
  currentPromptSettings = normalizePromptInjectionSettings(promptSettings);
  toolOpenTagRe = buildToolOpenTagRegex(toolDescriptors);
  toolMarkerRe = buildToolMarkerRegex(toolDescriptors);

  postToMainWorld({
    type: 'SYNC_HOOK_STATE',
    toolDescriptors,
    skillSummaries: skills
      .filter((skill) => skill.enabled !== false)
      .map((skill) => ({ name: skill.name, description: skill.description })),
    skillPopupCopy: {
      hint: contentT('content.skillPopup.hint'),
    },
  });
}

function syncCurrentRuntimeStateToMainWorld(): void {
  syncToMainWorld(
    currentMemories,
    currentSkills,
    currentActivePreset,
    currentModelType,
    currentToolDescriptors,
    currentPromptSettings,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeToolDescriptors(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value) || !value.every(isToolDescriptorRecord)) {
    throw new Error('Runtime tool descriptor catalog does not match the released contract.');
  }
  return value as unknown as ToolDescriptor[];
}

function reportToolDescriptorSyncFailure(error: unknown): void {
  console.error('[DeepSeek++] tool descriptor sync failed; tool execution disabled', error);
  syncToMainWorld(
    currentMemories,
    currentSkills,
    currentActivePreset,
    currentModelType,
    [],
    currentPromptSettings,
  );
}

function buildToolOpenTagRegex(descriptors: ToolDescriptor[]): RegExp {
  const pattern = buildToolTagPattern(descriptors);
  return new RegExp(`<\\s*(${pattern})\\s*>`, 'i');
}

function buildToolMarkerRegex(descriptors: ToolDescriptor[]): RegExp {
  const pattern = buildToolTagPattern(descriptors);
  return new RegExp(`<\\s*/?\\s*(?:${pattern})\\s*>`, 'i');
}

function buildToolTagPattern(descriptors: ToolDescriptor[]): string {
  const catalogNames = createToolInvocationCatalog(descriptors).invocationNames;
  const escaped = [...new Set(catalogNames)].map(escapeRegExp);
  return escaped.length > 0 ? escaped.join('|') : '(?!)';
}

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function getToolBlockUrl(): string {
  return `${location.origin}${location.pathname}${location.search}`;
}

function getToolBlockUrlForChatSession(chatSessionId: string | null | undefined): string {
  return createToolRestoreBlockUrl({
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
    chatSessionId,
  });
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function getInlineAgentAnchorContent(complete: ResponseCompletePayload): string {
  return stripToolCalls(complete.text, { descriptors: currentToolDescriptors }).trim();
}

function createInlineAgentTrace(
  complete: ResponseCompletePayload,
  loopId: string,
  seedToolCount: number,
  anchorMessageIndex: number | null,
  anchorContent: string,
): InlineAgentTraceRecord {
  const now = Date.now();
  return {
    id: hashString(`${complete.chatSessionId}\n${complete.assistantMessageId}\n${complete.agentTaskPrompt || complete.originalPrompt}`),
    loopId,
    chatSessionId: complete.chatSessionId!,
    anchorMessageId: complete.assistantMessageId!,
    anchorMessageIndex,
    anchorContent,
    url: getToolBlockUrlForChatSession(complete.chatSessionId),
    originalPrompt: complete.originalPrompt,
    agentTaskPrompt: complete.agentTaskPrompt,
    status: 'running',
    steps: [],
    totalSteps: 0,
    totalTools: seedToolCount,
    finalText: '',
    createdAt: now,
    updatedAt: now,
  };
}

function getInlineAgentStepText(step: HTMLElement): string {
  const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
  return (body?.getAttribute('data-dpp-raw-text') ?? body?.textContent ?? '').trim();
}

function updateActiveInlineAgentTrace(
  updater: (trace: InlineAgentTraceRecord) => InlineAgentTraceRecord,
  options: { immediate?: boolean } = {},
): void {
  if (!activeInlineAgentTrace) return;

  activeInlineAgentTrace = {
    ...updater(activeInlineAgentTrace),
    updatedAt: Date.now(),
  };

  if (options.immediate) {
    if (inlineAgentTraceWriteTimer) {
      clearTimeout(inlineAgentTraceWriteTimer);
      inlineAgentTraceWriteTimer = null;
    }
    void writeInlineAgentTrace(activeInlineAgentTrace);
    return;
  }

  scheduleInlineAgentTraceWrite(activeInlineAgentTrace);
}

function upsertInlineAgentTraceStep(
  trace: InlineAgentTraceRecord,
  step: InlineAgentTraceStepRecord,
): InlineAgentTraceRecord {
  const existing = trace.steps.filter((item) => item.index !== step.index);
  const steps = [...existing, step].sort((a, b) => a.index - b.index);
  return {
    ...trace,
    steps,
    totalSteps: Math.max(trace.totalSteps, step.index + 1),
  };
}

function updateInlineAgentTraceStep(
  trace: InlineAgentTraceRecord,
  stepIndex: number,
  patch: Partial<InlineAgentTraceStepRecord>,
): InlineAgentTraceRecord {
  const current = trace.steps.find((step) => step.index === stepIndex) ?? {
    index: stepIndex,
    status: 'streaming' as const,
    text: '',
    toolExecutions: [],
    responseMessageId: null,
    collapsed: false,
  };
  return upsertInlineAgentTraceStep(trace, { ...current, ...patch, index: stepIndex });
}

function scheduleInlineAgentTraceWrite(trace: InlineAgentTraceRecord): void {
  if (inlineAgentTraceWriteTimer) clearTimeout(inlineAgentTraceWriteTimer);
  inlineAgentTraceWriteTimer = setTimeout(() => {
    inlineAgentTraceWriteTimer = null;
    const latest = activeInlineAgentTrace?.id === trace.id ? activeInlineAgentTrace : trace;
    void writeInlineAgentTrace(latest);
  }, INLINE_AGENT_TRACE_WRITE_DEBOUNCE_MS);
}

async function writeInlineAgentTrace(trace: InlineAgentTraceRecord): Promise<void> {
  const stored = sanitizeInlineAgentTraceForStorage(trace);
  const existing = await getPersistedInlineAgentTraces();
  const now = Date.now();
  const next = [
    ...existing.filter((item) => item.id !== stored.id),
    stored,
  ]
    .filter((item) => now - item.createdAt < INLINE_AGENT_TRACE_TTL_MS)
    .slice(-INLINE_AGENT_TRACE_LIMIT);

  await setLocalStorageValue(INLINE_AGENT_TRACE_STORAGE_KEY, next);
  restoredInlineAgentTraces.set(stored.id, stored);
}

async function getPersistedInlineAgentTraces(): Promise<InlineAgentTraceRecord[]> {
  const traces = await getLocalStorageValue<unknown>(INLINE_AGENT_TRACE_STORAGE_KEY);
  return Array.isArray(traces) ? traces.filter(isInlineAgentTraceRecord) : [];
}

function isInlineAgentTraceRecord(value: unknown): value is InlineAgentTraceRecord {
  if (!value || typeof value !== 'object') return false;
  const trace = value as Partial<InlineAgentTraceRecord>;
  return typeof trace.id === 'string' &&
    typeof trace.loopId === 'string' &&
    typeof trace.chatSessionId === 'string' &&
    typeof trace.anchorMessageId === 'number' &&
    (trace.anchorMessageIndex === undefined || trace.anchorMessageIndex === null || typeof trace.anchorMessageIndex === 'number') &&
    (trace.anchorContent === undefined || typeof trace.anchorContent === 'string') &&
    (trace.finalText === undefined || typeof trace.finalText === 'string') &&
    typeof trace.url === 'string' &&
    typeof trace.createdAt === 'number' &&
    typeof trace.updatedAt === 'number' &&
    Array.isArray(trace.steps) &&
    trace.steps.every(isInlineAgentTraceStepRecord);
}

function isInlineAgentTraceStepRecord(value: unknown): value is InlineAgentTraceStepRecord {
  if (!value || typeof value !== 'object') return false;
  const step = value as Partial<InlineAgentTraceStepRecord>;
  return typeof step.index === 'number' &&
    typeof step.status === 'string' &&
    typeof step.text === 'string' &&
    Array.isArray(step.toolExecutions) &&
    typeof step.collapsed === 'boolean';
}

function sanitizeInlineAgentTraceForStorage(trace: InlineAgentTraceRecord): InlineAgentTraceRecord {
  return {
    ...trace,
    originalPrompt: clampText(trace.originalPrompt, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '',
    agentTaskPrompt: clampText(trace.agentTaskPrompt, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '',
    anchorContent: clampText(trace.anchorContent, INLINE_AGENT_STEP_RENDER_MAX_CHARS),
    finalText: clampText(trace.finalText, INLINE_AGENT_FINAL_RENDER_MAX_CHARS) ?? '',
    error: clampText(trace.error, 2000),
    steps: trace.steps.map(sanitizeInlineAgentTraceStep),
  };
}

function sanitizeInlineAgentTraceStep(step: InlineAgentTraceStepRecord): InlineAgentTraceStepRecord {
  return {
    ...step,
    text: clampText(step.text, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '',
    toolExecutions: step.toolExecutions.map((execution) => sanitizeToolExecutionForRestoreStorage(execution)),
  };
}

async function restorePersistedInlineAgentTraces(): Promise<void> {
  const url = getToolBlockUrl();
  const traces = await getPersistedInlineAgentTraces();
  let changed = false;

  for (const trace of traces) {
    if (!shouldTryRestoreInlineAgentTrace(trace, url) || restoredInlineAgentTraces.has(trace.id)) continue;
    restoredInlineAgentTraces.set(trace.id, normalizeRestoredInlineAgentTrace(trace));
    changed = true;
  }

  if (changed) scheduleRenderRestoredInlineAgentTraces();
}

function normalizeRestoredInlineAgentTrace(trace: InlineAgentTraceRecord): InlineAgentTraceRecord {
  const wasInterrupted = trace.status === 'running';
  const finalText = typeof trace.finalText === 'string' ? trace.finalText : '';
  return {
    ...trace,
    status: wasInterrupted ? 'stopping' : trace.status,
    error: wasInterrupted ? contentT('content.agent.stopped') : trace.error,
    finalText: clampText(finalText, INLINE_AGENT_FINAL_RENDER_MAX_CHARS) ?? '',
    steps: trace.steps.map((step) => ({
      ...step,
      status: wasInterrupted && step.status === 'streaming' ? 'error' : step.status,
      collapsed: true,
      text: clampText(step.text, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '',
      toolExecutions: step.toolExecutions.map((execution) => normalizeRestoredToolExecution(execution)),
    })),
  };
}

function shouldTryRestoreInlineAgentTrace(trace: InlineAgentTraceRecord, currentUrl: string): boolean {
  if (trace.chatSessionId) return getCurrentChatSessionId() === trace.chatSessionId;
  return trace.url === currentUrl;
}

async function getPersistedToolBlocks(): Promise<PersistedToolBlock[]> {
  const blocks = await getLocalStorageValue<unknown>(TOOL_RESTORE_STORAGE_KEY);
  return Array.isArray(blocks) ? blocks : [];
}

function getOrCreateActiveToolBlockSession(call: ToolCall): ActiveToolBlockSession {
  const chatSessionId = call.source?.chatSessionId ?? null;
  const parentMessageId = call.source?.parentMessageId ?? null;
  const requestId = call.source?.requestId ?? null;
  if (!requestId && !chatSessionId) {
    const activeSession = getActiveToolBlockSession();
    if (activeSession && !activeSession.requestId && !activeSession.chatSessionId && isToolBlockSessionOnCurrentRoute(activeSession)) {
      return activeSession;
    }
  }

  const url = getToolBlockUrlForChatSession(chatSessionId);
  const id = createToolRestoreBlockId({
    requestId,
    chatSessionId,
    parentMessageId,
    fallbackUrl: url,
    fallbackSeed: call.raw,
  });

  const existing = activeToolBlockSessions.get(id);
  if (existing) return existing;

  const now = Date.now();
  const session: ActiveToolBlockSession = {
    id,
    url,
    chatSessionId,
    requestId,
    parentMessageId,
    content: '',
    executions: [],
    createdAt: now,
    updatedAt: now,
  };
  activeToolBlockSessions.set(id, session);
  return session;
}

function getActiveToolBlockSessionForComplete(complete: ResponseCompletePayload): ActiveToolBlockSession | null {
  const chatSessionId = complete.chatSessionId;
  const url = getToolBlockUrlForChatSession(chatSessionId);
  const id = createToolRestoreBlockId({
    requestId: complete.requestId || null,
    chatSessionId,
    parentMessageId: complete.parentMessageId,
    fallbackUrl: url,
    fallbackSeed: complete.agentTaskPrompt || complete.originalPrompt,
  });

  return activeToolBlockSessions.get(id) ??
    (activeToolBlockSessionId ? activeToolBlockSessions.get(activeToolBlockSessionId) ?? null : null);
}

function getCurrentRouteActiveToolBlockSession(): ActiveToolBlockSession | null {
  for (const session of activeToolBlockSessions.values()) {
    if (isToolBlockSessionOnCurrentRoute(session)) return session;
  }
  return null;
}

function getActiveToolBlockSession(): ActiveToolBlockSession | null {
  return activeToolBlockSessionId ? activeToolBlockSessions.get(activeToolBlockSessionId) ?? null : null;
}

async function persistToolBlockSession(session: ActiveToolBlockSession, fullText?: string, complete?: ResponseCompletePayload) {
  if (session.executions.length === 0) return;

  const content = fullText ? stripToolCalls(fullText, { descriptors: currentToolDescriptors }) : '';
  session.content = content || session.content;
  session.updatedAt = Date.now();

  const block: PersistedToolBlock = {
    id: session.id,
    source: 'storage',
    url: session.url,
    createdAt: session.createdAt,
    content: session.content,
    executions: session.executions.map((execution) => sanitizeToolExecutionForRestoreStorage(execution)),
    metadata: {
      requestId: session.requestId ?? '',
      chatSessionId: session.chatSessionId ?? '',
      parentMessageId: session.parentMessageId ?? null,
      assistantMessageId: complete?.assistantMessageId ?? null,
      toolCount: session.executions.length,
      mcpToolCount: session.executions.filter((execution) => execution.provider?.kind === 'mcp').length,
      updatedAt: session.updatedAt,
    },
  };

  const existing = await getPersistedToolBlocks();
  const next = [
    ...existing.filter((item) => item.id !== block.id),
    block,
  ]
    .filter((item) => Date.now() - item.createdAt < 1000 * 60 * 60 * 24 * 30)
    .slice(-100);

  await setLocalStorageValue(TOOL_RESTORE_STORAGE_KEY, next);
  restoredToolRecords.set(block.id, block);
  scheduleRenderRestoredToolBlocks();
}

async function restorePersistedToolBlocks() {
  const url = getToolBlockUrl();
  const blocks = await getPersistedToolBlocks();
  rememberRestoredToolRecords(
    blocks
      .filter((block) => shouldTryRestoreToolBlock(block, url))
      .map((block) => ({ ...block, source: 'storage' as const })),
  );
}

function shouldTryRestoreToolBlock(block: PersistedToolBlock, currentUrl: string): boolean {
  const chatSessionId = getToolRecordChatSessionId(block);
  if (chatSessionId) return getCurrentChatSessionId() === chatSessionId;
  if (isToolRecordOnCurrentRoute(block, currentUrl)) return true;

  try {
    return new URL(block.url).origin === location.origin;
  } catch {
    return false;
  }
}

function isToolRecordOnCurrentRoute(record: ToolCallRestoreRecord, currentUrl = getToolBlockUrl()): boolean {
  const chatSessionId = getToolRecordChatSessionId(record);
  if (chatSessionId) return getCurrentChatSessionId() === chatSessionId;
  return record.url === currentUrl;
}

function getToolRecordChatSessionId(record: ToolCallRestoreRecord): string | null {
  const metadataSessionId = record.metadata?.chatSessionId;
  if (typeof metadataSessionId === 'string' && metadataSessionId) return metadataSessionId;
  if (!record.url) return null;
  return getChatSessionIdFromUrl(record.url);
}

function getToolRecordAssistantMessageId(record: ToolCallRestoreRecord): string | null {
  return firstMetadataId(record.metadata?.assistantMessageId, record.metadata?.messageId);
}

function getToolRecordParentMessageId(record: ToolCallRestoreRecord): string | null {
  return firstMetadataId(record.metadata?.parentMessageId);
}

function firstMetadataId(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getChatSessionIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, location.origin);
    const match = parsed.pathname.match(/\/(?:a\/)?chat\/s\/([^/?#]+)/);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function rememberRestoredToolRecords(records: ToolCallRestoreRecord[] | undefined) {
  if (!records || records.length === 0) return;

  let changed = false;
  for (const record of records) {
    if (!record.id) continue;

    const compatibleId = findCompatibleRestoredToolRecordId(record);
    if (compatibleId) {
      const existing = restoredToolRecords.get(compatibleId)!;
      restoredToolRecords.set(compatibleId, mergeToolRestoreRecords(existing, record));
      changed = true;
      continue;
    }

    if (restoredToolRecords.has(record.id)) continue;
    restoredToolRecords.set(record.id, record);
    changed = true;
  }

  if (changed) {
    scheduleRenderRestoredToolBlocks();
    scheduleRenderRestoredInlineAgentTraces();
  }
}

function findCompatibleRestoredToolRecordId(record: ToolCallRestoreRecord): string | null {
  for (const [id, existing] of restoredToolRecords) {
    if (isCompatibleToolRestoreRecord(existing, record)) return id;
  }
  return null;
}

function isCompatibleToolRestoreRecord(a: ToolCallRestoreRecord, b: ToolCallRestoreRecord): boolean {
  const aMessageId = getToolRecordAssistantMessageId(a);
  const bMessageId = getToolRecordAssistantMessageId(b);
  if (aMessageId && bMessageId && aMessageId === bMessageId) return true;

  const aParentId = getToolRecordParentMessageId(a);
  const bParentId = getToolRecordParentMessageId(b);
  if (aParentId && bParentId && aParentId === bParentId && haveMatchingToolSignatures(a, b)) return true;

  const aContent = normalizeText(a.content);
  const bContent = normalizeText(b.content);
  return aContent.length >= 12 &&
    bContent.length >= 12 &&
    (aContent.includes(bContent.slice(0, 80)) || bContent.includes(aContent.slice(0, 80))) &&
    haveMatchingToolSignatures(a, b);
}

function mergeToolRestoreRecords(
  existing: ToolCallRestoreRecord,
  incoming: ToolCallRestoreRecord,
): ToolCallRestoreRecord {
  return {
    ...existing,
    ...incoming,
    id: existing.id,
    source: existing.source === 'storage' || incoming.source === 'storage' ? 'storage' : existing.source ?? incoming.source,
    content: preferNonEmptyText(incoming.content, existing.content),
    calls: incoming.calls?.length ? incoming.calls : existing.calls,
    executions: incoming.executions?.length ? incoming.executions : existing.executions,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
  };
}

function preferNonEmptyText(primary: string | undefined, fallback: string | undefined): string | undefined {
  return primary && normalizeText(primary).length > 0 ? primary : fallback;
}

function haveMatchingToolSignatures(a: ToolCallRestoreRecord, b: ToolCallRestoreRecord): boolean {
  const aSignature = getToolRecordSignature(a);
  const bSignature = getToolRecordSignature(b);
  if (!aSignature || !bSignature) return false;
  return aSignature === bSignature;
}

function getToolRecordSignature(record: ToolCallRestoreRecord): string | null {
  const calls = record.calls;
  if (calls?.length) {
    return calls.map((call) => `${call.provider?.id ?? ''}:${call.name}:${JSON.stringify(call.payload)}`).join('|');
  }
  const executions = record.executions;
  if (executions?.length) {
    return executions.map((execution) => `${execution.provider?.id ?? ''}:${execution.name}`).join('|');
  }
  return null;
}

async function appendExternalToolPayloadChunk(chunk: ToolCallPayloadChunk): Promise<void> {
  const authorization = chunk.requestId
    ? activeToolAuthorizations.get(chunk.requestId)
    : undefined;
  if (!authorization) {
    throw new Error('Externalized tool payload has no active authorization context.');
  }
  const pendingKey = `${authorization.id}:${chunk.id}`;
  const previous = pendingExternalToolPayloadWrites.get(pendingKey) ?? Promise.resolve();
  const next = chainExternalizedPayloadWrite(previous, async () => {
      await sendRuntimeMessageStrict({
        type: 'APPEND_EXTERNAL_TOOL_PAYLOAD_CHUNK',
        payload: {
          authorizationId: authorization.id,
          callId: chunk.id,
          invocationName: chunk.invocationName,
          chunk: chunk.chunk,
        },
      });
    });
  pendingExternalToolPayloadWrites.set(pendingKey, next);
  await next;
}

async function waitForExternalToolPayloadWrites(call: ToolCall): Promise<void> {
  const authorization = getToolAuthorizationForCall(call);
  const pendingKey = authorization ? `${authorization.id}:${call.id}` : call.id;
  if (!pendingKey) return;
  const pending = pendingExternalToolPayloadWrites.get(pendingKey);
  if (!pending) return;
  try {
    await pending;
  } finally {
    pendingExternalToolPayloadWrites.delete(pendingKey);
  }
}

async function executeToolCall(
  call: ToolCall,
  authorizationId?: string,
): Promise<ToolCardResult> {
  if (call.parseError) {
    return {
      ok: false,
      summary: contentT('tool.runtime.invalidFormat'),
      detail: call.parseError.message,
      error: call.parseError,
    };
  }

  const authorization = authorizationId ?? getToolAuthorizationForCall(call)?.id;
  const result = await sendRuntimeToolCallMessage(call, authorization);
  const normalized = normalizeRuntimeToolCallResult(result);

  if (normalized) {
    if (shouldRequestWebFetchPermission(call, normalized)) {
      const url = call.payload?.url;
      const granted = typeof url === 'string' ? await requestWebFetchPermission(url) : false;
      if (granted) {
        const retryResult = await sendRuntimeToolCallMessage(call, authorization);
        const retryNormalized = normalizeRuntimeToolCallResult(retryResult);
        if (retryNormalized) return retryNormalized;
      }
    }
    return normalized;
  }

  if (!extensionContextValid) {
    return {
      ok: false,
      summary: contentT('content.toolBlock.summaries.failed'),
      detail: contentT('content.extensionReloaded'),
    };
  }
  return createInvalidRuntimeToolResult(call, result);
}

async function sendRuntimeToolCallMessage(
  call: ToolCall,
  authorizationId?: string,
): Promise<unknown> {
  if (!hasLiveExtensionContext()) return undefined;

  try {
    return await chrome.runtime.sendMessage({
      type: 'EXECUTE_TOOL_CALL',
      payload: { ...call, authorizationId },
    });
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
      return undefined;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: contentT('content.toolBlock.summaries.messageFailed'),
      detail,
      error: {
        code: 'runtime_message_failed',
        message: detail,
        retryable: true,
      },
    };
  }
}

function normalizeRuntimeToolCallResult(value: unknown): ToolCardResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as Partial<ToolCardResult>;
  if (typeof result.ok !== 'boolean' || typeof result.summary !== 'string') return null;
  return {
    ok: result.ok,
    summary: result.summary,
    detail: result.detail,
    output: result.output,
    truncated: result.truncated,
    error: result.error,
  };
}

function createInvalidRuntimeToolResult(call: ToolCall, value: unknown): ToolCardResult {
  const missing = value === undefined || value === null;
  const message = missing
    ? 'Background did not return a tool result.'
    : `Background returned an invalid tool result: ${previewUnknown(value)}`;
  return {
    ok: false,
    summary: contentT('content.toolBlock.summaries.backgroundFailed'),
    detail: missing
      ? getMissingToolResultDetail(call)
      : contentT('content.toolBlock.invalidResultDetail', { preview: previewUnknown(value) }),
    error: {
      code: missing ? 'runtime_tool_result_missing' : 'runtime_tool_result_invalid',
      message,
      retryable: true,
    },
  };
}

function getMissingToolResultDetail(call: ToolCall): string {
  if (isSandboxRuntimeToolCall(call)) {
    return contentT('content.toolBlock.missingSandboxResultDetail');
  }
  if (isMcpRuntimeToolCall(call)) {
    return contentT('content.toolBlock.missingMcpResultDetail');
  }
  return contentT('content.toolBlock.missingResultDetail');
}

function isSandboxRuntimeToolCall(call: ToolCall): boolean {
  return call.name === 'sandbox_run' ||
    call.provider?.id === 'sandbox' ||
    call.descriptorId?.startsWith('local:sandbox:') === true;
}

function isMcpRuntimeToolCall(call: ToolCall): boolean {
  return call.provider?.kind === 'mcp' ||
    call.descriptorId?.startsWith('mcp:') === true;
}

function previewUnknown(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (text) return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    // Fall through to String(value).
  }
  const text = String(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

// --- Auto permission request for web_fetch ---

const PERMISSION_BANNER_ID = 'dpp-permission-banner';
const PERMISSION_BANNER_STYLE_ID = 'dpp-permission-banner-css';
const PERMISSION_BANNER_TIMEOUT_MS = 60_000;

interface ActivePermissionRequest {
  banner: HTMLElement;
  resolve: (granted: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

let activePermissionRequest: ActivePermissionRequest | null = null;

async function requestWebFetchPermission(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }

  finishActivePermissionRequest(false);
  const banner = createPermissionBanner(origin);
  if (!banner) return false;

  try {
    const granted = await new Promise<boolean>((resolve) => {
      const session: ActivePermissionRequest = { banner, resolve, timeoutId: null };
      activePermissionRequest = session;

      const grantBtn = banner.querySelector<HTMLButtonElement>('.dpp-permission-grant');
      const denyBtn = banner.querySelector<HTMLButtonElement>('.dpp-permission-deny');
      if (!grantBtn || !denyBtn) {
        finishPermissionRequest(session, false);
        return;
      }

      const cleanup = (result: boolean) => {
        finishPermissionRequest(session, result);
      };
      session.timeoutId = setTimeout(() => cleanup(false), PERMISSION_BANNER_TIMEOUT_MS);

      grantBtn.addEventListener('click', async () => {
        grantBtn.textContent = contentT('content.permission.requesting');
        grantBtn.disabled = true;
        denyBtn.disabled = true;
        const permResult = await sendRuntimeMessage<{ ok: boolean }>({
          type: 'REQUEST_HOST_PERMISSION',
          payload: { origins: [`${origin}/*`] },
        });
        cleanup(permResult?.ok === true);
      }, { once: true });

      denyBtn.addEventListener('click', () => cleanup(false), { once: true });
    });

    return granted;
  } finally {
    if (banner.isConnected) banner.remove();
  }
}

function finishActivePermissionRequest(granted: boolean): void {
  if (!activePermissionRequest) return;
  finishPermissionRequest(activePermissionRequest, granted);
}

function finishPermissionRequest(session: ActivePermissionRequest, granted: boolean): void {
  if (activePermissionRequest !== session) return;
  activePermissionRequest = null;
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
  session.banner.remove();
  session.resolve(granted);
}

function createPermissionBanner(origin: string): HTMLElement | null {
  injectPermissionBannerStyles();

  const existing = document.getElementById(PERMISSION_BANNER_ID);
  if (existing) {
    finishActivePermissionRequest(false);
    existing.remove();
  }

  const banner = document.createElement('div');
  banner.id = PERMISSION_BANNER_ID;
  banner.className = 'dpp-permission-banner';
  banner.innerHTML = `
    <span class="dpp-permission-text">${contentT('content.permission.webFetch', {
      origin: `<strong>${escapeHtml(origin)}</strong>`,
    })}</span>
    <div class="dpp-permission-actions">
      <button type="button" class="dpp-permission-deny">${contentT('content.permission.deny')}</button>
      <button type="button" class="dpp-permission-grant">${contentT('content.permission.grant')}</button>
    </div>
  `;

  const inputArea = findDeepSeekInputBox();
  const target = inputArea?.parentElement ?? document.body;
  target.appendChild(banner);
  return banner;
}

function injectPermissionBannerStyles() {
  injectInjectedThemeStyles();
  if (document.getElementById(PERMISSION_BANNER_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = PERMISSION_BANNER_STYLE_ID;
  style.textContent = `
    .dpp-permission-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 16px;
      margin: 8px 12px;
      border-radius: 10px;
      background: var(--dpp-ui-surface);
      border: 1px solid var(--dpp-ui-accent);
      box-shadow: 0 2px 12px rgba(77, 107, 254, 0.15);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      color: var(--dpp-ui-text);
      animation: dppPermFadeIn 0.2s ease-out;
      z-index: 100;
    }

    .dpp-permission-text {
      flex: 1;
      min-width: 0;
    }

    .dpp-permission-text strong {
      color: var(--dpp-ui-accent);
    }

    .dpp-permission-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .dpp-permission-actions button {
      padding: 5px 14px;
      border-radius: 8px;
      border: 1px solid var(--dpp-ui-border);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .dpp-permission-deny {
      background: var(--dpp-ui-surface-muted);
      color: var(--dpp-ui-text-muted);
    }

    .dpp-permission-deny:hover {
      background: var(--dpp-ui-danger-panel);
      color: var(--dpp-ui-error);
      border-color: var(--dpp-ui-error);
    }

    .dpp-permission-grant {
      background: var(--dpp-ui-accent);
      color: #fff;
      border-color: var(--dpp-ui-accent);
    }

    .dpp-permission-grant:hover {
      opacity: 0.9;
    }

    .dpp-permission-grant:disabled,
    .dpp-permission-deny[disabled] {
      opacity: 0.5;
      cursor: not-allowed;
    }

    @keyframes dppPermFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

  `;
  document.head.appendChild(style);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// --- Tool execution collapsible block, aligned with the host reasoning block style. ---

function injectToolBlockStyles() {
  injectInjectedThemeStyles();
  if (document.getElementById(TOOL_BLOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOOL_BLOCK_STYLE_ID;
  style.textContent = `
    .dpp-tool-block {
      margin-top: 8px;
    }
    .dpp-artifact-results {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .dpp-artifact-results:empty {
      display: none;
    }
    .dpp-tool-block-header {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
      color: var(--dpp-ui-text-muted);
      font-size: 14px;
      line-height: 20px;
    }
    .dpp-tool-block-header:hover {
      color: var(--dpp-ui-text);
    }
    .dpp-tool-block-icon {
      width: 16px;
      height: 16px;
      color: var(--dpp-ui-accent);
      flex-shrink: 0;
    }
    .dpp-tool-block-title {
      font-weight: 500;
      color: inherit;
    }
    .dpp-tool-block-chevron {
      width: 12px;
      height: 12px;
      color: inherit;
      transition: transform 0.2s ease;
      margin-left: 2px;
    }
    .dpp-tool-block[data-collapsed="true"] .dpp-tool-block-chevron {
      transform: rotate(-90deg);
    }
    .dpp-tool-block-body {
      overflow: hidden;
      transition: max-height 0.25s ease, opacity 0.2s ease;
      max-height: 500px;
      opacity: 1;
      padding-left: 20px;
      margin-top: 6px;
    }
    .dpp-tool-block[data-collapsed="true"] .dpp-tool-block-body {
      max-height: 0;
      opacity: 0;
      margin-top: 0;
    }
    .dpp-tool-block-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 3px 0;
      font-size: 13px;
      color: var(--dpp-ui-text);
      line-height: 1.5;
    }
    .dpp-tool-block-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dpp-ui-accent);
      flex-shrink: 0;
      margin-top: 7px;
    }
    .dpp-tool-block-item-text {
      flex: 1;
      min-width: 0;
    }
    .dpp-tool-block-item-name {
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--dpp-ui-accent);
    }
    .dpp-tool-block-item-status {
      color: var(--dpp-ui-success);
      margin-left: 6px;
    }
    .dpp-tool-block-item-status.error {
      color: var(--dpp-ui-error);
    }
    .dpp-tool-block-item-detail {
      margin-top: 4px;
      padding: 6px 8px;
      max-height: min(52vh, 420px);
      border-radius: 6px;
      background: var(--dpp-ui-accent-panel);
      color: var(--dpp-ui-text-muted);
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow: auto;
      overflow-wrap: anywhere;
      overscroll-behavior: contain;
    }
    .dpp-manual-continuation {
      margin: 10px 0 0 20px;
      padding: 10px 12px;
      border-left: 2px solid var(--dpp-ui-accent);
      border-radius: 6px;
      background: var(--dpp-ui-accent-panel);
      color: var(--dpp-ui-text);
      font-size: 14px;
      line-height: 1.65;
    }
    .dpp-manual-continuation.error {
      border-left-color: var(--dpp-ui-error);
      background: var(--dpp-ui-danger-panel);
    }
    .dpp-manual-continuation-title {
      margin-bottom: 6px;
      color: var(--dpp-ui-accent);
      font-size: 12px;
      font-weight: 600;
    }
    .dpp-manual-continuation.error .dpp-manual-continuation-title {
      color: var(--dpp-ui-error);
    }
    .dpp-manual-continuation-content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);
}

function createToolBlockShell(options?: { id?: string; restoreId?: string; collapsed?: boolean }): HTMLElement {
  const block = document.createElement('div');
  if (options?.id) block.id = options.id;
  if (options?.restoreId) block.setAttribute('data-dpp-tool-key', options.restoreId);
  block.className = 'dpp-tool-block';
  block.setAttribute('data-collapsed', options?.collapsed ? 'true' : 'false');
  block.innerHTML = `
    <div class="dpp-tool-block-header">
      <svg class="dpp-tool-block-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
      <span class="dpp-tool-block-title"></span>
      <svg class="dpp-tool-block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </div>
    <div class="dpp-tool-block-body"></div>
  `;

  block.querySelector('.dpp-tool-block-header')!.addEventListener('click', () => {
    const collapsed = block.getAttribute('data-collapsed') === 'true';
    block.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
  });

  return block;
}

function updateToolBlockContent(block: HTMLElement, executions: ToolExecutionRecord[]) {
  const count = executions.length;
  const title = block.querySelector('.dpp-tool-block-title')!;
  title.textContent = contentT('content.toolBlock.title', { count });

  const body = block.querySelector('.dpp-tool-block-body')!;
  body.innerHTML = '';
  for (const exec of executions) {
    const item = document.createElement('div');
    item.className = 'dpp-tool-block-item';
    item.innerHTML = `
      <div class="dpp-tool-block-dot"></div>
      <div class="dpp-tool-block-item-text">
        <div>
          <span class="dpp-tool-block-item-name"></span>
          <span class="dpp-tool-block-item-status ${exec.result.ok ? '' : 'error'}"></span>
        </div>
      </div>
    `;
    const nameEl = item.querySelector('.dpp-tool-block-item-name')!;
    const statusEl = item.querySelector('.dpp-tool-block-item-status')!;
    nameEl.textContent = formatToolExecutionName(exec);
    statusEl.textContent = exec.result.summary;
    const detail = formatToolResultDetail(exec.result);
    if (detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'dpp-tool-block-item-detail';
      const rendered = isDetachedArtifactToolResult(exec.result)
        ? false
        : renderToolResultWithRegistry({
          target: detailEl,
          result: exec.result,
          locale: currentContentLocale,
          sendMessage: sendRuntimeMessage,
        });
      if (!rendered) detailEl.textContent = detail;
      item.querySelector('.dpp-tool-block-item-text')!.appendChild(detailEl);
    }
    body.appendChild(item);
  }
}

function formatToolResultDetail(result: ToolCardResult): string {
  if (result.detail) {
    if (!result.ok && looksLikeJson(result.detail)) {
      const extracted = extractReadableError(result.detail);
      if (extracted) return extracted;
    }
    return result.detail;
  }
  if (result.output === undefined) return '';
  return typeof result.output === 'string'
    ? result.output
    : JSON.stringify(result.output, null, 2);
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function extractReadableError(jsonText: string): string | null {
  try {
    const parsed = JSON.parse(jsonText);
    if (typeof parsed === 'string') return parsed;
    if (Array.isArray(parsed)) {
      const texts = parsed
        .filter((item: unknown) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
        .map((item: unknown) => (item as Record<string, unknown>).text)
        .filter((text: unknown): text is string => typeof text === 'string');
      if (texts.length > 0) return texts.join('\n');
    }
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.error === 'string') return parsed.error;
      if (parsed.error && typeof parsed.error === 'object' && typeof parsed.error.message === 'string') {
        return parsed.error.message;
      }
    }
  } catch { /* not valid JSON, return null */ }
  return null;
}

function formatToolExecutionName(exec: ToolExecutionRecord): string {
  if (exec.name === 'python_exec') return contentT('content.toolBlock.pythonInterpreter');
  return exec.provider?.displayName
    ? `${exec.provider.displayName} / ${exec.name}`
    : exec.name;
}

function renderActiveToolBlockForCurrentRoute(): void {
  const session = getCurrentRouteActiveToolBlockSession();
  if (!session) return;

  activeToolBlockSessionId = session.id;
  toolExecutions = session.executions;
  renderToolBlock(session);
}

function isToolBlockSessionOnCurrentRoute(session: ActiveToolBlockSession): boolean {
  if (session.chatSessionId) return getCurrentChatSessionId() === session.chatSessionId;
  return session.url === getToolBlockUrl();
}

function renderToolBlock(session: ActiveToolBlockSession = getActiveToolBlockSession() ?? {
  id: '',
  url: getToolBlockUrl(),
  chatSessionId: getCurrentChatSessionId(),
  requestId: null,
  parentMessageId: null,
  content: '',
  executions: toolExecutions,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}, options?: { skipCleanup?: boolean }) {
  if (session.executions.length === 0) return;
  if (!isToolBlockSessionOnCurrentRoute(session)) return;

  injectToolBlockStyles();

  const existing = findRestoredToolBlock(session.id) as HTMLElement | null;
  if (existing) {
    toolBlockEl = existing;
  } else if (!toolBlockEl || toolBlockEl.getAttribute('data-dpp-tool-key') !== session.id) {
    toolBlockEl = createToolBlockShell({ id: TOOL_BLOCK_ID, restoreId: session.id });
  }

  if (!toolBlockEl.isConnected) {
    const block = toolBlockEl;
    placeToolBlock(
      block,
      () => isToolBlockSessionOnCurrentRoute(session),
      (message) => renderDetachedArtifactResults(message, session.id, session.executions, block),
    );
  }

  if (!options?.skipCleanup) {
    cleanRenderedToolCalls();
  }
  updateToolBlockContent(toolBlockEl, session.executions);
  renderDetachedArtifactResultsForBlock(session, toolBlockEl);
}

function renderDetachedArtifactResultsForBlock(session: ActiveToolBlockSession, block: HTMLElement) {
  const message = block.closest('.ds-message');
  if (!message) return;
  renderDetachedArtifactResults(message, session.id, session.executions, block);
}

function renderDetachedArtifactResults(
  message: Element,
  sessionId: string,
  executions: ToolExecutionRecord[],
  beforeBlock?: HTMLElement,
) {
  const artifactExecutions = executions.filter(isDetachedArtifactExecution);
  const existing = findDetachedArtifactResults(message, sessionId);
  if (artifactExecutions.length === 0) {
    existing?.remove();
    return;
  }

  injectToolBlockStyles();
  const responseHost = getAssistantResponseHost(message);
  const container = existing ?? createDetachedArtifactResultsContainer(sessionId);
  container.innerHTML = '';
  for (const exec of artifactExecutions) {
    const item = document.createElement('div');
    item.className = 'dpp-artifact-result-item';
    const rendered = renderToolResultWithRegistry({
      target: item,
      result: exec.result,
      locale: currentContentLocale,
      sendMessage: sendRuntimeMessage,
    });
    if (rendered) container.appendChild(item);
  }

  if (container.childElementCount === 0) {
    container.remove();
    return;
  }

  const anchor = beforeBlock && beforeBlock.parentElement === responseHost ? beforeBlock : null;
  if (!container.isConnected) {
    responseHost.insertBefore(container, anchor);
  } else if (anchor && container.nextSibling !== anchor) {
    responseHost.insertBefore(container, anchor);
  }
}

function createDetachedArtifactResultsContainer(sessionId: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dpp-artifact-results';
  container.setAttribute('data-dpp-artifact-session-id', sessionId);
  return container;
}

function findDetachedArtifactResults(message: Element, sessionId: string): HTMLElement | null {
  const responseHost = getAssistantResponseHost(message);
  return Array.from(responseHost.querySelectorAll<HTMLElement>(':scope > .dpp-artifact-results'))
    .find((container) => container.getAttribute('data-dpp-artifact-session-id') === sessionId) ?? null;
}

function isDetachedArtifactExecution(execution: ToolExecutionRecord): boolean {
  return !execution.pending && isDetachedArtifactToolResult(execution.result);
}

function isDetachedArtifactToolResult(result: ToolCardResult): boolean {
  const output = result.output;
  return Boolean(
    output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    (output as Record<string, unknown>).kind === 'artifact',
  );
}

function scheduleRenderRestoredToolBlocks() {
  if (restoredRenderTimer) return;

  restoredRenderTimer = setTimeout(() => {
    restoredRenderTimer = null;
    const missing = renderRestoredToolBlocks();
    if (missing > 0 && restoredRenderAttempts < 20) {
      restoredRenderAttempts++;
      scheduleRenderRestoredToolBlocks();
      return;
    }
    restoredRenderAttempts = 0;
  }, restoredRenderAttempts === 0 ? 0 : 250);
}

function renderRestoredToolBlocks(): number {
  injectToolBlockStyles();

  const messages = getAssistantMessages();
  if (messages.length === 0) return restoredToolRecords.size;

  let missing = 0;
  const usedMessages = new Set<Element>();

  for (const record of restoredToolRecords.values()) {
    if (findRestoredToolBlock(record.id)) continue;

    const target = findRestoredToolTarget(record, messages, usedMessages);
    if (!target) {
      missing++;
      continue;
    }

    const executions = getRestoredExecutions(record);
    if (executions.length === 0) continue;

    const block = createToolBlockShell({ restoreId: record.id, collapsed: true });
    updateToolBlockContent(block, executions);
    appendToolBlockToMessage(target, block);
    renderDetachedArtifactResults(target, record.id, executions, block);
    usedMessages.add(target);
  }

  cleanRenderedToolCalls();
  return missing;
}

function scheduleRenderRestoredInlineAgentTraces() {
  if (restoredInlineAgentRenderTimer) return;

  restoredInlineAgentRenderTimer = setTimeout(() => {
    restoredInlineAgentRenderTimer = null;
    const missing = renderRestoredInlineAgentTraces();
    if (missing > 0 && restoredInlineAgentRenderAttempts < 20) {
      restoredInlineAgentRenderAttempts++;
      scheduleRenderRestoredInlineAgentTraces();
      return;
    }
    restoredInlineAgentRenderAttempts = 0;
  }, restoredInlineAgentRenderAttempts === 0 ? 0 : 250);
}

function renderRestoredInlineAgentTraces(): number {
  injectInlineAgentStyles();

  const messages = getAssistantMessages();
  if (messages.length === 0) return restoredInlineAgentTraces.size;

  let missing = 0;
  const usedMessages = new Set<Element>();

  for (const trace of restoredInlineAgentTraces.values()) {
    if (findRestoredInlineAgentTrace(trace.id)) continue;
    if (trace.steps.length === 0) continue;

    const target = findRestoredInlineAgentTarget(trace, messages, usedMessages);
    if (!target) {
      missing++;
      continue;
    }

    const container = createRestoredInlineAgentContainer(trace);
    mountRestoredInlineAgentContainer(target, container, trace);
    usedMessages.add(target);
  }

  return missing;
}

function findRestoredInlineAgentTrace(id: string): Element | null {
  for (const container of document.querySelectorAll('.dpp-agent-container[data-dpp-agent-trace-key]')) {
    if (container.getAttribute('data-dpp-agent-trace-key') === id) return container;
  }
  return null;
}

function findRestoredInlineAgentTarget(
  trace: InlineAgentTraceRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const anchored = findInlineAgentTargetByAnchor(trace, messages, usedMessages);
  if (anchored) return anchored;

  return null;
}

function findInlineAgentTargetByAnchor(
  trace: InlineAgentTraceRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const messageId = String(trace.anchorMessageId);
  const byId = messages.find((message) => {
    if (usedMessages.has(message)) return false;
    return elementHasMessageId(message, messageId);
  });
  if (byId) return byId;

  const byContent = findAssistantMessageByContentSnippet(messages, trace.anchorContent ?? '', usedMessages);
  if (byContent) return byContent;

  const byToolRecord = findInlineAgentTargetByToolRecord(trace, messages, usedMessages);
  if (byToolRecord) return byToolRecord;

  if (normalizeText(trace.anchorContent).length >= 12) return null;

  const index = typeof trace.anchorMessageIndex === 'number' && Number.isInteger(trace.anchorMessageIndex)
    ? trace.anchorMessageIndex
    : null;
  if (index === null || index < 0) return null;

  const byIndex = messages[index];
  if (!byIndex || usedMessages.has(byIndex)) return null;
  return byIndex;
}

function findInlineAgentTargetByToolRecord(
  trace: InlineAgentTraceRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const anchorMessageId = String(trace.anchorMessageId);
  for (const record of restoredToolRecords.values()) {
    const recordMessageId = getToolRecordAssistantMessageId(record);
    if (recordMessageId !== anchorMessageId) continue;

    const byContent = findAssistantMessageByContentSnippet(messages, record.content ?? '', usedMessages);
    if (byContent) return byContent;

    const byId = findRestoredToolTargetByMessageId(record, messages, usedMessages);
    if (byId) return byId;

    const byIndex = findRestoredToolTargetByAssistantIndex(record, messages, usedMessages);
    if (byIndex) return byIndex;
  }

  return null;
}

function findAssistantMessageByContentSnippet(
  messages: Element[],
  content: string,
  usedMessages: Set<Element>,
): Element | null {
  const snippet = normalizeText(content).slice(0, 100);
  if (snippet.length < 12) return null;

  return messages.find((message) => {
    if (usedMessages.has(message)) return false;
    return normalizeText(message.textContent ?? '').includes(snippet);
  }) ?? null;
}

function createRestoredInlineAgentContainer(trace: InlineAgentTraceRecord): HTMLElement {
  const container = createAgentContainer();
  container.setAttribute('data-restored', 'true');
  container.setAttribute('data-dpp-agent-trace-key', trace.id);
  container.setAttribute('data-dpp-agent-loop-id', trace.loopId);

  for (const step of [...trace.steps].sort((a, b) => a.index - b.index)) {
    const stepEl = createAgentStepElement(step.index, undefined, getAgentRendererLabels());
    const stepText = getInlineAgentDisplayFinalText(step.text) || step.text;
    updateStepStreamText(stepEl, clampText(stepText, INLINE_AGENT_STEP_RENDER_MAX_CHARS) ?? '');
    for (const exec of step.toolExecutions) {
      addToolResultToStep(stepEl, exec.name, exec.result.ok, exec.result.summary);
    }
    updateStepStatus(stepEl, step.status, getInlineAgentStepStatusLabel(step));
    stepEl.setAttribute('data-collapsed', step.collapsed ? 'true' : 'false');
    container.appendChild(stepEl);
  }

  if (trace.status === 'complete') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, false, undefined, getAgentRendererLabels()));
  } else if (trace.status === 'error') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, true, trace.error, getAgentRendererLabels()));
  } else if (trace.status === 'stopping') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, false, trace.error ?? contentT('content.agent.stopped'), getAgentRendererLabels()));
  }

  return container;
}

function getInlineAgentStepStatusLabel(step: InlineAgentTraceStepRecord): string {
  if (step.status === 'complete') {
    return step.toolExecutions.length > 0
      ? contentT('content.agent.completeWithTools', { count: step.toolExecutions.length })
      : contentT('content.agent.complete');
  }
  if (step.status === 'executing_tools') return contentT('content.agent.executingTools');
  if (step.status === 'error') return contentT('content.agent.error');
  return contentT('content.agent.streaming');
}

function mountRestoredInlineAgentContainer(
  message: Element,
  container: HTMLElement,
  trace: InlineAgentTraceRecord,
): void {
  const host = getAssistantResponseHost(message);
  host.appendChild(container);
  appendInlineAgentFinalAnswer(container, getInlineAgentDisplayFinalText(trace.finalText), trace.loopId);
}

function findRestoredToolBlock(id: string): Element | null {
  for (const block of document.querySelectorAll('.dpp-tool-block[data-dpp-tool-key]')) {
    if (block.getAttribute('data-dpp-tool-key') === id) return block;
  }
  return null;
}

function getRestoredExecutions(record: ToolCallRestoreRecord): ToolExecutionRecord[] {
  if (record.executions?.length) {
    return record.executions.map((execution) => normalizeRestoredToolExecution(execution));
  }
  return (record.calls ?? []).map((call) => ({
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    result: summarizeRestoredToolCall(call),
  }));
}

function summarizeRestoredToolCall(call: ToolCall): ToolCardResult {
  const artifactResult = hasRestoreOmittedPayload(call.payload)
    ? null
    : createRestoredArtifactToolResult(call, currentContentLocale);
  if (artifactResult) {
    return {
      ok: artifactResult.ok,
      summary: artifactResult.summary,
      detail: artifactResult.detail,
      output: artifactResult.output,
      truncated: artifactResult.truncated,
      error: artifactResult.error,
    };
  }

  const payload = call.payload as Record<string, unknown>;
  const detail = getRestoredPayloadDetail(payload);

  switch (call.name) {
    case 'memory_save':
      return { ok: true, summary: contentT('content.toolBlock.summaries.saved'), detail };
    case 'memory_update':
      return { ok: true, summary: contentT('content.toolBlock.summaries.updated'), detail };
    case 'memory_delete':
      return { ok: true, summary: contentT('content.toolBlock.summaries.deleted'), detail };
    case 'web_search':
      return { ok: true, summary: contentT('content.toolBlock.summaries.searched'), detail: String(typeof call.payload.query === 'string' ? call.payload.query : '') };
    case 'web_fetch':
      return { ok: true, summary: contentT('content.toolBlock.summaries.fetched'), detail: String(typeof call.payload.url === 'string' ? call.payload.url : '') };
    case 'artifact_create':
    case 'artifact_bundle_create':
      return { ok: true, summary: contentT('content.toolBlock.summaries.executed'), detail };
    default:
      return { ok: true, summary: contentT('content.toolBlock.summaries.executed'), detail };
  }
}

function getRestoredPayloadDetail(payload: Record<string, unknown>): string {
  const primary = payload.filename ?? payload.name ?? payload.content ?? payload.id ?? '';
  if (typeof primary === 'string') return primary;

  const preview = getRestoreTruncatedPreview(primary);
  if (preview) return preview;

  return '';
}

function hasRestoreOmittedPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasRestoreOmittedPayload);

  const record = value as Record<string, unknown>;
  if (
    record.__dppRestoreTruncatedText === true ||
    typeof record.__dppRestoreOmittedItems === 'number' ||
    typeof record.__dppRestoreOmittedKeys === 'number' ||
    record.__dppRestoreMaxDepth === true
  ) {
    return true;
  }

  return Object.values(record).some(hasRestoreOmittedPayload);
}

function getRestoreTruncatedPreview(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const preview = (value as Record<string, unknown>).preview;
  return typeof preview === 'string' ? preview : '';
}

function getAssistantMessages(): Element[] {
  const messages = Array.from(document.querySelectorAll('.ds-message'));
  const assistantMessages = messages.filter((message) => getAssistantContentHosts(message).length > 0);
  return assistantMessages.length > 0 ? assistantMessages : messages;
}

function getAssistantResponseHost(message: Element): Element {
  const hosts = getAssistantContentHosts(message);
  if (hosts.length === 0) return message;

  // DeepSeek reuses the same content class for reasoning and final-answer blocks.
  const responseHosts = hosts.filter((host) => !looksLikeReasoningContentHost(host));
  return getLastElement(responseHosts) ?? getLastElement(hosts) ?? message;
}

function getAssistantContentHosts(message: Element): HTMLElement[] {
  return Array.from(message.querySelectorAll<HTMLElement>(ASSISTANT_RESPONSE_CONTENT_SELECTOR))
    .filter((host) => !host.parentElement?.closest(ASSISTANT_RESPONSE_CONTENT_SELECTOR));
}

function looksLikeReasoningContentHost(host: HTMLElement): boolean {
  if (hasReasoningMetadata(host)) return true;

  const firstText = getFirstMeaningfulChildText(host);
  if (looksLikeReasoningLabelText(firstText)) return true;

  return hasReasoningAncestorLabel(host);
}

function getFirstMeaningfulChildText(host: Element): string {
  for (const child of Array.from(host.childNodes)) {
    const text = normalizeText(child.textContent ?? '');
    if (text) return text.slice(0, 80);
  }

  return normalizeText(host.textContent ?? '').slice(0, 80);
}

function hasReasoningAncestorLabel(host: HTMLElement): boolean {
  const boundary = host.closest('.ds-message');
  let ancestor = host.parentElement;
  let depth = 0;
  while (ancestor && ancestor !== boundary && depth < REASONING_HOST_ANCESTOR_SCAN_DEPTH) {
    if (hasReasoningMetadata(ancestor)) return true;
    if (looksLikeReasoningLabelText(getFirstMeaningfulChildText(ancestor)) && countContentHosts(ancestor) === 1) {
      return true;
    }
    ancestor = ancestor.parentElement;
    depth += 1;
  }

  return false;
}

function hasReasoningMetadata(host: Element): boolean {
  const metadata = [
    host.className,
    host.getAttribute('aria-label') ?? '',
    host.getAttribute('data-testid') ?? '',
    host.getAttribute('data-role') ?? '',
  ].join(' ');
  return REASONING_HOST_META_RE.test(metadata);
}

function looksLikeReasoningLabelText(text: string): boolean {
  return REASONING_HOST_TEXT_RE.test(text);
}

function countContentHosts(root: Element): number {
  return root.querySelectorAll(ASSISTANT_RESPONSE_CONTENT_SELECTOR).length;
}

function getLastElement<T>(items: T[]): T | undefined {
  return items.length > 0 ? items[items.length - 1] : undefined;
}

function findRestoredToolTarget(
  record: ToolCallRestoreRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const content = normalizeText(record.content);
  const snippet = content.slice(0, 80);
  const isSameRoute = isToolRecordOnCurrentRoute(record);

  const messageIdMatched = findRestoredToolTargetByMessageId(record, messages, usedMessages);
  if (messageIdMatched) return messageIdMatched;

  if (snippet.length >= 12) {
    const matched = messages.find((message) => {
      if (usedMessages.has(message)) return false;
      return normalizeText(message.textContent ?? '').includes(snippet);
    });
    if (matched) return matched;
  }

  const indexed = findRestoredToolTargetByAssistantIndex(record, messages, usedMessages);
  if (indexed) return indexed;

  if (!isSameRoute) return null;

  if (record.source === 'storage') {
    return null;
  }

  return messages.find((message) => !usedMessages.has(message)) ?? null;
}

function findRestoredToolTargetByMessageId(
  record: ToolCallRestoreRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const messageId = getToolRecordAssistantMessageId(record);
  if (!messageId) return null;

  return messages.find((message) => {
    if (usedMessages.has(message)) return false;
    return elementHasMessageId(message, messageId);
  }) ?? null;
}

function findRestoredToolTargetByAssistantIndex(
  record: ToolCallRestoreRecord,
  messages: Element[],
  usedMessages: Set<Element>,
): Element | null {
  const assistantMessageIndex = getToolRecordAssistantMessageIndex(record);
  if (assistantMessageIndex === null) return null;

  const message = messages[assistantMessageIndex];
  if (!message || usedMessages.has(message)) return null;
  return message;
}

function getToolRecordAssistantMessageIndex(record: ToolCallRestoreRecord): number | null {
  const value = record.metadata?.assistantMessageIndex;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function elementHasMessageId(element: Element, messageId: string): boolean {
  const candidates = [
    element,
    ...Array.from(element.querySelectorAll('[data-message-id], [data-messageid], [data-id], [data-ds-message-id], [id]')),
  ];

  return candidates.some((candidate) => {
    const attributes = [
      candidate.getAttribute('data-message-id'),
      candidate.getAttribute('data-messageid'),
      candidate.getAttribute('data-id'),
      candidate.getAttribute('data-ds-message-id'),
      candidate.getAttribute('id'),
    ];
    return attributes.some((value) => value === messageId || value?.endsWith(`-${messageId}`));
  });
}

function startRenderedToolCallCleaner() {
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    if (activeStreamingToolCount > 0) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      cleanRenderedToolCalls();
    });
  };

  schedule();

  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationMayContainCleanableText)) {
      schedule();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function mutationMayContainCleanableText(mutation: MutationRecord): boolean {
  if (mutation.type === 'characterData') {
    return containsCleanableText(mutation.target.textContent);
  }

  for (const node of mutation.addedNodes) {
    if (addedNodeMayContainCleanableText(node)) {
      return true;
    }
  }

  return false;
}

function addedNodeMayContainCleanableText(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    return containsCleanableText(node.textContent);
  }

  if (!(node instanceof Element)) return false;
  if (node.closest('.dpp-tool-block, .dpp-agent-container, script, style, textarea, input, [contenteditable="true"]')) {
    return false;
  }

  if (node.matches('.ds-message') || node.querySelector('.ds-message')) {
    return true;
  }

  return containsCleanableText(node.textContent);
}

function containsToolMarker(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.includes('<') && toolMarkerRe.test(text);
}

function containsCleanableText(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text) return false;
  if (isInlineAgentContinuationRenderedText(text)) return true;
  if (containsInternalPromptMarker(text)) return true;
  if (text.includes('<task_complete>') || text.includes('</task_complete>')) return true;
  if (text.includes(LEGACY_TOOL_CALLS_OPEN_TAG) || text.includes('｜DSML｜')) return true;
  if (!text.includes('<')) return false;
  if (hasLikelyToolMarkerPrefix(text)) return true;
  if (text.length > CLEANABLE_TEXT_DEEP_SCAN_MAX_CHARS) return false;
  return containsToolMarker(text);
}

function hasLikelyToolMarkerPrefix(text: string): boolean {
  return text.includes('<memory_') ||
    text.includes('</memory_') ||
    text.includes('<web_') ||
    text.includes('</web_') ||
    text.includes('<artifact_') ||
    text.includes('</artifact_') ||
    text.includes('<skill_') ||
    text.includes('</skill_') ||
    text.includes('<mcp_') ||
    text.includes('</mcp_') ||
    text.includes('<python_') ||
    text.includes('</python_') ||
    text.includes('<shell_') ||
    text.includes('</shell_') ||
    text.includes('<task_complete>') ||
    text.includes('</task_complete>');
}

function cleanRenderedToolCalls() {
  const roots = getToolCleanupRoots();
  for (const root of roots) {
    hideInlineAgentContinuationMessages(root);
    stripToolCallTextNodes(root);
  }
}

function startInlineAgentContinuationMessageHider() {
  hideInlineAgentContinuationMessages(document);
  inlineAgentContinuationMessageObserver?.disconnect();
  inlineAgentContinuationMessageObserver = new MutationObserver((mutations) => {
    const roots = new Set<ParentNode>();
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        const parent = mutation.target.parentElement;
        if (isInlineAgentContinuationRenderedText(parent?.textContent)) {
          const root = parent?.closest('.ds-message') ?? parent;
          if (root) roots.add(root);
        }
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node instanceof Element) roots.add(node);
      }
    }

    roots.forEach(hideInlineAgentContinuationMessages);
  });
  inlineAgentContinuationMessageObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function hideInlineAgentContinuationMessages(root: ParentNode) {
  const messages = getInlineAgentContinuationMessageCandidates(root);
  for (const message of messages) {
    if (!isInlineAgentContinuationRenderedText(message.textContent)) continue;
    message.setAttribute('data-dpp-hidden-inline-agent-continuation', 'true');
    message.style.display = 'none';
  }
}

function isInlineAgentContinuationRenderedText(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text) return false;
  // isInlineAgentContinuationStructure (tags only) is a strict superset of
  // isInlineAgentContinuationPrompt (tags + keywords), so the keyword check
  // is redundant here — the placeholder covers the history-restored case and
  // the structural check covers the live-rendered case.
  return text.includes(INLINE_AGENT_CONTINUATION_PLACEHOLDER) ||
    isInlineAgentContinuationStructure(text);
}

function getInlineAgentContinuationMessageCandidates(root: ParentNode): HTMLElement[] {
  const messages: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches('.ds-message')) {
    messages.push(root);
  }
  if ('querySelectorAll' in root) {
    messages.push(...Array.from(root.querySelectorAll<HTMLElement>('.ds-message')));
  }
  return messages;
}

function getToolCleanupRoots(): Element[] {
  const roots = new Set<Element>();
  const activeMessage = toolBlockEl?.closest('.ds-message');
  if (activeMessage) roots.add(activeMessage);

  for (const block of document.querySelectorAll(`#${TOOL_BLOCK_ID}, .dpp-tool-block`)) {
    const message = block.closest('.ds-message');
    if (message) roots.add(message);
  }

  const messages = document.querySelectorAll('.ds-message');
  const minIndex = Math.max(0, messages.length - CLEANUP_MESSAGE_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= 0; i--) {
    if (i < minIndex) break;
    const message = messages[i];
    if (roots.has(message)) continue;
    if (containsCleanableText(message.textContent)) {
      roots.add(message);
    }
  }

  return Array.from(roots);
}

function stripToolCallTextNodes(root: Element) {
  if (!containsCleanableText(root.textContent)) return;

  const textNodes: Text[] = [];
  const changedParents = new Set<HTMLElement>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        // A message already flagged as an inline-agent continuation bubble is
        // owned by hideInlineAgentContinuationMessages (which hides the whole
        // .ds-message). Letting strip touch it here can leave an empty shell
        // when DeepSeek re-renders and drops the display:none, so skip it.
        parent.closest('[data-dpp-hidden-inline-agent-continuation]') ||
        // Detached artifact cards live outside .dpp-tool-block but must be
        // exempt from tool-call text stripping just like the block itself.
        parent.closest('.dpp-tool-block, .dpp-artifact-results') ||
        parent.closest('script, style, textarea, input, [contenteditable="true"]')
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  let activeTool: string | null = null;

  for (const textNode of textNodes) {
    const original = textNode.nodeValue ?? '';
    if (!activeTool && !containsCleanableText(original)) continue;
    const sanitizedOriginal = sanitizeRenderedControlText(
      original,
      { replaceTaskComplete: shouldReplaceRenderedTaskCompleteBlock(textNode) },
    );
    let cursor = 0;
    let next = '';

    while (cursor < sanitizedOriginal.length) {
      if (activeTool) {
        const closeRe = new RegExp(`<\\s*/\\s*${escapeRegExp(activeTool)}\\s*>`, 'i');
        const closeMatch = closeRe.exec(sanitizedOriginal.slice(cursor));
        if (!closeMatch) {
          cursor = sanitizedOriginal.length;
          break;
        }
        cursor += closeMatch.index + closeMatch[0].length;
        activeTool = null;
        continue;
      }

      const openMatch = toolOpenTagRe.exec(sanitizedOriginal.slice(cursor));
      if (!openMatch) {
        next += sanitizedOriginal.slice(cursor);
        break;
      }

      next += sanitizedOriginal.slice(cursor, cursor + openMatch.index);
      activeTool = openMatch[1];
      cursor += openMatch.index + openMatch[0].length;
    }

    if (next !== original) {
      textNode.nodeValue = next;
      if (textNode.parentElement) changedParents.add(textNode.parentElement);
    }
  }

  for (const parent of changedParents) {
    pruneEmptyToolContainers(parent, root);
  }
}

function sanitizeRenderedControlText(text: string, options: { replaceTaskComplete: boolean }): string {
  const sanitized = sanitizeInternalPromptText(text);
  return options.replaceTaskComplete ? replaceTaskCompleteBlocks(sanitized) : sanitized;
}

function shouldReplaceRenderedTaskCompleteBlock(textNode: Text): boolean {
  const parent = textNode.parentElement;
  if (!parent) return false;
  if (parent.closest('pre, code')) return false;

  const message = parent.closest('.ds-message');
  if (!message) return false;
  return getAssistantContentHosts(message).some((host) => host.contains(parent));
}

function pruneEmptyToolContainers(start: HTMLElement, boundary: Element) {
  let el: HTMLElement | null = start;
  while (el && el !== boundary && !el.classList.contains('ds-message')) {
    const parent: HTMLElement | null = el.parentElement;
    const hasVisibleText = (el.textContent ?? '').trim().length > 0;
    const hasProtectedChild = Boolean(
      el.querySelector('.dpp-tool-block, img, svg, canvas, video, button, input, textarea'),
    );

    if (!hasVisibleText && !hasProtectedChild) {
      el.remove();
      el = parent;
      continue;
    }

    el = parent;
  }
}

function collapseToolBlock(block: HTMLElement | null = toolBlockEl) {
  if (!block) return;
  block.removeAttribute('id');
  setTimeout(() => {
    block.setAttribute('data-collapsed', 'true');
  }, 1500);
}

function appendToolBlockToMessage(message: Element, block: HTMLElement) {
  getAssistantResponseHost(message).appendChild(block);
}

function placeToolBlock(
  block: HTMLElement,
  canPlace: () => boolean = () => true,
  onPlaced?: (message: Element) => void,
) {
  const tryPlace = () => {
    if (!canPlace()) return false;
    // Find last assistant message container
    const messages = getAssistantMessages();
    if (messages.length === 0) return false;

    const lastMsg = messages[messages.length - 1];
    appendToolBlockToMessage(lastMsg, block);
    onPlaced?.(lastMsg);
    return true;
  };

  if (!tryPlace()) {
    // DOM not ready yet — retry after a short delay
    const timer = setInterval(() => {
      if (tryPlace()) clearInterval(timer);
    }, 200);
    setTimeout(() => clearInterval(timer), 5000);
  }
}

// --- Background image feature (unchanged) ---

function getToolbarBottom(): number {
  const root = document.getElementById('root');
  if (!root) return 0;

  function walk(el: Element): number {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (
      rect.top >= -2 && rect.top <= 5 &&
      rect.height > 30 && rect.height <= 80 &&
      rect.width > 300 &&
      (style.position === 'absolute' || style.position === 'sticky' || style.position === 'fixed')
    ) {
      return rect.bottom;
    }
    for (const child of el.children) {
      const result = walk(child);
      if (result > 0) return result;
    }
    return 0;
  }

  return walk(root);
}

function hasVisibleBackground(style: CSSStyleDeclaration): boolean {
  const bg = style.backgroundColor;
  const bgImg = style.backgroundImage;
  return (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
         (bgImg !== 'none' && bgImg !== '');
}

function getPromptTextarea(): HTMLTextAreaElement | null {
  return findPromptTextarea(document);
}

function findDeepSeekInputBox(): HTMLElement | null {
  const textarea = getPromptTextarea();
  if (!textarea) return null;

  const root = document.getElementById('root');
  const textareaRect = textarea.getBoundingClientRect();
  let candidate: HTMLElement | null = null;
  let el: Element | null = textarea.parentElement;

  while (el && el !== root && el !== document.body) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (isTightPromptInputFrame(rect, textareaRect, style)) {
        return el;
      }

      if (!candidate && isPromptInputFrameCandidate(rect, textareaRect, style)) {
        candidate = el;
      }
    }
    el = el.parentElement;
  }

  return candidate ?? textarea.parentElement;
}

function isPromptInputFrameCandidate(
  rect: DOMRect,
  textareaRect: DOMRect,
  style: CSSStyleDeclaration,
): boolean {
  return rect.width >= textareaRect.width &&
    rect.height >= textareaRect.height &&
    rect.height <= Math.max(260, textareaRect.height + 180) &&
    rect.width <= Math.max(textareaRect.width + 260, textareaRect.width * 1.25) &&
    (
      hasVisibleBackground(style) ||
      Number.parseFloat(style.borderRadius) > 0 ||
      Number.parseFloat(style.borderTopWidth) > 0 ||
      Number.parseFloat(style.borderBottomWidth) > 0
    );
}

function isTightPromptInputFrame(
  rect: DOMRect,
  textareaRect: DOMRect,
  style: CSSStyleDeclaration,
): boolean {
  const borderRadius = Number.parseFloat(style.borderRadius);
  const hasBorder =
    Number.parseFloat(style.borderTopWidth) > 0 ||
    Number.parseFloat(style.borderBottomWidth) > 0;

  return isPromptInputFrameCandidate(rect, textareaRect, style) &&
    borderRadius >= 12 &&
    (hasVisibleBackground(style) || hasBorder || style.overflow === 'hidden');
}

function patchContainerBackgrounds() {
  if (!document.body.classList.contains('dpp-bg-active')) return;
  const root = document.getElementById('root');
  if (!root) return;

  const textarea = getPromptTextarea();
  if (!textarea) return;

  const inputBox = findDeepSeekInputBox();
  if (!inputBox) return;

  let el = inputBox.parentElement;
  while (el && el !== root && el !== document.body) {
    const style = getComputedStyle(el);
    if (hasVisibleBackground(style)) {
      (el as HTMLElement).setAttribute('data-dpp-transparent', '');
    }

    if (style.position === 'sticky') {
      for (const child of el.children) {
        if (child.contains(textarea)) continue;
        if (hasVisibleBackground(getComputedStyle(child))) {
          (child as HTMLElement).setAttribute('data-dpp-transparent', '');
        }
      }
    }

    el = el.parentElement;
  }
}

function removeBackground() {
  backgroundPatchObserver?.disconnect();
  backgroundPatchObserver = null;
  document.getElementById('dpp-bg')?.remove();
  document.getElementById('dpp-bg-style')?.remove();
  document.body.classList.remove('dpp-bg-active');
  document.body.style.removeProperty('--dpp-overlay-light');
  document.body.style.removeProperty('--dpp-overlay-dark');
  document.body.style.removeProperty('--dpp-blur');
}

function applyPetConfig(config: PetConfig | null) {
  const normalizedConfig = normalizePetConfig(config);
  currentPetConfig = normalizedConfig;

  if (!normalizedConfig.enabled) {
    removePet();
    return;
  }

  const host = ensurePet();
  host.style.setProperty('--dpp-pet-size', `${normalizedConfig.size}px`);
  host.style.opacity = normalizedConfig.opacity.toFixed(2);
  host.dataset.motion = String(normalizedConfig.motion);
  host.dataset.position = normalizedConfig.position;
  applyPetPosition(host, normalizedConfig);
}

function ensurePet(): HTMLElement {
  injectPetStyles();
  installPetResizeListener();

  if (petHostEl?.isConnected) return petHostEl;

  const host = document.createElement('div');
  host.id = PET_HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  host.dataset.state = 'idle';
  host.dataset.motion = 'true';
  host.innerHTML = createPetMarkup();
  host.addEventListener('pointerdown', handlePetPointerDown);
  host.addEventListener('pointermove', handlePetPointerMove);
  host.addEventListener('pointerup', handlePetPointerUp);
  host.addEventListener('pointercancel', handlePetPointerCancel);
  host.addEventListener('pointerenter', handlePetPointerEnter);
  document.body.appendChild(host);
  petHostEl = host;
  petBubbleEl = host.querySelector<HTMLElement>('.dpp-pet-bubble');
  petBubbleTextEl = host.querySelector<HTMLElement>('.dpp-pet-bubble-text');
  return host;
}

function removePet() {
  clearPetIdleTimer();
  clearPetSleepTimer();
  hidePetBubble();
  petDragState = null;
  petBubbleState = null;
  petRecentLines.length = 0;
  petHostEl?.remove();
  petHostEl = null;
  petBubbleEl = null;
  petBubbleTextEl = null;
  uninstallPetResizeListener();
}

function setPetState(state: PetState) {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected) return;
  clearPetIdleTimer();
  clearPetSleepTimer();
  applyPetState(state);
}

// Single exit for state transitions: write dataset and speak only on actual changes.
// updatePetFromTokenSpeed calls setPetState frequently during streaming, so this
// change detection prevents repeated bubble resets.
function applyPetState(state: PetState) {
  if (!petHostEl?.isConnected) return;
  const previous = petHostEl.dataset.state as PetState | undefined;
  petHostEl.dataset.state = state;
  if (state !== previous) {
    triggerPetBubble(state);
  }
}

function schedulePetIdle(delay = PET_IDLE_DELAY_MS) {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected) return;
  clearPetIdleTimer();
  clearPetSleepTimer();
  petIdleTimer = setTimeout(() => {
    if (petHostEl?.isConnected) {
      applyPetState('idle');
      schedulePetSleep();
    }
    petIdleTimer = null;
  }, delay);
}

function schedulePetSleep() {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected) return;
  clearPetSleepTimer();
  petSleepTimer = setTimeout(() => {
    if (petHostEl?.isConnected && petHostEl.dataset.state === 'idle') {
      applyPetState('sleepy');
    }
    petSleepTimer = null;
  }, PET_SLEEP_DELAY_MS);
}

function clearPetIdleTimer() {
  if (petIdleTimer) {
    clearTimeout(petIdleTimer);
    petIdleTimer = null;
  }
}

function clearPetSleepTimer() {
  if (petSleepTimer) {
    clearTimeout(petSleepTimer);
    petSleepTimer = null;
  }
}

// Speak once when entering a state; looping states schedule the next line.
function triggerPetBubble(state: PetState) {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected) return;
  if (petDragState) return; // Keep quiet while dragging.
  clearPetBubbleRepeatTimer();
  petBubbleState = state;
  showPetBubble(pickPetLine(state, petRecentLines, currentContentLocale));
  if (PET_BUBBLE_LOOPING_STATES.has(state)) {
    armPetBubbleRepeat();
  }
}

function armPetBubbleRepeat() {
  clearPetBubbleRepeatTimer();
  const span = PET_BUBBLE_REPEAT_MAX_MS - PET_BUBBLE_REPEAT_MIN_MS;
  const delay = PET_BUBBLE_REPEAT_MIN_MS + Math.floor(Math.random() * (span + 1));
  petBubbleRepeatTimer = setTimeout(() => {
    petBubbleRepeatTimer = null;
    const state = petBubbleState;
    if (!state || !petHostEl?.isConnected || petDragState) return;
    if (petHostEl.dataset.state !== state) return; // State changed; the new state owns the loop.
    showPetBubble(pickPetLine(state, petRecentLines, currentContentLocale));
    armPetBubbleRepeat();
  }, delay);
}

function showPetBubble(line: string) {
  if (!line || !petBubbleEl || !petBubbleTextEl) return;
  rememberPetLine(line);
  petBubbleTextEl.textContent = line;
  petBubbleEl.dataset.visible = 'true';
  if (petBubbleHideTimer) clearTimeout(petBubbleHideTimer);
  petBubbleHideTimer = setTimeout(() => {
    petBubbleHideTimer = null;
    if (petBubbleEl) petBubbleEl.dataset.visible = 'false';
  }, PET_BUBBLE_VISIBLE_MS);
}

// Hide the bubble immediately and stop rotation during drag, hover, or removal.
function hidePetBubble() {
  clearPetBubbleRepeatTimer();
  if (petBubbleHideTimer) {
    clearTimeout(petBubbleHideTimer);
    petBubbleHideTimer = null;
  }
  if (petBubbleEl) petBubbleEl.dataset.visible = 'false';
}

function clearPetBubbleRepeatTimer() {
  if (petBubbleRepeatTimer) {
    clearTimeout(petBubbleRepeatTimer);
    petBubbleRepeatTimer = null;
  }
}

function rememberPetLine(line: string) {
  petRecentLines.push(line);
  while (petRecentLines.length > PET_BUBBLE_RECENT_LIMIT) {
    petRecentLines.shift();
  }
}

function updatePetFromTokenSpeed(progress: ResponseTokenSpeedPayload) {
  if (!currentPetConfig?.enabled) return;
  if (!progress.active) {
    schedulePetIdle();
    return;
  }
  setPetState(progress.textLength > 0 ? 'speaking' : 'thinking');
}

function applyPetPosition(host: HTMLElement, config: PetConfig) {
  Object.assign(host.style, getPetPositionStyle(config));
}

function getPetPositionStyle(config: PetConfig): Partial<CSSStyleDeclaration> {
  if (config.position === 'custom' && config.customPosition) {
    return getPetCustomPositionStyle(config.customPosition, config.size);
  }

  const base: Partial<CSSStyleDeclaration> = {
    top: 'auto',
    bottom: `${PET_BOTTOM_OFFSET_PX}px`,
  };
  if (config.position === 'bottom-left') {
    return {
      ...base,
      left: `${PET_SIDE_OFFSET_PX}px`,
      right: 'auto',
    };
  }
  return {
    ...base,
    right: `${PET_SIDE_OFFSET_PX}px`,
    left: 'auto',
  };
}

function getPetCustomPositionStyle(position: PetCustomPosition, size: number): Partial<CSSStyleDeclaration> {
  const width = size;
  const height = size * PET_HEIGHT_RATIO;
  const left = clampPetPixelPosition(
    position.x * window.innerWidth - width / 2,
    window.innerWidth,
    width,
  );
  const top = clampPetPixelPosition(
    position.y * window.innerHeight - height / 2,
    window.innerHeight,
    height,
  );
  return {
    left: `${left}px`,
    top: `${top}px`,
    right: 'auto',
    bottom: 'auto',
  };
}

function clampPetPixelPosition(value: number, viewportSize: number, petSize: number): number {
  const max = Math.max(PET_CUSTOM_EDGE_MARGIN_PX, viewportSize - petSize - PET_CUSTOM_EDGE_MARGIN_PX);
  return Math.min(max, Math.max(PET_CUSTOM_EDGE_MARGIN_PX, value));
}

function handlePetPointerDown(event: PointerEvent) {
  if (event.button !== 0 || !currentPetConfig?.enabled || !petHostEl?.isConnected) return;

  const rect = petHostEl.getBoundingClientRect();
  petDragState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    moved: false,
  };
  petHostEl.dataset.dragging = 'true';
  hidePetBubble();
  petHostEl.setPointerCapture(event.pointerId);
  event.preventDefault();
  event.stopPropagation();
}

function handlePetPointerMove(event: PointerEvent) {
  if (!petDragState || event.pointerId !== petDragState.pointerId || !petHostEl?.isConnected) return;

  const rect = petHostEl.getBoundingClientRect();
  const deltaX = event.clientX - petDragState.startClientX;
  const deltaY = event.clientY - petDragState.startClientY;
  const left = clampPetPixelPosition(petDragState.startLeft + deltaX, window.innerWidth, rect.width);
  const top = clampPetPixelPosition(petDragState.startTop + deltaY, window.innerHeight, rect.height);

  petDragState.moved = petDragState.moved || Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3;
  petHostEl.style.left = `${left}px`;
  petHostEl.style.top = `${top}px`;
  petHostEl.style.right = 'auto';
  petHostEl.style.bottom = 'auto';
  event.preventDefault();
  event.stopPropagation();
}

function handlePetPointerUp(event: PointerEvent) {
  finishPetDrag(event);
}

function handlePetPointerCancel(event: PointerEvent) {
  finishPetDrag(event);
}

// Hide bubbles on hover to avoid blocking pet interactions.
function handlePetPointerEnter() {
  hidePetBubble();
}

function finishPetDrag(event: PointerEvent) {
  if (!petDragState || event.pointerId !== petDragState.pointerId || !petHostEl?.isConnected) return;

  const moved = petDragState.moved;
  petDragState = null;
  delete petHostEl.dataset.dragging;
  if (petHostEl.hasPointerCapture(event.pointerId)) {
    petHostEl.releasePointerCapture(event.pointerId);
  }

  if (moved && currentPetConfig) {
    const config = normalizePetConfig({
      ...currentPetConfig,
      position: 'custom',
      customPosition: getPetCustomPosition(petHostEl),
    });
    currentPetConfig = config;
    void sendRuntimeMessage({ type: 'SAVE_PET', payload: config });
  }

  // After dragging, reschedule the current looping state because hidePetBubble paused it.
  const state = petHostEl.dataset.state as PetState | undefined;
  if (state && PET_BUBBLE_LOOPING_STATES.has(state)) {
    petBubbleState = state;
    armPetBubbleRepeat();
  }

  event.preventDefault();
  event.stopPropagation();
}

function getPetCustomPosition(host: HTMLElement): PetCustomPosition {
  const rect = host.getBoundingClientRect();
  return {
    x: clampPetRatio((rect.left + rect.width / 2) / Math.max(window.innerWidth, 1)),
    y: clampPetRatio((rect.top + rect.height / 2) / Math.max(window.innerHeight, 1)),
  };
}

function clampPetRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function installPetResizeListener() {
  if (petResizeListenerInstalled) return;
  window.addEventListener('resize', handlePetViewportResize);
  petResizeListenerInstalled = true;
}

function uninstallPetResizeListener() {
  if (!petResizeListenerInstalled) return;
  window.removeEventListener('resize', handlePetViewportResize);
  petResizeListenerInstalled = false;
}

function handlePetViewportResize() {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected || petDragState) return;
  applyPetPosition(petHostEl, currentPetConfig);
}

function injectPetStyles() {
  if (document.getElementById(PET_STYLE_ID)) return;

  const style = document.createElement('style');
  const spriteUrl = escapeCssUrl(chrome.runtime.getURL(PET_SPRITE_PATH));
  style.id = PET_STYLE_ID;
  style.textContent = `
    #${PET_HOST_ID} {
      --dpp-pet-size: 132px;
      position: fixed;
      width: var(--dpp-pet-size);
      height: var(--dpp-pet-size);
      z-index: 2147483646;
      pointer-events: auto;
      cursor: grab;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      transform-origin: center bottom;
      filter: drop-shadow(0 14px 24px rgba(39, 78, 180, 0.20));
      transition: opacity 0.18s ease, transform 0.18s ease;
    }

    #${PET_HOST_ID}[data-dragging='true'] {
      cursor: grabbing;
    }

    #${PET_HOST_ID} .dpp-pet-motion,
    #${PET_HOST_ID} .dpp-pet-sprite {
      width: 100%;
      height: 100%;
    }

    #${PET_HOST_ID} .dpp-pet-motion {
      transform-origin: center bottom;
    }

    #${PET_HOST_ID} .dpp-pet-sprite {
      background-image: url("${spriteUrl}");
      background-repeat: no-repeat;
      background-size: 400% 200%;
      background-position: 0% 0%;
      transform-origin: center bottom;
      will-change: transform, background-position;
    }

    #${PET_HOST_ID}[data-state='thinking'] .dpp-pet-sprite {
      background-position: 33.333333% 0%;
    }

    #${PET_HOST_ID}[data-state='speaking'] .dpp-pet-sprite {
      background-position: 66.666667% 0%;
    }

    #${PET_HOST_ID}[data-state='working'] .dpp-pet-sprite {
      background-position: 100% 0%;
    }

    #${PET_HOST_ID}[data-state='confused'] .dpp-pet-sprite {
      background-position: 0% 100%;
    }

    #${PET_HOST_ID}[data-state='success'] .dpp-pet-sprite {
      background-position: 33.333333% 100%;
    }

    #${PET_HOST_ID}[data-state='error'] .dpp-pet-sprite {
      background-position: 66.666667% 100%;
    }

    #${PET_HOST_ID}[data-state='sleepy'] .dpp-pet-sprite {
      background-position: 100% 100%;
    }

    #${PET_HOST_ID}[data-motion='true'] .dpp-pet-motion {
      animation: dpp-pet-float 4.8s cubic-bezier(0.45, 0, 0.2, 1) infinite;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='thinking'] .dpp-pet-sprite {
      animation: dpp-pet-think 2.2s ease-in-out infinite;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='speaking'] .dpp-pet-sprite {
      animation: dpp-pet-speak 0.72s ease-in-out infinite;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='working'] .dpp-pet-sprite {
      animation: dpp-pet-work 1s ease-in-out infinite;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='confused'] .dpp-pet-sprite {
      animation: dpp-pet-confused 1.8s ease-in-out infinite;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='success'] .dpp-pet-sprite {
      animation: dpp-pet-success 1.1s ease-out 1;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='error'] .dpp-pet-sprite {
      animation: dpp-pet-error 0.42s ease-in-out 2;
    }

    #${PET_HOST_ID}[data-motion='true'][data-state='sleepy'] .dpp-pet-motion {
      animation-duration: 7s;
    }

    @keyframes dpp-pet-float {
      0%, 100% { transform: translateY(0) rotate(-1deg); }
      50% { transform: translateY(-7px) rotate(1deg); }
    }

    @keyframes dpp-pet-think {
      0%, 100% { transform: translateX(0) rotate(0deg); }
      50% { transform: translateX(-3px) rotate(-1.5deg); }
    }

    @keyframes dpp-pet-speak {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.035); }
    }

    @keyframes dpp-pet-work {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }

    @keyframes dpp-pet-confused {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      35% { transform: translateY(-4px) rotate(-3deg); }
      70% { transform: translateY(-2px) rotate(3deg); }
    }

    @keyframes dpp-pet-success {
      0% { transform: scale(0.96) translateY(2px); }
      55% { transform: scale(1.08) translateY(-6px); }
      100% { transform: scale(1) translateY(0); }
    }

    @keyframes dpp-pet-error {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }

    #${PET_HOST_ID} .dpp-pet-bubble {
      position: absolute;
      bottom: calc(100% - 24px);
      left: 50%;
      transform: translateX(-50%);
      pointer-events: none;
      z-index: 1;
      max-width: 200px;
    }

    #${PET_HOST_ID} .dpp-pet-bubble-text {
      display: inline-block;
      position: relative;
      max-width: 200px;
      box-sizing: border-box;
      padding: 5px 11px;
      border-radius: 13px;
      border: 1px solid rgba(64, 110, 240, 0.45);
      background: rgba(255, 255, 255, 0.94);
      -webkit-backdrop-filter: blur(8px);
      backdrop-filter: blur(8px);
      box-shadow: 0 8px 18px rgba(39, 78, 180, 0.18);
      color: #1d2433;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.4;
      letter-spacing: 0.2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      opacity: 0;
      transform: translateY(6px) scale(0.94);
      transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.3, 0.64, 1);
      will-change: opacity, transform;
    }

    #${PET_HOST_ID} .dpp-pet-bubble-text::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
      border-top-color: rgba(255, 255, 255, 0.94);
      filter: drop-shadow(0 2px 1px rgba(39, 78, 180, 0.12));
    }

    #${PET_HOST_ID} .dpp-pet-bubble[data-visible='true'] .dpp-pet-bubble-text {
      opacity: 1;
      transform: translateY(0) scale(1);
    }

    #${PET_HOST_ID}[data-motion='true'] .dpp-pet-bubble[data-visible='true'] .dpp-pet-bubble-text {
      animation: dpp-pet-bubble-float 3.6s ease-in-out infinite;
    }

    @keyframes dpp-pet-bubble-float {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-2.5px) scale(1); }
    }

    @media (prefers-color-scheme: dark) {
      #${PET_HOST_ID} .dpp-pet-bubble-text {
        border-color: rgba(120, 156, 255, 0.5);
        background: rgba(32, 38, 56, 0.92);
        color: #eef2ff;
        box-shadow: 0 8px 18px rgba(0, 0, 0, 0.35);
      }

      #${PET_HOST_ID} .dpp-pet-bubble-text::after {
        border-top-color: rgba(32, 38, 56, 0.92);
        filter: none;
      }
    }

    @media (max-width: 720px) {
      #${PET_HOST_ID}:not([data-position='custom']) {
        bottom: 76px !important;
        transform: scale(0.86);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #${PET_HOST_ID} *,
      #${PET_HOST_ID} .dpp-pet-motion,
      #${PET_HOST_ID} .dpp-pet-sprite {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function createPetMarkup(): string {
  return `
    <div class="dpp-pet-bubble" data-visible="false">
      <span class="dpp-pet-bubble-text"></span>
    </div>
    <div class="dpp-pet-motion">
      <div class="dpp-pet-sprite"></div>
    </div>
  `;
}

function escapeCssUrl(url: string): string {
  return url
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\)/g, '\\)')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ');
}

function applyBackground(config: BackgroundConfig | null) {
  const normalizedConfig = normalizeBackgroundConfig(config);
  if (!normalizedConfig?.enabled) {
    removeBackground();
    return;
  }

  const imageUrl = (normalizedConfig.type === 'url' ? normalizedConfig.url : normalizedConfig.imageData) || null;

  if (!imageUrl) {
    removeBackground();
    return;
  }

  const existingBg = document.getElementById('dpp-bg');
  const existingStyle = document.getElementById('dpp-bg-style');

  document.body.classList.add('dpp-bg-active');

  const overlayAlpha = (1 - normalizedConfig.opacity).toFixed(3);
  const blurPx = ((1 - normalizedConfig.opacity) * 8).toFixed(1);
  document.body.style.setProperty('--dpp-overlay-light', `rgba(255, 255, 255, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-overlay-dark', `rgba(30, 30, 30, ${overlayAlpha})`);
  document.body.style.setProperty('--dpp-blur', `blur(${blurPx}px)`);

  const topOffset = getToolbarBottom();

  const bgDiv = existingBg || document.createElement('div');
  bgDiv.id = 'dpp-bg';
  Object.assign(bgDiv.style, {
    position: 'fixed',
    top: `${topOffset}px`,
    left: '0',
    right: '0',
    bottom: '0',
    zIndex: '-1',
    backgroundImage: `url("${escapeCssUrl(imageUrl)}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    pointerEvents: 'none',
  });
  if (!existingBg) document.body.prepend(bgDiv);

  const styleEl = existingStyle || document.createElement('style');
  styleEl.id = 'dpp-bg-style';
  styleEl.textContent = `
    #dpp-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--dpp-overlay-light);
      backdrop-filter: var(--dpp-blur);
      -webkit-backdrop-filter: var(--dpp-blur);
      pointer-events: none;
    }

    body.dpp-bg-active,
    body.dpp-bg-active #root,
    body.dpp-bg-active #__next {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div,
    body.dpp-bg-active #__next > div {
      background: transparent !important;
    }

    body.dpp-bg-active #root > div > div,
    body.dpp-bg-active #__next > div > div {
      background: transparent !important;
    }

    body.dpp-bg-active [data-dpp-transparent] {
      background: transparent !important;
    }

    body.dpp-theme-dark #dpp-bg::after {
      background: var(--dpp-overlay-dark);
    }

    @media (prefers-color-scheme: dark) {
      body:not(.dpp-theme-light) #dpp-bg::after {
        background: var(--dpp-overlay-dark);
      }
    }
  `;
  if (!existingStyle) document.head.appendChild(styleEl);

  patchContainerBackgrounds();

  // Re-patch on DOM changes
  backgroundPatchObserver?.disconnect();
  backgroundPatchObserver = new MutationObserver(() => {
    if (document.body.classList.contains('dpp-bg-active')) {
      patchContainerBackgrounds();
    }
  });
  backgroundPatchObserver.observe(document.body, { childList: true, subtree: true });
}
