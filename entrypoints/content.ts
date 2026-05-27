import type {
  BackgroundConfig,
  DeepSeekTheme,
  Memory,
  ModelType,
  Skill,
  SystemPromptPreset,
  ToolCall,
  ToolCardResult,
  ToolCallRestoreRecord,
  ToolDescriptor,
  ToolExecutionRecord,
} from '../core/types';
import { DEFAULT_TOOL_DESCRIPTORS, createToolInvocationCatalog } from '../core/tool/invocation';
import { normalizeBackgroundConfig } from '../core/background/config';
import { stripToolCalls } from '../core/interceptor/tool-parser';
import type { ResponseCompletePayload, ResponseTokenSpeedPayload } from '../core/interceptor/fetch-hook';
import type {
  InlineAgentStartPayload,
  InlineAgentStreamChunkMsg,
  InlineAgentStepCompleteMsg,
  InlineAgentLoopCompleteMsg,
  InlineAgentLoopErrorMsg,
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

const TOOL_BLOCK_ID = 'dpp-tool-block';
const TOOL_BLOCK_STYLE_ID = 'dpp-tool-block-css';
const TOKEN_SPEED_BADGE_ID = 'dpp-token-speed-badge';
const TOKEN_SPEED_STYLE_ID = 'dpp-token-speed-css';
const TOKEN_SPEED_BOOTSTRAP_RETRY_MS = 250;
const TOKEN_SPEED_BOOTSTRAP_RETRY_LIMIT = 40;
const TOKEN_SPEED_MOUNT_DEBOUNCE_MS = 500;
const TOKEN_SPEED_ROUTE_CHECK_MS = 500;
const TOOL_RESTORE_STORAGE_KEY = 'dpp_tool_execution_blocks';
const THEME_BOOTSTRAP_RETRY_MS = 250;
const THEME_BOOTSTRAP_RETRY_LIMIT = 20;

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
let inlineAgentContainer: HTMLElement | null = null;
let inlineAgentCurrentStep: HTMLElement | null = null;
let inlineAgentLoopId: string | null = null;
let currentMemories: Memory[] = [];
let currentSkills: Skill[] = [];
let currentActivePreset: SystemPromptPreset | null = null;
let currentModelType: ModelType = null;
let currentToolDescriptors: ToolDescriptor[] = [...DEFAULT_TOOL_DESCRIPTORS];
let toolOpenTagRe = buildToolOpenTagRegex(currentToolDescriptors);
let toolMarkerRe = buildToolMarkerRegex(currentToolDescriptors);
let extensionContextValid = true;

export default defineContentScript({
  matches: ['*://chat.deepseek.com/*'],
  runAt: 'document_start',
  async main() {
    installExtensionInvalidationGuards();

    const handleMainWorldMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== 'deepseek-pp-main') return;

      try {
        switch (event.data.type) {
          case 'TOOL_CALL': {
            const call = event.data.data as ToolCall;
            void runToolExecution(call);
            break;
          }
          case 'EXECUTE_TOOL_CALL': {
            const call = event.data.data as ToolCall;
            const id = event.data.id as string;
            const result = await executeToolCall(call).catch((err): ToolCardResult => ({
              ok: false,
              summary: '执行失败',
              detail: err instanceof Error ? err.message : String(err),
            }));
            window.postMessage({
              source: 'deepseek-pp-content',
              type: 'TOOL_CALL_RESULT',
              id,
              result,
            });
            break;
          }
          case 'RESTORE_TOOL_CALLS': {
            rememberRestoredToolRecords(event.data.records as ToolCallRestoreRecord[]);
            break;
          }
          case 'MEMORIES_USED': {
            const ids = event.data.ids as number[];
            await sendRuntimeMessage({ type: 'TOUCH_MEMORIES', payload: { ids } });
            break;
          }
          case 'RESPONSE_COMPLETE': {
            const complete = normalizeResponseCompletePayload(event.data.payload, event.data.text);
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
            break;
          }
          case 'RESPONSE_TOKEN_SPEED': {
            const progress = normalizeResponseTokenSpeedPayload(event.data.payload);
            if (progress) updateTokenSpeedIndicator(progress);
            break;
          }
          case 'AGENT_STEP_STARTED': {
            handleAgentStepStarted(event.data.data);
            break;
          }
          case 'AGENT_STREAM_CHUNK': {
            handleAgentStreamChunk(event.data.data as InlineAgentStreamChunkMsg);
            break;
          }
          case 'AGENT_TOOL_DETECTED': {
            break;
          }
          case 'AGENT_STEP_COMPLETE': {
            handleAgentStepComplete(event.data.data as InlineAgentStepCompleteMsg);
            break;
          }
          case 'AGENT_LOOP_COMPLETE': {
            handleAgentLoopComplete(event.data.data as InlineAgentLoopCompleteMsg);
            break;
          }
          case 'AGENT_LOOP_ERROR': {
            handleAgentLoopError(event.data.data as InlineAgentLoopErrorMsg);
            break;
          }
        }
      } catch (error) {
        if (isExtensionInvalidatedError(error)) {
          invalidateExtensionContext();
        }
      }
    };

    window.addEventListener('message', handleMainWorldMessage);

    await new Promise((r) => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') r(undefined);
      else document.addEventListener('DOMContentLoaded', () => r(undefined), { once: true });
    });

    startDeepSeekThemeSync();
    startTokenSpeedIndicatorBootstrap();
    startTokenSpeedIndicatorMountObserver();
    startTokenSpeedRouteWatcher();

    const [memories, skills, activePreset, modelType, toolDescriptors] = await Promise.all([
      sendRuntimeMessage<Memory[]>({ type: 'GET_MEMORIES' }),
      sendRuntimeMessage<Skill[]>({ type: 'GET_SKILLS' }),
      sendRuntimeMessage<SystemPromptPreset | null>({ type: 'GET_ACTIVE_PRESET' }),
      sendRuntimeMessage<ModelType>({ type: 'GET_MODEL_TYPE' }),
      sendRuntimeMessage<ToolDescriptor[]>({ type: 'GET_TOOL_DESCRIPTORS' }),
    ]);

    syncToMainWorld(memories ?? [], skills ?? [], activePreset ?? null, modelType ?? null, normalizeToolDescriptors(toolDescriptors));
    startRenderedToolCallCleaner();
    void restorePersistedToolBlocks();

    sendRuntimeMessage<BackgroundConfig | null>({ type: 'GET_BACKGROUND' }).then((cfg) => {
      applyBackground(cfg ?? null);
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
      }
      return undefined;
    });
  },
});

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
  stopDeepSeekThemeSync();
  if (restoredRenderTimer) {
    clearTimeout(restoredRenderTimer);
    restoredRenderTimer = null;
  }
  stopTokenSpeedIndicatorBootstrap();
  stopTokenSpeedIndicatorMountObserver();
  stopTokenSpeedRouteWatcher();
  removeTokenSpeedIndicator();
}

