import type {
  BackgroundConfig,
  DeepSeekTheme,
  Memory,
  ModelType,
  PetConfig,
  PetCustomPosition,
  Skill,
  SystemPromptPreset,
  ToolCall,
  ToolCardResult,
  ToolCallRestoreRecord,
  ToolDescriptor,
  ToolExecutionRecord,
} from '../core/types';
import { normalizePetConfig } from '../core/pet/config';
import { pickPetLine, type PetState } from '../core/pet/lines';
import { DEFAULT_TOOL_DESCRIPTORS, createToolInvocationCatalog } from '../core/tool/invocation';
import { normalizeBackgroundConfig } from '../core/background/config';
import { stripToolCalls } from '../core/interceptor/tool-parser';
import { augmentRequestBody } from '../core/interceptor/request-augmentation';
import { containsInternalPromptMarker, sanitizeInternalPromptText } from '../core/prompt';
import type { ResponseCompletePayload, ResponseTokenSpeedPayload } from '../core/interceptor/fetch-hook';
import { runInlineAgentLoop } from '../core/inline-agent/loop';
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

import { createClientHeaders, rememberDeepSeekClientHeaders, saveClientHeadersToStorage } from '../core/deepseek/adapter';
import type {
  ConversationExportArtifact,
  ConversationExportProgress,
  ConversationExportResult,
} from '../core/export/types';

const TOOL_BLOCK_ID = 'dpp-tool-block';
const TOOL_BLOCK_STYLE_ID = 'dpp-tool-block-css';
const ASSISTANT_RESPONSE_CONTENT_SELECTOR = '._74c0879';
const REASONING_HOST_META_RE = /\b(?:reason|reasoning|think|thinking|thought)\b/i;
const REASONING_HOST_TEXT_RE = /^(?:已思考|思考中|正在思考|thinking|reasoning|thought)(?:[（(:：]|$)/i;
const TOKEN_SPEED_BADGE_ID = 'dpp-token-speed-badge';
const TOKEN_SPEED_STYLE_ID = 'dpp-token-speed-css';
const EXPORT_ACTION_CLASS = 'dpp-export-action';
const EXPORT_ACTION_STYLE_ID = 'dpp-export-action-css';
const EXPORT_ACTION_TOAST_CLASS = 'dpp-export-toast';
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
const TOKEN_SPEED_ROUTE_CHECK_MS = 500;
const TOOL_RESTORE_STORAGE_KEY = 'dpp_tool_execution_blocks';
const INLINE_AGENT_TRACE_STORAGE_KEY = 'dpp_inline_agent_traces';
const INLINE_AGENT_TRACE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const INLINE_AGENT_TRACE_LIMIT = 100;
const INLINE_AGENT_TRACE_WRITE_DEBOUNCE_MS = 300;
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
const MAIN_WORLD_SOURCE = 'deepseek-pp-main';
const CONTENT_SOURCE = 'deepseek-pp-content';
const BRIDGE_REQUEST_TYPE = 'DPP_BRIDGE_REQUEST';
const BRIDGE_INIT_TYPE = 'DPP_BRIDGE_INIT';
const BRIDGE_READY_TYPE = 'DPP_BRIDGE_READY';
const PET_BUBBLE_VISIBLE_MS = 6000;
const PET_BUBBLE_REPEAT_MIN_MS = 8000;
const PET_BUBBLE_REPEAT_MAX_MS = 12000;
const PET_BUBBLE_RECENT_LIMIT = 3;
type ExportResponse = ConversationExportResult | { ok: false; exportId?: string; error: string };
interface ConversationExportFormatOption {
  format: ConversationExportArtifact['format'];
  label: string;
  defaultChecked: boolean;
}

const CONVERSATION_EXPORT_FORMAT_OPTIONS: ConversationExportFormatOption[] = [
  { format: 'html', label: 'HTML', defaultChecked: true },
  { format: 'markdown', label: 'Markdown', defaultChecked: false },
  { format: 'pdf', label: 'PDF', defaultChecked: false },
];
// 这些状态会在长时间停留时周期性地轮播台词；其余状态只在进入时说一句。
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

let toolExecutions: ToolExecutionRecord[] = [];
let toolBlockEl: HTMLElement | null = null;
let responseGeneration = 0;
let tokenSpeedEl: HTMLElement | null = null;
let tokenSpeedBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
let tokenSpeedBootstrapAttempts = 0;
let tokenSpeedMountObserver: MutationObserver | null = null;
let tokenSpeedMountTimer: ReturnType<typeof setTimeout> | null = null;
let lastTokenSpeedProgress: ResponseTokenSpeedPayload = createIdleTokenSpeedProgress();
let tokenSpeedRouteKey = '';
let tokenSpeedRouteTimer: ReturnType<typeof setInterval> | null = null;
let exportActionObserver: MutationObserver | null = null;
let exportActionMountTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionRetryTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionRetryAttempts = 0;
let activeConversationExportId: string | null = null;
let exportActionToastTimer: ReturnType<typeof setTimeout> | null = null;
let exportActionMenuEl: HTMLElement | null = null;
let exportActionMenuButton: HTMLButtonElement | null = null;
let exportActionMenuSessionId: string | null = null;
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
let activeInlineAgentTrace: InlineAgentTraceRecord | null = null;
let inlineAgentTraceWriteTimer: ReturnType<typeof setTimeout> | null = null;
const restoredInlineAgentTraces = new Map<string, InlineAgentTraceRecord>();
let restoredInlineAgentRenderTimer: ReturnType<typeof setTimeout> | null = null;
let restoredInlineAgentRenderAttempts = 0;
let currentMemories: Memory[] = [];
let currentSkills: Skill[] = [];
let currentActivePreset: SystemPromptPreset | null = null;
let currentModelType: ModelType = null;
let currentToolDescriptors: ToolDescriptor[] = [...DEFAULT_TOOL_DESCRIPTORS];
let currentRequestMessageCount = 0;
let mainWorldPort: MessagePort | null = null;
let mainWorldBridgeReady = false;
let activeAgentAbort: AbortController | null = null;
let toolOpenTagRe = buildToolOpenTagRegex(currentToolDescriptors);
let toolMarkerRe = buildToolMarkerRegex(currentToolDescriptors);
let extensionContextValid = true;

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {
    installExtensionInvalidationGuards();
    installMainWorldBridge();

    const handleMainWorldMessage = async (data: any) => {
      if (data?.source !== MAIN_WORLD_SOURCE) return;
      try {
        switch (data.type) {
          case 'TOOL_CALL': {
            const call = data.data as ToolCall;
            setPetState('working');
            void runToolExecution(call);
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
            await waitForPendingToolExecutions();
            if (gen !== responseGeneration) break;
            const completedExecutions = [...toolExecutions];
            if (toolExecutions.length > 0) {
              await persistToolExecutions(toolExecutions, complete.text);
              collapseToolBlock();
              toolExecutions = [];
              toolBlockEl = null;
            }
            void startInlineAgentIfNeeded(complete, completedExecutions);
            schedulePetIdle();
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
        }
      }
    };

    setMainWorldMessageHandler(handleMainWorldMessage);

    void loadAndSyncRuntimeState().catch(() => undefined);

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    startDeepSeekThemeSync();
    startTokenSpeedIndicatorBootstrap();
    startTokenSpeedIndicatorMountObserver();
    startTokenSpeedRouteWatcher();
    startConversationExportActionInjector();

    startRenderedToolCallCleaner();
    void restorePersistedToolBlocks();
    void restorePersistedInlineAgentTraces();

    sendRuntimeMessage<BackgroundConfig | null>({ type: 'GET_BACKGROUND' }).then((cfg) => {
      applyBackground(cfg ?? null);
    });
    sendRuntimeMessage<PetConfig | null>({ type: 'GET_PET' }).then((cfg) => {
      applyPetConfig(cfg ?? null);
    });

    addRuntimeMessageListener((message, _sender, sendResponse) => {
      if (message.type === 'STATE_UPDATED') {
        syncToMainWorld(message.memories, message.skills, message.activePreset, message.modelType, currentToolDescriptors);
      } else if (message.type === 'TOOL_DESCRIPTORS_UPDATED') {
        syncToMainWorld(currentMemories, currentSkills, currentActivePreset, currentModelType, normalizeToolDescriptors(message.toolDescriptors));
      } else if (message.type === 'MCP_SERVERS_UPDATED') {
        sendRuntimeMessage<ToolDescriptor[]>({ type: 'GET_TOOL_DESCRIPTORS' })
          .then((descriptors) => syncToMainWorld(currentMemories, currentSkills, currentActivePreset, currentModelType, normalizeToolDescriptors(descriptors)))
          .catch(() => undefined);
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
      }
      return undefined;
    });
  },
});