async function sendRuntimeMessage<T>(message: unknown): Promise<T | undefined> {
  if (!hasLiveExtensionContext()) return undefined;

  try {
    return await chrome.runtime.sendMessage(message) as T;
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
  const mcpExecutions = executions.filter((e) => e.provider?.kind === 'mcp');
  if (mcpExecutions.length === 0) return;
  if (!complete.chatSessionId || complete.assistantMessageId == null) return;

  const loopId = crypto.randomUUID();
  inlineAgentLoopId = loopId;

  const payload: InlineAgentStartPayload = {
    loopId,
    chatSessionId: complete.chatSessionId,
    parentMessageId: complete.assistantMessageId,
    originalPrompt: complete.agentTaskPrompt || complete.originalPrompt,
    agentTaskPrompt: complete.agentTaskPrompt || complete.originalPrompt,
    toolExecutions: mcpExecutions,
    promptOptions: {
      modelType: complete.promptOptions.modelType,
      searchEnabled: complete.promptOptions.searchEnabled,
      thinkingEnabled: complete.promptOptions.thinkingEnabled,
      refFileIds: complete.promptOptions.refFileIds,
    },
    toolDescriptors: currentToolDescriptors.filter((d) => d.provider?.kind === 'mcp'),
  };

  injectInlineAgentStyles();
  const container = createAgentContainer();

  const messages = getAssistantMessages();
  const target = messages[messages.length - 1];
  if (!target) return;

  inlineAgentContainer = container;
  const contentDiv = target.querySelector('._74c0879') ?? target;
  contentDiv.appendChild(container);

  window.postMessage({
    source: 'deepseek-pp-content',
    type: 'START_INLINE_AGENT_LOOP',
    payload,
  });
}

function stopInlineAgent(): void {
  const container = inlineAgentContainer;
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
  window.postMessage({ source: 'deepseek-pp-content', type: 'STOP_INLINE_AGENT_LOOP' });
  if (container) {
    const footer = createAgentFooter(0, 0, false, '已停止');
    container.appendChild(footer);
  }
}

function handleAgentStepStarted(data: { loopId: string; stepIndex: number }): void {
  if (data.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;

  const stepEl = createAgentStepElement(data.stepIndex, stopInlineAgent);
  inlineAgentCurrentStep = stepEl;
  inlineAgentContainer.appendChild(stepEl);
}

function handleAgentStreamChunk(msg: InlineAgentStreamChunkMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentCurrentStep) return;
  updateStepStreamText(inlineAgentCurrentStep, msg.fullText);
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
  inlineAgentCurrentStep = null;
}

function handleAgentLoopComplete(msg: InlineAgentLoopCompleteMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;

  const footer = createAgentFooter(msg.totalSteps, msg.totalTools, false);
  inlineAgentContainer.appendChild(footer);
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
}

function handleAgentLoopError(msg: InlineAgentLoopErrorMsg): void {
  if (msg.loopId !== inlineAgentLoopId || !inlineAgentContainer) return;

  if (inlineAgentCurrentStep) {
    updateStepStatus(inlineAgentCurrentStep, 'error', msg.error);
  }

  const footer = createAgentFooter(msg.stepIndex, 0, true);
  inlineAgentContainer.appendChild(footer);
  inlineAgentLoopId = null;
  inlineAgentContainer = null;
  inlineAgentCurrentStep = null;
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
      return result;
    });

  pendingToolExecutionTasks.add(task);
  void task.finally(() => {
    pendingToolExecutionTasks.delete(task);
  });
  return task;
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

  window.postMessage({
    source: 'deepseek-pp-content',
    type: 'SYNC_STATE',
    memories,
    skills,
    activePreset,
    modelType,
    toolDescriptors,
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
  const names = createToolInvocationCatalog(descriptors).invocationNames.map(escapeRegExp);
  return names.length > 0 ? names.join('|') : 'memory_save|memory_update|memory_delete';
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
  if (result && typeof result.ok === 'boolean' && typeof result.summary === 'string') {
    return {
      ok: result.ok,
      summary: result.summary,
      detail: result.detail,
      output: result.output,
      truncated: result.truncated,
      error: result.error,
    };
  }
  if (!extensionContextValid) {
    return { ok: false, summary: '执行失败', detail: '扩展已重新加载，请刷新当前 DeepSeek 页面后重试。' };
  }
  return { ok: false, summary: '执行失败', detail: '后台工具执行返回无效结果' };
}

async function sendRuntimeToolCallMessage(call: ToolCall): Promise<ToolCardResult | undefined> {
  if (!hasLiveExtensionContext()) return undefined;

  try {
    return await chrome.runtime.sendMessage({ type: 'EXECUTE_TOOL_CALL', payload: call }) as ToolCardResult;
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

    const block = createToolBlockShell({ restoreId: record.id, collapsed: false });
    updateToolBlockContent(block, executions);
    appendToolBlockToMessage(target, block);
    usedMessages.add(target);
  }

  cleanRenderedToolCalls();
  return missing;
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
    default:
      return { ok: true, summary: '已执行', detail };
  }
}