let mainWorldMessageHandler: ((data: any) => void | Promise<void>) | null = null;
const pendingMainWorldMessages: Record<string, unknown>[] = [];

function setMainWorldMessageHandler(handler: (data: any) => void | Promise<void>): void {
  mainWorldMessageHandler = handler;
}

function installMainWorldBridge(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data?.source !== MAIN_WORLD_SOURCE || event.data.type !== BRIDGE_REQUEST_TYPE) return;
    connectMainWorldPort();
  });
}

function connectMainWorldPort(): void {
  if (mainWorldPort) return;

  const channel = new MessageChannel();
  mainWorldPort = channel.port1;
  mainWorldPort.onmessage = (event) => {
    void handleMainWorldPortMessage(event.data);
  };
  mainWorldPort.start();

  window.postMessage(
    { source: CONTENT_SOURCE, type: BRIDGE_INIT_TYPE },
    window.location.origin,
    [channel.port2],
  );
}

async function handleMainWorldPortMessage(data: any): Promise<void> {
  if (data?.source !== MAIN_WORLD_SOURCE) return;

  if (data.type === BRIDGE_READY_TYPE) {
    mainWorldBridgeReady = true;
    flushMainWorldMessages();
    return;
  }

  if (data.type === 'AUGMENT_REQUEST_BODY') {
    await handleAugmentRequestBody(data);
    return;
  }

  await mainWorldMessageHandler?.(data);
}