function getAssistantMessages(): Element[] {
  const messages = Array.from(document.querySelectorAll('.ds-message'));
  const assistantMessages = messages.filter((message) => message.querySelector('._74c0879'));
  return assistantMessages.length > 0 ? assistantMessages : messages;
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
    if (mutations.some(mutationMayContainToolMarker)) {
      schedule();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

function mutationMayContainToolMarker(mutation: MutationRecord): boolean {
  if (mutation.type === 'characterData') {
    return containsToolMarker(mutation.target.textContent);
  }

  for (const node of mutation.addedNodes) {
    if (containsToolMarker(node.textContent)) {
      return true;
    }
  }

  return false;
}

function containsToolMarker(text: string | null | undefined): boolean {
  return typeof text === 'string' && toolMarkerRe.test(text);
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

  if (toolExecutions.length > 0) {
    const messages = document.querySelectorAll('.ds-message');
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && containsToolMarker(lastMessage.textContent)) {
      roots.add(lastMessage);
    }
  }

  return Array.from(roots);
}

function stripToolCallTextNodes(root: Element) {
  if (!containsToolMarker(root.textContent)) return;

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
    let cursor = 0;
    let next = '';

    while (cursor < original.length) {
      if (activeTool) {
        const closeRe = new RegExp(`<\\s*/\\s*${escapeRegExp(activeTool)}\\s*>`, 'i');
        const closeMatch = closeRe.exec(original.slice(cursor));
        if (!closeMatch) {
          cursor = original.length;
          break;
        }
        cursor += closeMatch.index + closeMatch[0].length;
        activeTool = null;
        continue;
      }

      const openMatch = toolOpenTagRe.exec(original.slice(cursor));
      if (!openMatch) {
        next += original.slice(cursor);
        break;
      }

      next += original.slice(cursor, cursor + openMatch.index);
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
  const responseContent = message.querySelector('._74c0879');
  if (responseContent) {
    responseContent.appendChild(block);
    return;
  }

  message.appendChild(block);
}

function placeToolBlock(block: HTMLElement) {
  const tryPlace = () => {
    // Find last assistant message container
    const messages = document.querySelectorAll('.ds-message');
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