async function handleAugmentRequestBody(data: { id?: unknown; body?: unknown }): Promise<void> {
  const id = typeof data.id === 'string' ? data.id : '';
  if (!id) return;

  try {
    if (typeof data.body !== 'string') {
      throw new Error('Request body must be a string.');
    }

    const result = augmentRequestBody(data.body, {
      memories: currentMemories,
      skills: currentSkills,
      activePreset: currentActivePreset,
      modelType: currentModelType,
      toolDescriptors: currentToolDescriptors,
      messageCount: currentRequestMessageCount,
    });

    if (result) {
      currentRequestMessageCount = result.messageCount;
      if (result.usedMemoryIds.length > 0) {
        await sendRuntimeMessage({ type: 'TOUCH_MEMORIES', payload: { ids: result.usedMemoryIds } });
      }
    }

    postToMainWorld({
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id,
      ok: true,
      result: result
        ? { body: result.body, agentTaskPrompt: result.agentTaskPrompt }
        : null,
    });
  } catch (error) {
    postToMainWorld({
      type: 'AUGMENT_REQUEST_BODY_RESULT',
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

async function loadAndSyncRuntimeState() {
  const [memories, skills, activePreset, modelType, toolDescriptors] = await Promise.all([
    sendRuntimeMessage<Memory[]>({ type: 'GET_MEMORIES' }),
    sendRuntimeMessage<Skill[]>({ type: 'GET_SKILLS' }),
    sendRuntimeMessage<SystemPromptPreset | null>({ type: 'GET_ACTIVE_PRESET' }),
    sendRuntimeMessage<ModelType>({ type: 'GET_MODEL_TYPE' }),
    sendRuntimeMessage<ToolDescriptor[]>({ type: 'GET_TOOL_DESCRIPTORS' }),
  ]);

  syncToMainWorld(memories ?? [], skills ?? [], activePreset ?? null, modelType ?? null, normalizeToolDescriptors(toolDescriptors));
}

function hasLiveExtensionContext(): boolean {
  if (!extensionContextValid) return false;

  try {
    if (typeof chrome === 'undefined') return false;
    const runtime = chrome.runtime;
    return Boolean(runtime?.id) && typeof runtime.sendMessage === 'function';
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
    message.includes('context invalidated');
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
  stopTokenSpeedIndicatorBootstrap();
  stopTokenSpeedIndicatorMountObserver();
  stopTokenSpeedRouteWatcher();
  removeTokenSpeedIndicator();
  stopConversationExportActionInjector();
}

/** 主世界捕获到 DeepSeek 请求头后，隔离世界负责写入 chrome.storage */
async function persistDeepSeekClientHeaders(capturedHeaders?: Record<string, string> | null): Promise<boolean> {
  try {
    const headers = capturedHeaders ?? createClientHeaders();
    if (headers) {
      rememberDeepSeekClientHeaders(headers);
      const saved = await saveClientHeadersToStorage();
      if (!saved) return false;
      // 通知侧边栏重新检查登录状态
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

  return mountedCount;
}

function removeConversationExportActions() {
  document.querySelectorAll(`.${EXPORT_ACTION_CLASS}`)
    .forEach((el) => el.remove());
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
  button.title = running ? '正在导出当前对话' : '导出当前对话';
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
    showConversationExportToast('当前页面还没有可导出的对话。', 'error');
    return;
  }

  const menu = document.createElement('div');
  menu.className = EXPORT_ACTION_MENU_CLASS;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '选择导出格式');
  menu.addEventListener('click', (event) => event.stopPropagation());

  const form = document.createElement('form');
  const title = document.createElement('div');
  title.className = 'dpp-export-menu-title';
  title.textContent = '导出格式';
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
    text.textContent = option.label;
    label.append(input, text);
    form.appendChild(label);
  }

  const actions = document.createElement('div');
  actions.className = 'dpp-export-menu-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => closeConversationExportMenu());
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = '导出';
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
    showConversationExportToast('当前页面还没有可导出的对话。', 'error');
    return;
  }

  const formats = dedupeConversationExportUiFormats(selectedFormats);
  const exportId = crypto.randomUUID();
  activeConversationExportId = exportId;
  setConversationExportButtonsStatus('running');
  showConversationExportToast('正在导出当前对话...', 'info');

  try {
    const response = await sendConversationExportRequest(exportId, sessionId, formats);
    if (!response?.ok) {
      throw new Error(response?.error ?? '导出失败');
    }

    for (const artifact of response.artifacts) {
      if (formats.includes(artifact.format)) {
        downloadConversationExportArtifact(artifact);
      }
    }

    const warning = response.summary.failedSessionCount > 0;
    showConversationExportToast(
      warning
        ? '导出完成，但部分会话读取失败，请检查导出文件中的 Export Warnings。'
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
    return '当前对话已导出。';
  }
  return '当前对话已导出。';
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
  // Collect executions that should trigger a continuation:
  // MCP tools + local web search tools (web_search, web_fetch)
  const continuableExecutions = executions.filter(
    (e) =>
      e.provider?.kind === 'mcp' ||
      e.provider?.id === 'web' ||
      e.name === 'web_search' ||
      e.name === 'web_fetch',
  );
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
        d.name === 'web_search' ||
        d.name === 'web_fetch',
    ),
    powWasmUrl: chrome.runtime.getURL(DEEPSEEK_POW_WASM_PATH),
  };

  injectInlineAgentStyles();
  const container = createAgentContainer();
  container.setAttribute('data-dpp-agent-loop-id', loopId);

  const messages = getAssistantMessages();
  const target = messages[messages.length - 1];
  if (!target) return;

  inlineAgentLoopId = loopId;
  activeInlineAgentTrace = createInlineAgentTrace(complete, loopId, continuableExecutions.length);
  void writeInlineAgentTrace(activeInlineAgentTrace);

  inlineAgentContainer = container;
  const responseHost = getAssistantResponseHost(target);
  responseHost.appendChild(container);

  // Keep agent container at the bottom when DeepSeek's UI appends new content
  inlineAgentContainerObserver?.disconnect();
  inlineAgentContainerObserver = new MutationObserver(() => {
    if (container.parentNode && container.nextSibling) {
      container.parentNode.appendChild(container);
    }
  });
  inlineAgentContainerObserver.observe(responseHost, { childList: true });

  void startInlineAgentLoop(payload);
}

function stopInlineAgent(): void {
  const container = inlineAgentContainer;
  updateActiveInlineAgentTrace((trace) => ({
    ...trace,
    status: 'stopping',
    error: '已停止',
  }), { immediate: true });
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
  activeInlineAgentTrace = null;
  inlineAgentContainerObserver?.disconnect();
  inlineAgentContainerObserver = null;
  activeAgentAbort?.abort();
  activeAgentAbort = null;
  if (container) {
    const footer = createAgentFooter(0, 0, false, '已停止');
    container.appendChild(footer);
  }
}

async function startInlineAgentLoop(payload: InlineAgentStartPayload): Promise<void> {
  activeAgentAbort?.abort();
  const abort = new AbortController();
  activeAgentAbort = abort;

  const post = (type: string, data: unknown) => {
    handleInlineAgentLoopEvent(type, data);
  };

  const executeTool = async (call: ToolCall): Promise<ToolExecutionRecord> => {
    const enrichedCall: ToolCall = {
      ...call,
      source: {
        trigger: 'agent_run',
        chatSessionId: payload.chatSessionId,
        runId: payload.loopId,
      },
    };
    const result = await executeToolCall(enrichedCall);
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

  await runInlineAgentLoop(payload, { post, executeTool, signal: abort.signal });
  if (activeAgentAbort === abort) activeAgentAbort = null;
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

  const stepEl = createAgentStepElement(data.stepIndex, stopInlineAgent);
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
  const previousText = getInlineAgentStepText(inlineAgentCurrentStep);
  const nextText = msg.fullText.trim() || previousText;
  updateStepStreamText(inlineAgentCurrentStep, nextText);
  updateActiveInlineAgentTrace((trace) => updateInlineAgentTraceStep(trace, msg.stepIndex, {
    text: nextText,
    status: 'streaming',
    collapsed: false,
  }));
}

function handleAgentStepComplete(msg: InlineAgentStepCompleteMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentCurrentStep) return;

  for (const exec of msg.toolExecutions) {
    addToolResultToStep(inlineAgentCurrentStep, exec.name, exec.result.ok, exec.result.summary);
  }

  const label = msg.toolExecutions.length > 0
    ? `完成（${msg.toolExecutions.length} 个工具）`
    : '完成';
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

  try {
    inlineAgentContainerObserver?.disconnect();
    inlineAgentContainerObserver = null;

    const finalText = getInlineAgentDisplayFinalText(msg.finalText);
    appendInlineAgentFinalAnswer(inlineAgentContainer, finalText, msg.loopId);

    const footer = createAgentFooter(msg.totalSteps, msg.totalTools, false);
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
  return replaceTaskCompleteBlocks(withoutToolCalls).trim();
}

function replaceTaskCompleteBlocks(text: string): string {
  return text.replace(/<task_complete>\s*({[\s\S]*?})\s*<\/task_complete>/g, (_m, json) => {
    try {
      const parsed = JSON.parse(json) as { summary?: unknown };
      return typeof parsed.summary === 'string' ? parsed.summary : '';
    } catch {
      return '';
    }
  });
}

function appendInlineAgentFinalAnswer(container: HTMLElement, text: string, loopId: string): void {
  if (!text) return;
  const parent = container.parentNode;
  if (!parent) return;

  const textDiv = document.createElement('div');
  textDiv.innerHTML = renderInlineMarkdown(text);
  textDiv.setAttribute('data-dpp-body-text', 'true');
  textDiv.setAttribute('data-dpp-agent-loop-id', loopId);
  parent.appendChild(textDiv);
}

function handleAgentLoopError(msg: InlineAgentLoopErrorMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;

  try {
    if (inlineAgentCurrentStep) {
      updateStepStatus(inlineAgentCurrentStep, 'error', msg.error);
    }

    const footer = createAgentFooter(msg.stepIndex, msg.totalTools, true, msg.error);
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
  const task = executeToolCall(call)
    .catch((err): ToolCardResult => ({
      ok: false,
      summary: '执行失败',
      detail: err instanceof Error ? err.message : String(err),
    }))
    .then((result) => {
      toolExecutions.push({ name: call.name, result, provider: call.provider, descriptorId: call.descriptorId });
      renderToolBlock();
      showPetResult(result);
      return result;
    });

  pendingToolExecutionTasks.add(task);
  void task.finally(() => {
    pendingToolExecutionTasks.delete(task);
  });
  return task;
}

function showPetResult(result: ToolCardResult): void {
  setPetState(result.ok ? 'success' : 'error');
  schedulePetIdle(PET_FEEDBACK_DELAY_MS);
}

async function waitForPendingToolExecutions() {
  while (pendingToolExecutionTasks.size > 0) {
    await Promise.allSettled(Array.from(pendingToolExecutionTasks));
  }
}

function normalizeResponseCompletePayload(payload: unknown, fallbackText: unknown): ResponseCompletePayload {
  const value = payload && typeof payload === 'object' ? payload as Partial<ResponseCompletePayload> : {};
  return {
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
    active: value.active === true,
    estimatedTokens,
    tokensPerSecond,
    elapsedMs,
    textLength,
  };
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function updateTokenSpeedIndicator(progress: ResponseTokenSpeedPayload) {
  tokenSpeedRouteKey = getTokenSpeedRouteKey();
  lastTokenSpeedProgress = progress;
  renderTokenSpeedIndicator(progress);
}

function createIdleTokenSpeedProgress(): ResponseTokenSpeedPayload {
  return {
    active: false,
    estimatedTokens: 0,
    tokensPerSecond: 0,
    elapsedMs: 0,
    textLength: 0,
  };
}

function renderTokenSpeedIndicator(progress: ResponseTokenSpeedPayload): boolean {
  const badge = ensureTokenSpeedIndicator();
  if (!badge) return false;

  const speed = formatTokenSpeed(progress.tokensPerSecond);
  badge.textContent = speed;
  badge.dataset.active = progress.active ? 'true' : 'false';
  badge.setAttribute('aria-label', `Token output speed ${speed}`);
  badge.setAttribute('title', `Token 输出速度：${speed}${progress.active ? '' : '（空闲）'}`);
  return true;
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
    resetTokenSpeedOnRouteChange();
    if (isTokenSpeedIndicatorMountedOnCurrentInput()) return;
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
  if (resetTokenSpeedOnRouteChange()) {
    renderTokenSpeedIndicator(lastTokenSpeedProgress);
  }
}

function resetTokenSpeedOnRouteChange(): boolean {
  const nextRouteKey = getTokenSpeedRouteKey();
  if (nextRouteKey === tokenSpeedRouteKey) return false;
  tokenSpeedRouteKey = nextRouteKey;
  lastTokenSpeedProgress = createIdleTokenSpeedProgress();
  return true;
}

function getTokenSpeedRouteKey(): string {
  if (typeof location === 'undefined') return '';
  return `${location.pathname}${location.search}`;
}

function isTokenSpeedIndicatorMountedOnCurrentInput(): boolean {
  const inputBox = findDeepSeekInputBox();
  return Boolean(inputBox && tokenSpeedEl?.isConnected && tokenSpeedEl.parentElement === inputBox);
}

function removeTokenSpeedIndicator() {
  const parent = tokenSpeedEl?.parentElement;
  tokenSpeedEl?.remove();
  parent?.removeAttribute('data-dpp-token-speed-anchor');
  tokenSpeedEl = null;
}

function ensureTokenSpeedIndicator(): HTMLElement | null {
  injectTokenSpeedStyles();

  const inputBox = findDeepSeekInputBox();
  if (!inputBox) return null;

  if (tokenSpeedEl && tokenSpeedEl.isConnected && tokenSpeedEl.parentElement === inputBox) {
    return tokenSpeedEl;
  }

  const previousParent = tokenSpeedEl?.parentElement;
  tokenSpeedEl?.remove();
  previousParent?.removeAttribute('data-dpp-token-speed-anchor');
  inputBox.setAttribute('data-dpp-token-speed-anchor', '');

  const badge = document.createElement('div');
  badge.id = TOKEN_SPEED_BADGE_ID;
  badge.className = 'dpp-token-speed-badge';
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-live', 'polite');
  inputBox.appendChild(badge);
  tokenSpeedEl = badge;
  return badge;
}

function injectTokenSpeedStyles() {
  if (document.getElementById(TOKEN_SPEED_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = TOKEN_SPEED_STYLE_ID;
  style.textContent = `
    [data-dpp-token-speed-anchor] {
      position: relative !important;
    }

    .dpp-token-speed-badge {
      position: absolute;
      top: 8px;
      right: 12px;
      z-index: 30;
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      max-width: 96px;
      padding: 2px 7px;
      border: 1px solid rgba(77, 107, 254, 0.18);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.88);
      color: #4b5563;
      font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif;
      white-space: nowrap;
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
) {
  currentMemories = memories;
  currentSkills = skills;
  currentActivePreset = activePreset;
  currentModelType = modelType;
  currentToolDescriptors = toolDescriptors;
  toolOpenTagRe = buildToolOpenTagRegex(toolDescriptors);
  toolMarkerRe = buildToolMarkerRegex(toolDescriptors);

  postToMainWorld({
    type: 'SYNC_HOOK_STATE',
    toolDescriptors,
    skillSummaries: skills
      .filter((skill) => skill.enabled !== false)
      .map((skill) => ({ name: skill.name, description: skill.description })),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeToolDescriptors(value: unknown): ToolDescriptor[] {
  if (!Array.isArray(value)) return [...DEFAULT_TOOL_DESCRIPTORS];
  const descriptors = value.filter((item): item is ToolDescriptor => Boolean(item && typeof item === 'object'));
  return descriptors.length > 0 ? descriptors : [...DEFAULT_TOOL_DESCRIPTORS];
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
  return escaped.length > 0 ? escaped.join('|') : 'memory_save|memory_update|memory_delete';
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

function normalizeText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

function createInlineAgentTrace(
  complete: ResponseCompletePayload,
  loopId: string,
  seedToolCount: number,
): InlineAgentTraceRecord {
  const now = Date.now();
  return {
    id: hashString(`${complete.chatSessionId}\n${complete.assistantMessageId}\n${complete.agentTaskPrompt || complete.originalPrompt}`),
    loopId,
    chatSessionId: complete.chatSessionId!,
    anchorMessageId: complete.assistantMessageId!,
    url: getToolBlockUrl(),
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
  return (step.querySelector('.dpp-agent-step-body')?.textContent ?? '').trim();
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
    originalPrompt: clampText(trace.originalPrompt, 8000) ?? '',
    agentTaskPrompt: clampText(trace.agentTaskPrompt, 8000) ?? '',
    finalText: clampText(trace.finalText, 8000) ?? '',
    error: clampText(trace.error, 2000),
    steps: trace.steps.map(sanitizeInlineAgentTraceStep),
  };
}

function sanitizeInlineAgentTraceStep(step: InlineAgentTraceStepRecord): InlineAgentTraceStepRecord {
  return {
    ...step,
    text: clampText(step.text, 8000) ?? '',
    toolExecutions: step.toolExecutions.map(sanitizeInlineAgentTraceExecution),
  };
}

function sanitizeInlineAgentTraceExecution(execution: ToolExecutionRecord): ToolExecutionRecord {
  const output = execution.result.output === undefined
    ? undefined
    : clampText(
      typeof execution.result.output === 'string'
        ? execution.result.output
        : JSON.stringify(execution.result.output),
      8000,
    );

  return {
    name: execution.name,
    provider: execution.provider,
    descriptorId: execution.descriptorId,
    result: {
      ...execution.result,
      detail: clampText(execution.result.detail, 4000),
      output,
    },
  };
}

async function restorePersistedInlineAgentTraces(): Promise<void> {
  const url = getToolBlockUrl();
  const traces = await getPersistedInlineAgentTraces();
  let changed = false;

  for (const trace of traces) {
    if (!shouldTryRestoreInlineAgentTrace(trace, url) || restoredInlineAgentTraces.has(trace.id)) continue;
    restoredInlineAgentTraces.set(trace.id, trace);
    changed = true;
  }

  if (changed) scheduleRenderRestoredInlineAgentTraces();
}

function shouldTryRestoreInlineAgentTrace(trace: InlineAgentTraceRecord, currentUrl: string): boolean {
  if (trace.url === currentUrl) return true;

  try {
    return new URL(trace.url).origin === location.origin;
  } catch {
    return false;
  }
}

async function getPersistedToolBlocks(): Promise<PersistedToolBlock[]> {
  const blocks = await getLocalStorageValue<unknown>(TOOL_RESTORE_STORAGE_KEY);
  return Array.isArray(blocks) ? blocks : [];
}

async function persistToolExecutions(executions: ToolExecutionRecord[], fullText?: string) {
  if (executions.length === 0) return;

  const content = fullText ? stripToolCalls(fullText, { descriptors: currentToolDescriptors }) : '';
  const url = getToolBlockUrl();
  const id = hashString(`${url}\n${content}\n${JSON.stringify(executions)}`);
  const block: PersistedToolBlock = {
    id,
    source: 'storage',
    url,
    createdAt: Date.now(),
    content,
    executions: executions.map((execution) => ({
      name: execution.name,
      provider: execution.provider,
      descriptorId: execution.descriptorId,
      result: {
        ...execution.result,
        detail: clampText(execution.result.detail, 4000),
        output: execution.result.output === undefined ? undefined : clampText(JSON.stringify(execution.result.output), 8000),
      },
    })),
    metadata: {
      toolCount: executions.length,
      mcpToolCount: executions.filter((execution) => execution.provider?.kind === 'mcp').length,
    },
  };

  const existing = await getPersistedToolBlocks();
  const next = [
    ...existing.filter((item) => item.id !== id),
    block,
  ]
    .filter((item) => Date.now() - item.createdAt < 1000 * 60 * 60 * 24 * 30)
    .slice(-100);

  await setLocalStorageValue(TOOL_RESTORE_STORAGE_KEY, next);
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
  if (block.url === currentUrl) return true;

  try {
    return new URL(block.url).origin === location.origin;
  } catch {
    return false;
  }
}

function rememberRestoredToolRecords(records: ToolCallRestoreRecord[] | undefined) {
  if (!records || records.length === 0) return;

  let changed = false;
  for (const record of records) {
    if (!record.id || restoredToolRecords.has(record.id)) continue;
    restoredToolRecords.set(record.id, record);
    changed = true;
  }

  if (changed) {
    scheduleRenderRestoredToolBlocks();
  }
}

async function executeToolCall(call: ToolCall): Promise<ToolCardResult> {
  if (call.parseError) {
    return {
      ok: false,
      summary: '工具格式错误',
      detail: call.parseError.message,
      error: call.parseError,
    };
  }

  const result = await sendRuntimeToolCallMessage(call);
  const normalized = normalizeRuntimeToolCallResult(result);

  if (normalized) {
    if (shouldAutoRequestPermission(call, normalized)) {
      const url = call.payload?.url;
      const granted = typeof url === 'string' ? await requestWebFetchPermission(url) : false;
      if (granted) {
        const retryResult = await sendRuntimeToolCallMessage(call);
        const retryNormalized = normalizeRuntimeToolCallResult(retryResult);
        if (retryNormalized) return retryNormalized;
      }
    }
    return normalized;
  }

  if (!extensionContextValid) {
    return { ok: false, summary: '执行失败', detail: '扩展已重新加载，请刷新当前 DeepSeek 页面后重试。' };
  }
  return createInvalidRuntimeToolResult(result);
}

function shouldAutoRequestPermission(call: ToolCall, result: ToolCardResult): boolean {
  return (
    call.name === 'web_fetch' &&
    !result.ok &&
    result.error?.code === 'fetch_permission_denied'
  );
}

async function sendRuntimeToolCallMessage(call: ToolCall): Promise<unknown> {
  if (!hasLiveExtensionContext()) return undefined;

  try {
    return await chrome.runtime.sendMessage({ type: 'EXECUTE_TOOL_CALL', payload: call });
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      invalidateExtensionContext();
      return undefined;
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      summary: '工具消息发送失败',
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

function createInvalidRuntimeToolResult(value: unknown): ToolCardResult {
  const missing = value === undefined || value === null;
  const message = missing
    ? 'Background did not return a tool result.'
    : `Background returned an invalid tool result: ${previewUnknown(value)}`;
  return {
    ok: false,
    summary: '后台工具执行失败',
    detail: missing
      ? '后台没有返回工具执行结果。请刷新当前 DeepSeek 页面后重试；如果仍失败，在 MCP 页重新测试 Shell Local。'
      : `后台返回的工具结果结构无效：${previewUnknown(value)}`,
    error: {
      code: missing ? 'runtime_tool_result_missing' : 'runtime_tool_result_invalid',
      message,
      retryable: true,
    },
  };
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
        grantBtn.textContent = '请求中...';
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
    <span class="dpp-permission-text">DeepSeek++ 需要访问 <strong>${escapeHtml(origin)}</strong> 的权限以获取该页面内容</span>
    <div class="dpp-permission-actions">
      <button type="button" class="dpp-permission-deny">拒绝</button>
      <button type="button" class="dpp-permission-grant">授权</button>
    </div>
  `;

  const inputArea = findDeepSeekInputBox();
  const target = inputArea?.parentElement ?? document.body;
  target.appendChild(banner);
  return banner;
}

function injectPermissionBannerStyles() {
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
      background: var(--ds-card, #fff);
      border: 1px solid var(--ds-blue, #4D6BFE);
      box-shadow: 0 2px 12px rgba(77, 107, 254, 0.15);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
      color: var(--ds-text, #1D1D1F);
      animation: dppPermFadeIn 0.2s ease-out;
      z-index: 100;
    }

    .dpp-permission-text {
      flex: 1;
      min-width: 0;
    }

    .dpp-permission-text strong {
      color: var(--ds-blue, #4D6BFE);
    }

    .dpp-permission-actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .dpp-permission-actions button {
      padding: 5px 14px;
      border-radius: 8px;
      border: 1px solid var(--ds-border, #E5E7EB);
      font: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .dpp-permission-deny {
      background: var(--ds-surface, #F7F8FA);
      color: var(--ds-text-secondary, #6B7280);
    }

    .dpp-permission-deny:hover {
      background: var(--ds-danger-bg, #FEF2F2);
      color: var(--ds-danger, #EF4444);
      border-color: var(--ds-danger-border, #FECACA);
    }

    .dpp-permission-grant {
      background: var(--ds-blue, #4D6BFE);
      color: #fff;
      border-color: var(--ds-blue, #4D6BFE);
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

    body.dpp-theme-dark .dpp-permission-banner {
      background: var(--ds-card, #151922);
      border-color: var(--ds-blue, #7D91FF);
      box-shadow: 0 2px 12px rgba(125, 145, 255, 0.2);
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// --- Tool execution collapsible block (matches official "已思考" style) ---

function injectToolBlockStyles() {
  if (document.getElementById(TOOL_BLOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = TOOL_BLOCK_STYLE_ID;
  style.textContent = `
    .dpp-tool-block {
      margin-top: 8px;
    }
    .dpp-tool-block-header {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      user-select: none;
      color: rgb(97, 102, 107);
      font-size: 14px;
      line-height: 20px;
    }
    .dpp-tool-block-header:hover {
      color: rgb(60, 65, 70);
    }
    .dpp-tool-block-icon {
      width: 16px;
      height: 16px;
      color: #4d6bfe;
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
      color: rgb(64, 65, 79);
      line-height: 1.5;
    }
    .dpp-tool-block-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4d6bfe;
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
      color: #4d6bfe;
    }
    .dpp-tool-block-item-status {
      color: #10b981;
      margin-left: 6px;
    }
    .dpp-tool-block-item-status.error {
      color: #ef4444;
    }
    .dpp-tool-block-item-detail {
      margin-top: 4px;
      padding: 6px 8px;
      border-radius: 6px;
      background: rgba(77, 107, 254, 0.06);
      color: rgb(79, 84, 91);
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .dpp-manual-continuation {
      margin: 10px 0 0 20px;
      padding: 10px 12px;
      border-left: 2px solid #4d6bfe;
      border-radius: 6px;
      background: rgba(77, 107, 254, 0.05);
      color: rgb(64, 65, 79);
      font-size: 14px;
      line-height: 1.65;
    }
    .dpp-manual-continuation.error {
      border-left-color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
    }
    .dpp-manual-continuation-title {
      margin-bottom: 6px;
      color: #4d6bfe;
      font-size: 12px;
      font-weight: 600;
    }
    .dpp-manual-continuation.error .dpp-manual-continuation-title {
      color: #ef4444;
    }
    .dpp-manual-continuation-content {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    body.dpp-theme-dark .dpp-tool-block-header { color: rgb(155, 160, 165); }
    body.dpp-theme-dark .dpp-tool-block-header:hover { color: rgb(200, 205, 210); }
    body.dpp-theme-dark .dpp-tool-block-item { color: rgb(200, 200, 200); }
    body.dpp-theme-dark .dpp-tool-block-item-detail {
      background: rgba(125, 150, 255, 0.12);
      color: rgb(210, 213, 218);
    }
    body.dpp-theme-dark .dpp-manual-continuation {
      background: rgba(125, 150, 255, 0.10);
      color: rgb(210, 213, 218);
    }
    @media (prefers-color-scheme: dark) {
      body:not(.dpp-theme-light) .dpp-tool-block-header { color: rgb(155, 160, 165); }
      body:not(.dpp-theme-light) .dpp-tool-block-header:hover { color: rgb(200, 205, 210); }
      body:not(.dpp-theme-light) .dpp-tool-block-item { color: rgb(200, 200, 200); }
      body:not(.dpp-theme-light) .dpp-tool-block-item-detail {
        background: rgba(125, 150, 255, 0.12);
        color: rgb(210, 213, 218);
      }
      body:not(.dpp-theme-light) .dpp-manual-continuation {
        background: rgba(125, 150, 255, 0.10);
        color: rgb(210, 213, 218);
      }
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
  title.textContent = `已执行工具（${count}次）`;

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
      detailEl.textContent = detail;
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
  if (exec.name === 'python_exec') return 'Python 解释器';
  return exec.provider?.displayName
    ? `${exec.provider.displayName} / ${exec.name}`
    : exec.name;
}

function renderToolBlock() {
  injectToolBlockStyles();

  if (!toolBlockEl) {
    toolBlockEl = createToolBlockShell({ id: TOOL_BLOCK_ID });
    placeToolBlock(toolBlockEl);
  }

  cleanRenderedToolCalls();
  updateToolBlockContent(toolBlockEl, toolExecutions);
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
    mountRestoredInlineAgentContainer(target.message, container, target.hideHostContent);
    usedMessages.add(target.message);
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
): { message: Element; hideHostContent: boolean } | null {
  const snippet = getInlineAgentTraceMatchSnippet(trace);
  if (snippet.length >= 12) {
    const matched = messages.find((message) => {
      if (usedMessages.has(message)) return false;
      return normalizeText(message.textContent ?? '').includes(snippet);
    });
    if (matched) return { message: matched, hideHostContent: true };
  }

  if (trace.url === getToolBlockUrl()) {
    const fallback = [...messages].reverse().find((message) => !usedMessages.has(message));
    if (fallback) return { message: fallback, hideHostContent: false };
  }

  return null;
}

function getInlineAgentTraceMatchSnippet(trace: InlineAgentTraceRecord): string {
  const finalText = normalizeText(trace.finalText);
  if (finalText) return finalText.slice(0, 100);

  const lastText = [...trace.steps]
    .reverse()
    .map((step) => normalizeText(step.text))
    .find((text) => text.length > 0);
  return (lastText ?? '').slice(0, 100);
}

function createRestoredInlineAgentContainer(trace: InlineAgentTraceRecord): HTMLElement {
  const container = createAgentContainer();
  container.setAttribute('data-restored', 'true');
  container.setAttribute('data-dpp-agent-trace-key', trace.id);
  container.setAttribute('data-dpp-agent-loop-id', trace.loopId);

  for (const step of [...trace.steps].sort((a, b) => a.index - b.index)) {
    const stepEl = createAgentStepElement(step.index);
    updateStepStreamText(stepEl, step.text);
    for (const exec of step.toolExecutions) {
      addToolResultToStep(stepEl, exec.name, exec.result.ok, exec.result.summary);
    }
    updateStepStatus(stepEl, step.status, getInlineAgentStepStatusLabel(step));
    stepEl.setAttribute('data-collapsed', step.collapsed ? 'true' : 'false');
    container.appendChild(stepEl);
  }

  if (trace.status === 'complete') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, false));
  } else if (trace.status === 'error') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, true, trace.error));
  } else if (trace.status === 'stopping') {
    container.appendChild(createAgentFooter(trace.totalSteps, trace.totalTools, false, trace.error ?? '已停止'));
  }

  return container;
}

function getInlineAgentStepStatusLabel(step: InlineAgentTraceStepRecord): string {
  if (step.status === 'complete') {
    return step.toolExecutions.length > 0
      ? `完成（${step.toolExecutions.length} 个工具）`
      : '完成';
  }
  if (step.status === 'executing_tools') return '执行工具中';
  if (step.status === 'error') return '执行出错';
  return 'streaming...';
}

function mountRestoredInlineAgentContainer(
  message: Element,
  container: HTMLElement,
  hideHostContent: boolean,
): void {
  const host = getAssistantResponseHost(message);

  if (hideHostContent) {
    host.setAttribute('data-dpp-agent-host-hidden', 'true');
    host.prepend(container);
    return;
  }

  host.appendChild(container);
}

function findRestoredToolBlock(id: string): Element | null {
  for (const block of document.querySelectorAll('.dpp-tool-block[data-dpp-tool-key]')) {
    if (block.getAttribute('data-dpp-tool-key') === id) return block;
  }
  return null;
}

function getRestoredExecutions(record: ToolCallRestoreRecord): ToolExecutionRecord[] {
  if (record.executions?.length) return record.executions;
  return (record.calls ?? []).map((call) => ({
    name: call.name,
    provider: call.provider,
    descriptorId: call.descriptorId,
    result: summarizeRestoredToolCall(call),
  }));
}

function summarizeRestoredToolCall(call: ToolCall): ToolCardResult {
  const payload = call.payload as Record<string, unknown>;
  const detail = String(payload.name ?? payload.content ?? payload.id ?? '');

  switch (call.name) {
    case 'memory_save':
      return { ok: true, summary: '已保存', detail };
    case 'memory_update':
      return { ok: true, summary: '已更新', detail };
    case 'memory_delete':
      return { ok: true, summary: '已删除', detail };
    case 'web_search':
      return { ok: true, summary: '已搜索', detail: String(typeof call.payload.query === 'string' ? call.payload.query : '') };
    case 'web_fetch':
      return { ok: true, summary: '已获取', detail: String(typeof call.payload.url === 'string' ? call.payload.url : '') };
    default:
      return { ok: true, summary: '已执行', detail };
  }
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
  const metadata = [
    host.className,
    host.parentElement?.className ?? '',
    host.getAttribute('aria-label') ?? '',
    host.getAttribute('data-testid') ?? '',
    host.getAttribute('data-role') ?? '',
  ].join(' ');
  if (REASONING_HOST_META_RE.test(metadata)) return true;

  const firstText = getFirstMeaningfulChildText(host);
  return REASONING_HOST_TEXT_RE.test(firstText);
}

function getFirstMeaningfulChildText(host: Element): string {
  for (const child of Array.from(host.childNodes)) {
    const text = normalizeText(child.textContent ?? '');
    if (text) return text.slice(0, 80);
  }

  return normalizeText(host.textContent ?? '').slice(0, 80);
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
  const isSameUrl = record.url === getToolBlockUrl();

  if (snippet.length >= 12) {
    const matched = messages.find((message) => {
      if (usedMessages.has(message)) return false;
      return normalizeText(message.textContent ?? '').includes(snippet);
    });
    if (matched) return matched;
  }

  if (record.source === 'storage') {
    if (!isSameUrl) return null;
    return [...messages].reverse().find((message) => !usedMessages.has(message)) ?? null;
  }

  return messages.find((message) => !usedMessages.has(message)) ?? null;
}

function startRenderedToolCallCleaner() {
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
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
    if (containsCleanableText(node.textContent)) {
      return true;
    }
  }

  return false;
}

function containsToolMarker(text: string | null | undefined): boolean {
  return typeof text === 'string' && toolMarkerRe.test(text);
}

function containsCleanableText(text: string | null | undefined): boolean {
  return typeof text === 'string' && (containsToolMarker(text) || containsInternalPromptMarker(text));
}

function cleanRenderedToolCalls() {
  const roots = getToolCleanupRoots();
  for (const root of roots) {
    stripToolCallTextNodes(root);
  }
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
  for (let i = messages.length - 1; i >= 0; i--) {
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
        parent.closest('.dpp-tool-block') ||
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
    const sanitizedOriginal = sanitizeInternalPromptText(original);
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

function collapseToolBlock() {
  if (toolBlockEl) {
    setTimeout(() => {
      toolBlockEl?.setAttribute('data-collapsed', 'true');
    }, 1500);
  }
}

function appendToolBlockToMessage(message: Element, block: HTMLElement) {
  getAssistantResponseHost(message).appendChild(block);
}

function placeToolBlock(block: HTMLElement) {
  const tryPlace = () => {
    // Find last assistant message container
    const messages = getAssistantMessages();
    if (messages.length === 0) return false;

    const lastMsg = messages[messages.length - 1];
    appendToolBlockToMessage(lastMsg, block);
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
  const textarea = document.querySelector('textarea');
  return textarea?.tagName === 'TEXTAREA' ? textarea as HTMLTextAreaElement : null;
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

// 所有状态切换的唯一出口：写 dataset 并在状态真正变化时冒一句台词。
// （updatePetFromTokenSpeed 会在流式输出时高频调用 setPetState，
//  靠这里的变化检测避免气泡被反复重置。）
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

// 进入某状态时冒一句台词；对会轮播的状态再排程下一句。
function triggerPetBubble(state: PetState) {
  if (!currentPetConfig?.enabled || !petHostEl?.isConnected) return;
  if (petDragState) return; // 拖动期间保持安静
  clearPetBubbleRepeatTimer();
  petBubbleState = state;
  showPetBubble(pickPetLine(state, petRecentLines));
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
    if (petHostEl.dataset.state !== state) return; // 状态已变，交给新状态接管
    showPetBubble(pickPetLine(state, petRecentLines));
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

// 立刻收起气泡并停止轮播（拖动 / 悬停 / 移除时调用）。
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

// 鼠标移入宠物时收起气泡，让位给可能的悬停交互，且避免遮挡。
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

  // 拖动结束后，为会轮播的状态重新排程台词（拖动期间已被 hidePetBubble 静音）。
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
