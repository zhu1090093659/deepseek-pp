import {
  getAllMemories,
  getMemoryById,
  saveMemory,
  updateMemory,
  deleteMemory,
  deleteMemoriesForProject,
  touchMemories,
  replaceAllMemories,
  archiveStaleMemories,
} from '../core/memory/store';
import { filterMemoriesByProjectScope } from '../core/memory/scope';
import {
  deleteGitHubSkillSource,
  getAllSkillSources,
  getAllSkills,
  getSkillLibrary,
  getUserSkills,
  replaceAllCustomSkills,
  replaceAllSkillSources,
  saveSkill,
  setSkillEnabled,
  deleteSkill,
} from '../core/skill/registry';
import {
  checkGitHubSkillSourceUpdates,
  importGitHubSkillSource,
  previewGitHubSkillSource,
  updateGitHubSkillSource,
} from '../core/skill/github-importer';
import {
  importLocalSkillSource,
  pickLocalSkillFolder,
  previewLocalSkillSource,
} from '../core/skill/local-importer';
import {
  getAllPresets,
  savePreset,
  deletePreset,
  getActivePreset,
  setActivePresetId,
  replaceAllPresets,
} from '../core/preset/store';
import { getModelType, setModelType } from '../core/model/store';
import { getDeepSeekTheme, saveDeepSeekTheme } from '../core/theme/store';
import { getBackgroundConfig, saveBackgroundConfig, clearBackgroundConfig } from '../core/background/store';
import { getPetConfig, savePetConfig, clearPetConfig } from '../core/pet/store';
import { clearUsageRecords, getUsageSummary, recordUsageTurn } from '../core/usage/store';
import { getExtensionVersion } from '../core/version';
import { getSyncConfig, saveSyncConfig } from '../core/sync/config';
import { mergeLocalSkillImportsIntoSyncSnapshot } from '../core/sync/local-skill-merge';
import { createStorageBackend, type StorageBackend } from '../core/sync/storage-backend';
import { authorizeGDrive } from '../core/sync/gdrive-client';
import { authorizeOneDrive } from '../core/sync/onedrive-client';
import {
  parseValidatedArray,
  parseValidatedJson,
  validateImportedMemory,
  validatePreset,
  validateProjectContextState,
  validateSavedItemsState,
  validateSkillImportSource,
  validateSkill,
  validateStoredMemory,
} from '../core/sync/schema';
import { clearToolCallHistory, getToolCallHistory } from '../core/tool/history';
import {
  executeRuntimeToolCall,
  getRuntimeToolDescriptors,
  refreshRuntimeToolDescriptors,
  type RuntimeToolCallOptions,
} from '../core/tool/runtime';
import {
  browserControlService,
  getBrowserControlSettings,
  getBrowserControlState,
  saveBrowserControlSettings,
  setBrowserControlEnabled,
  type BrowserControlSettings,
} from '../core/browser-control';
import { filterSidepanelChatToolDescriptors } from '../core/tool/sidepanel';
import {
  addConversationToProject,
  bindPendingProjectConversation,
  createProjectContext,
  deleteProjectContext,
  formatProjectPromptContext,
  getProjectContextState,
  getProjectForConversation,
  getProjectPromptContextForConversation,
  removeConversationFromProject,
  saveProjectContextState,
  setPendingProjectContext,
  updateProjectContext,
} from '../core/project';
import { getArtifact } from '../core/artifact';
import {
  deleteSavedItem,
  getAllSavedItems,
  getSavedItemsState,
  replaceAllSavedItems,
  saveSavedItem,
} from '../core/saved-items';
import {
  getPromptInjectionSettings,
  savePromptInjectionSettings,
  shouldInjectPresetForTurn,
} from '../core/prompt/settings';
import {
  detectVoiceCapabilities,
  getVoiceSettings,
  saveVoiceSettings,
} from '../core/voice/settings';
import type { SandboxExecutionResult, SandboxRunRequest, SandboxToolRuntime } from '../core/sandbox';
import { getCurrentBrowserExtensionEnvironment } from '../core/platform';
import { readOptionalChromeApi } from '../core/platform/chrome-api';
import {
  dismissWhatsNew,
  hasPendingWhatsNew,
  markWhatsNewPending,
} from '../core/whats-new';
import {
  createMcpServer,
  deleteMcpServer,
  getAllMcpServers,
  getMcpToolCache,
  getMcpServerById,
  updateMcpServer,
} from '../core/mcp/store';
import { refreshMcpServerDiscovery } from '../core/mcp/discovery';
import { getMcpOriginPattern, requestMcpServerOriginPermission } from '../core/mcp/transports';
import { SHELL_MCP_NATIVE_HOST, SHELL_MCP_SERVER_NAME, createShellMcpPresetInput } from '../core/shell';
import {
  MULTIMODAL_MCP_REQUEST_TIMEOUT_MS,
  canUseMultimodalMediaInput,
  createMultimodalMcpPresetInput,
  isMultimodalAnalysisToolAllowed,
  isMultimodalMcpServer,
} from '../core/multimodal';
import {
  assertSupportedMultimodalMedia,
  MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN,
  type MultimodalMediaAnalysisItem,
  type MultimodalMediaAnalyzeRequest,
  type MultimodalMediaAnalyzeResponse,
  type MultimodalMediaInput,
} from '../core/multimodal/media';
import {
  clearMultimodalSettings,
  getMultimodalSettingsStatus,
  saveMultimodalSettings,
  type MultimodalSettingsPatch,
} from '../core/multimodal/settings';
import { getWebToolSettings, setWebToolEnabled } from '../core/tool/web-settings';
import { getAllScenarios, applyScenarioTemplate } from '../core/scenario/store';
import { getChatEnabled } from '../core/chat/store';
import {
  markChatLoopFinished,
  markChatLoopStarted,
  reconcileInterruptedChatLoop,
  type ChatLoopProvider,
} from '../core/chat/active-loop';
import {
  clearDeepSeekApiKey,
  DEEPSEEK_API_KEY_STORAGE_KEY,
  getDeepSeekApiKey,
  hasDeepSeekApiKey,
  saveDeepSeekApiKey,
} from '../core/chat/api-key';
import {
  getOfficialApiChatConfig,
  normalizeOfficialApiChatConfig,
  saveOfficialApiChatConfig,
  type OfficialApiChatConfig,
} from '../core/chat/official-api-config';
import {
  createAutomation,
  deleteAutomation,
  getAllAutomations,
  getAutomationById,
  getAutomationRuns,
  setAutomationStatus,
  updateAutomation,
} from '../core/automation/store';
import { runDeepSeekAutomation } from '../core/automation/runner';
import {
  AUTOMATION_WAKE_ALARM_NAME,
  AUTOMATION_WAKE_INTERVAL_MINUTES,
  refreshAutomationNextRunAt,
  runAutomation,
  scanDueAutomations,
} from '../core/automation/scheduler';
import { validateAutomationSchedule } from '../core/automation/schedule';
import {
  createChatSession,
  createPowHeaders,
  submitPromptStreaming,
  loadClientHeadersFromStorage,
} from '../core/deepseek/adapter';
import {
  submitOfficialDeepSeekStreaming,
  type OfficialDeepSeekMessage,
} from '../core/deepseek/official-api';
import { createDeepSeekConversationExportTransport } from '../core/deepseek/conversation-export';
import {
  buildConversationExportArtifactsCancellable,
  runConversationExport,
} from '../core/export/service';
import { normalizeConversationExportRequest } from '../core/export/schema';
import { buildPromptAugmentation } from '../core/prompt';
import { extractToolCalls } from '../core/interceptor/tool-parser';
import { broadcastRuntimeUpdate } from '../core/messaging/broadcast';
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
import type { WebSearchToolName } from '../core/tool/web-search';
import type { BackgroundConfig, CurrentDeepSeekConversation, DeepSeekTheme, GitHubSkillImportRequest, GitHubSkillSource, LocalSkillImportRequest, Memory, ModelType, NewMemory, PetConfig, ProjectContextState, SavedItemInput, Skill, SkillImportSource, SyncConfig, SyncConfigDraft, SyncCounts, SystemPromptPreset, ToolCall, ToolDescriptor, ToolExecutionRecord, ToolExecutionTrigger, ToolResult, UsageTurnInput } from '../core/types';
import type { McpServerCreateInput, McpServerUpdateInput } from '../core/mcp/types';
import type { AutomationCreateInput, AutomationRunnerRequest, AutomationRunnerResult, AutomationStatus, AutomationUpdateInput } from '../core/automation/types';
import type { ConversationExportProgress, ConversationExportResult } from '../core/export/types';

const DEEPSEEK_HOME_URL = 'https://chat.deepseek.com/';
const DEEPSEEK_TAB_URL_PATTERN = '*://chat.deepseek.com/*';
const REFRESH_AUTH_MESSAGE = { type: 'REFRESH_DEEPSEEK_AUTH' } as const;
let chatSessionId: string | null = null;
let chatParentMessageId: number | null = null;
let officialApiChatMessages: OfficialDeepSeekMessage[] = [];
const conversationExportControllers = new Map<string, AbortController>();
let currentBackgroundLocale: SupportedLocale = DEFAULT_LOCALE;
let currentBackgroundTranslator = createTranslator(DEFAULT_LOCALE);
let sandboxOffscreenCreation: Promise<void> | null = null;
const SANDBOX_OFFSCREEN_URL = 'sandbox-offscreen.html';
const SANDBOX_OFFSCREEN_PORT = 'sandbox-offscreen';
const browserSandboxRuntime: SandboxToolRuntime = {
  runSandbox: (request) => runBrowserSandboxToolResult(request),
};

function backgroundT(key: LocaleMessageKey, params?: MessageParams): string {
  return currentBackgroundTranslator.t(key, params);
}

async function refreshBackgroundLocale(): Promise<void> {
  const resolved = await getResolvedLocaleState();
  currentBackgroundLocale = resolved.locale;
  currentBackgroundTranslator = createTranslator(resolved.locale);
}
type SidePanelApi = {
  setPanelBehavior?: (options: { openPanelOnActionClick: boolean }) => Promise<void>;
};

type ActionApi = {
  setBadgeText?: (details: { text: string }) => Promise<void> | void;
  setBadgeBackgroundColor?: (details: { color: string }) => Promise<void> | void;
};

type SyncDataSnapshot = {
  memories: Omit<Memory, 'id'>[];
  skills: Skill[];
  skillSources: SkillImportSource[];
  presets: SystemPromptPreset[];
  projectContext: ProjectContextState | null;
  savedItems: Awaited<ReturnType<typeof getSavedItemsState>> | null;
};

export default defineBackground(() => {
  enableSidePanelActionClick();
  registerWhatsNewInstallListener();
  registerAutomationAlarmListener();
  refreshBackgroundLocale()
    .then(() => createContextMenus())
    .catch((error) => reportBackgroundStartupError('locale_init_failed', error));
  watchLocalePreference(() => {
    refreshBackgroundLocale()
      .then(async () => {
        await createContextMenus();
        await broadcastStateUpdate();
        await broadcastToolDescriptorsUpdate();
      })
      .catch((error) => reportBackgroundStartupError('locale_refresh_failed', error));
  });

  archiveStaleMemories().catch((error) => reportBackgroundStartupError('archive_stale_memories_failed', error));
  ensureBuiltInMcpPresets().catch((error) => reportBackgroundStartupError('builtin_mcp_presets_failed', error));
  refreshWhatsNewBadge().catch((error) => reportBackgroundStartupError('whats_new_badge_failed', error));
  ensureAutomationWakeAlarm().catch((error) => reportBackgroundStartupError('automation_alarm_create_failed', error));
  reconcileInterruptedChatLoopOnWake().catch((error) => reportBackgroundStartupError('chat_loop_reconcile_failed', error));
  scanDueAutomationsFromWake().catch((error) => reportBackgroundStartupError('automation_startup_scan_failed', error));

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse(createBackgroundErrorResponse(message, error)));
    return true;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if ('deepseek_pp_chat_enabled' in changes || DEEPSEEK_API_KEY_STORAGE_KEY in changes) {
      createContextMenus().catch(() => {});
      broadcastChatAuthStatus().catch(() => {});
    }
  });
});

function registerAutomationAlarmListener() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== AUTOMATION_WAKE_ALARM_NAME) return;
    scanDueAutomationsFromWake().catch((error) => reportBackgroundStartupError('automation_alarm_scan_failed', error));
  });
}

async function ensureAutomationWakeAlarm() {
  await chrome.alarms.create(AUTOMATION_WAKE_ALARM_NAME, {
    periodInMinutes: AUTOMATION_WAKE_INTERVAL_MINUTES,
  });
}

function enableSidePanelActionClick() {
  if (import.meta.env.FIREFOX) return;

  const sidePanel = readOptionalChromeApi(
    () => (chrome as typeof chrome & { sidePanel?: SidePanelApi }).sidePanel,
  );
  sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((error) => reportBackgroundStartupError('sidepanel_behavior_failed', error));
}

function registerWhatsNewInstallListener() {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update') return;

    markWhatsNewPending(details.previousVersion ?? null)
      .then(() => refreshWhatsNewBadge())
      .catch((error) => reportBackgroundStartupError('whats_new_update_failed', error));
  });
}

async function refreshWhatsNewBadge() {
  const action = readOptionalChromeApi(
    () => (chrome as typeof chrome & { action?: ActionApi }).action,
  );
  if (!action?.setBadgeText) return;

  const showBadge = await hasPendingWhatsNew();
  await action.setBadgeText({ text: showBadge ? 'NEW' : '' });
  if (showBadge && action.setBadgeBackgroundColor) {
    await action.setBadgeBackgroundColor({ color: '#4D6BFE' });
  }
}

async function createContextMenus() {
  const chatEnabled = await getChatEnabled();
  if (!chatEnabled) {
    try { await chrome.contextMenus.removeAll(); } catch {}
    return;
  }
  try {
    await chrome.contextMenus.removeAll();
  } catch {}
  const apiKeyConfigured = await hasDeepSeekApiKey();
  const menuScope = apiKeyConfigured
    ? {}
    : { documentUrlPatterns: [DEEPSEEK_TAB_URL_PATTERN] };
  const scenarios = await getAllScenarios();
  const enabledScenarios = scenarios.filter((s) => s.enabled);

  chrome.contextMenus.create({
    id: 'send-to-chat',
    title: backgroundT('background.contextMenus.sendToChat'),
    contexts: ['selection'],
    ...menuScope,
  });

  if (enabledScenarios.length > 0) {
    chrome.contextMenus.create({
      id: 'separator-1',
      type: 'separator',
      contexts: ['selection'],
      ...menuScope,
    });

    for (const scenario of enabledScenarios) {
      chrome.contextMenus.create({
        id: `scenario-${scenario.id}`,
        title: scenario.label,
        contexts: ['selection'],
        ...menuScope,
      });
    }
  }
}

try {
  chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
    if (!info.selectionText) return;
    const selectedText = info.selectionText.trim();
    if (!selectedText) return;

    // Open the sidepanel before async boundaries so the user gesture remains valid.
    const tabId = tab?.id;
    if (tabId && chrome.sidePanel?.open) {
      chrome.sidePanel.open({ tabId }).catch(() => {});
    }

    const chatEnabled = await getChatEnabled();
    if (!chatEnabled) return;

    if (info.menuItemId === 'send-to-chat') {
      openSidePanelAndSendText(selectedText, tab).catch(() => {});
      return;
    }

    if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('scenario-')) {
      const scenarioId = info.menuItemId.slice('scenario-'.length);
      getAllScenarios()
        .then((scenarios) => {
          const scenario = scenarios.find((s) => s.id === scenarioId);
          if (!scenario) return;
          const processed = applyScenarioTemplate(scenario.template, selectedText);
          openSidePanelAndSendText(processed, tab);
        })
        .catch(() => {});
      return;
    }
  });
} catch {}

async function openSidePanelAndSendText(text: string, tab?: chrome.tabs.Tab) {
  // Persist to storage as a fallback because the sidepanel may not be ready for messages yet.
  try {
    await chrome.storage.local.set({ pendingChatText: text });
  } catch {}

  chrome.runtime.sendMessage({ type: 'OPEN_CHAT_WITH_TEXT', text }).catch(() => {});
}

async function ensureBuiltInMcpPresets() {
  const servers = await getAllMcpServers();
  const shellExists = servers.some((s) =>
    s.displayName === SHELL_MCP_SERVER_NAME || s.transport.nativeHost === SHELL_MCP_NATIVE_HOST
  );
  if (!shellExists) {
    await createMcpServer(createShellMcpPresetInput({ enabled: false }));
  }
  const multimodalExists = servers.some(isMultimodalMcpServer);
  if (!multimodalExists) {
    await createMcpServer(createMultimodalMcpPresetInput({ enabled: false }));
  }
}

function reportBackgroundStartupError(code: string, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[DeepSeek++] ${code}: ${detail}`, error);
}

function createBackgroundErrorResponse(
  message: { type?: string } | unknown,
  error: unknown,
): ToolResult | { ok: false; error: string } | null {
  const detail = error instanceof Error ? error.message : String(error);

  if (!message || typeof message !== 'object') {
    return null;
  }

  const type = (message as { type?: string }).type;

  if (type === 'EXECUTE_TOOL_CALL') {
    return {
      ok: false,
      summary: backgroundT('content.toolBlock.summaries.backgroundFailed'),
      detail,
      error: {
        code: 'background_tool_execution_failed',
        message: detail,
        retryable: true,
      },
    };
  }

  // Sidepanel sync handlers check result?.ok; content scripts use sendRuntimeMessage
  // which guards against error responses. Return structured error for both.
  return { ok: false, error: detail };
}

async function handleMessage(
  message: { type: string; payload?: unknown },
  sender: chrome.runtime.MessageSender,
) {
  switch (message.type) {
    case 'GET_MEMORIES':
      return getAllMemories();

    case 'GET_MEMORY_BY_ID': {
      const { id: memId } = message.payload as { id: number };
      return getMemoryById(memId) ?? null;
    }

    case 'SAVE_MEMORY': {
      const id = await saveMemory(message.payload as NewMemory);
      await broadcastStateUpdate(sender.tab?.id);
      return { id };
    }

    case 'IMPORT_MEMORY_DRAFTS': {
      const { memories } = message.payload as { memories?: NewMemory[] };
      if (!Array.isArray(memories)) return { ok: false, error: 'invalid_memories' };
      let validatedMemories: NewMemory[];
      try {
        validatedMemories = memories.map((memory, index) => validateImportedMemory(memory, `memories[${index}]`));
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'invalid_memories',
        };
      }
      const ids: number[] = [];
      for (const memory of validatedMemories) {
        ids.push(await saveMemory(memory));
      }
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, ids, count: ids.length };
    }

    case 'UPDATE_MEMORY': {
      await updateMemory(message.payload as Memory);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_MEMORY': {
      const { id } = message.payload as { id: number };
      await deleteMemory(id);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'TOUCH_MEMORIES': {
      const { ids } = message.payload as { ids: number[] };
      await touchMemories(ids);
      return { ok: true };
    }

    case 'GET_SKILLS':
      return getAllSkills({ locale: currentBackgroundLocale });

    case 'GET_SKILL_LIBRARY':
      return getSkillLibrary(currentBackgroundLocale);

    case 'GET_SKILL_SOURCES':
      return getAllSkillSources();

    case 'GET_GITHUB_SKILL_SOURCES':
      return (await getAllSkillSources()).filter((source) => source.provider === 'github');

    case 'SAVE_SKILL': {
      const payload = message.payload as Skill | { skill: Skill; previousName?: string };
      const { skill, previousName } = 'skill' in payload ? payload : { skill: payload, previousName: undefined };
      await saveSkill(skill, previousName);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_SKILL': {
      const { name } = message.payload as { name: string };
      await deleteSkill(name);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_SKILL_ENABLED': {
      const { name, enabled } = message.payload as { name: string; enabled: boolean };
      await setSkillEnabled(name, enabled);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'PREVIEW_GITHUB_SKILL_SOURCE': {
      const { url } = message.payload as { url: string };
      return previewGitHubSkillSource(url);
    }

    case 'IMPORT_GITHUB_SKILL_SOURCE': {
      const result = await importGitHubSkillSource(message.payload as GitHubSkillImportRequest);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'PREVIEW_LOCAL_SKILL_SOURCE': {
      const { rootPath } = message.payload as { rootPath: string };
      return previewLocalSkillSource(rootPath);
    }

    case 'PICK_LOCAL_SKILL_FOLDER': {
      const { defaultPath } = (message.payload ?? {}) as { defaultPath?: string };
      return { path: await pickLocalSkillFolder(defaultPath) };
    }

    case 'IMPORT_LOCAL_SKILL_SOURCE': {
      const result = await importLocalSkillSource(message.payload as LocalSkillImportRequest);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'CHECK_GITHUB_SKILL_SOURCE_UPDATES': {
      const { sourceId } = message.payload as { sourceId: string };
      return checkGitHubSkillSourceUpdates(sourceId);
    }

    case 'UPDATE_GITHUB_SKILL_SOURCE': {
      const { sourceId } = message.payload as { sourceId: string };
      const result = await updateGitHubSkillSource(sourceId);
      await broadcastStateUpdate(sender.tab?.id);
      return result;
    }

    case 'DELETE_GITHUB_SKILL_SOURCE': {
      const { sourceId } = message.payload as { sourceId: string };
      await deleteGitHubSkillSource(sourceId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_PRESETS':
      return getAllPresets();

    case 'SAVE_PRESET': {
      await savePreset(message.payload as SystemPromptPreset);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DELETE_PRESET': {
      const { id: presetId } = message.payload as { id: string };
      await deletePreset(presetId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_ACTIVE_PRESET': {
      const { id: activeId } = message.payload as { id: string | null };
      await setActivePresetId(activeId);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_ACTIVE_PRESET':
      return getActivePreset();

    case 'GET_PROMPT_INJECTION_SETTINGS':
      return getPromptInjectionSettings();

    case 'SAVE_PROMPT_INJECTION_SETTINGS': {
      const settings = await savePromptInjectionSettings(message.payload as Parameters<typeof savePromptInjectionSettings>[0]);
      await broadcastStateUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_SAVED_ITEMS':
      return getAllSavedItems();

    case 'SAVE_SAVED_ITEM': {
      const item = await saveSavedItem(message.payload as SavedItemInput);
      await broadcastSavedItemsUpdate(sender.tab?.id);
      return item;
    }

    case 'DELETE_SAVED_ITEM': {
      const { id } = message.payload as { id: string };
      await deleteSavedItem(id);
      await broadcastSavedItemsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_VOICE_SETTINGS':
      return getVoiceSettings();

    case 'SAVE_VOICE_SETTINGS': {
      const settings = await saveVoiceSettings(message.payload as Parameters<typeof saveVoiceSettings>[0]);
      await broadcastVoiceSettingsUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_VOICE_CAPABILITIES':
      return detectVoiceCapabilities();

    case 'GET_MCP_SERVERS':
      return getAllMcpServers();

    case 'GET_MCP_SERVER': {
      const { id } = message.payload as { id: string };
      return getMcpServerById(id);
    }

    case 'CREATE_MCP_SERVER': {
      const server = await createMcpServer(message.payload as McpServerCreateInput);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return server;
    }

    case 'UPDATE_MCP_SERVER': {
      const { id, patch } = message.payload as { id: string; patch: McpServerUpdateInput };
      const server = await updateMcpServer(id, patch);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return server;
    }

    case 'DELETE_MCP_SERVER': {
      const { id } = message.payload as { id: string };
      await deleteMcpServer(id);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_MCP_TOOL_CACHE': {
      const { serverId } = message.payload as { serverId: string };
      return getMcpToolCache(serverId);
    }

    case 'REFRESH_MCP_SERVER_TOOLS': {
      const { serverId } = message.payload as { serverId: string };
      const cache = await refreshMcpServerDiscovery(serverId);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return cache;
    }

    case 'REQUEST_MCP_SERVER_PERMISSION': {
      const { serverId } = message.payload as { serverId: string };
      const server = await getMcpServerById(serverId);
      if (!server) return { ok: false, error: 'mcp_server_not_found' };
      if (server.transport.kind === 'native_messaging') return { ok: true, origin: null };
      try {
        const origin = getMcpOriginPattern(server);
        const ok = await requestMcpServerOriginPermission(server);
        return { ok, origin };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'TEST_MCP_SERVER_CONNECTION': {
      const { serverId } = message.payload as { serverId: string };
      const cache = await refreshMcpServerDiscovery(serverId);
      await broadcastMcpServersUpdate(sender.tab?.id);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return {
        ok: cache.health.status === 'ready',
        cache,
        health: cache.health,
      };
    }

    case 'GET_WEB_TOOL_SETTINGS':
      return getWebToolSettings();

    case 'SET_WEB_TOOL_SETTING': {
      const { name, enabled } = message.payload as { name: WebSearchToolName; enabled: boolean };
      await setWebToolEnabled(name, enabled);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_BROWSER_CONTROL_SETTINGS':
      return getBrowserControlSettings();

    case 'SAVE_BROWSER_CONTROL_SETTINGS': {
      const settings = await saveBrowserControlSettings(message.payload as Partial<BrowserControlSettings>);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return settings;
    }

    case 'SET_BROWSER_CONTROL_ENABLED': {
      const { enabled } = message.payload as { enabled: boolean };
      const settings = await setBrowserControlEnabled(enabled);
      if (!enabled) await browserControlService.detach();
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return settings;
    }

    case 'GET_BROWSER_CONTROL_STATE':
      return getBrowserControlState();

    case 'SET_BROWSER_CONTROL_TARGET': {
      const { tabId } = message.payload as { tabId: number };
      const target = await browserControlService.setTarget(tabId);
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true, target };
    }

    case 'DETACH_BROWSER_CONTROL': {
      await browserControlService.detach();
      await broadcastBrowserControlUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'DIAGNOSE_WEB_SEARCH': {
      const q = typeof (message.payload as { query?: string })?.query === 'string'
        ? (message.payload as { query: string }).query : 'test';
      const diags: Record<string, { status: number; length: number; error?: string; preview?: string }> = {};
      for (const domain of ['cn.bing.com', 'www.bing.com']) {
        const url = `https://${domain}/search?q=${encodeURIComponent(q)}`;
        try {
          const resp = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept-Language': 'zh-CN,zh;q=0.9',
            },
            signal: AbortSignal.timeout(10_000),
          });
          const text = await resp.text();
          diags[domain] = {
            status: resp.status,
            length: text.length,
            preview: text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200),
          };
        } catch (e) {
          diags[domain] = {
            status: 0,
            length: 0,
            error: e instanceof Error ? e.message.slice(0, 150) : String(e).slice(0, 150),
          };
        }
      }
      return diags;
    }

    case 'REQUEST_HOST_PERMISSION': {
      const { origins } = message.payload as { origins: string[] };
      if (!origins?.length) return { ok: false, error: 'no_origins' };
      try {
        const granted = await chrome.permissions.request({ origins }).catch(() => false);
        return { ok: granted, origins };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'GET_TOOL_DESCRIPTORS':
      return getRuntimeToolDescriptors(currentBackgroundLocale);

    case 'REFRESH_TOOL_DESCRIPTORS': {
      const tools = await refreshRuntimeToolDescriptors(currentBackgroundLocale);
      await broadcastToolDescriptorsUpdate(sender.tab?.id);
      await broadcastMcpServersUpdate(sender.tab?.id);
      return tools;
    }

    case 'EXECUTE_TOOL_CALL': {
      const call = message.payload as ToolCall;
      const result = await executeBackgroundRuntimeToolCall(call, call.source?.trigger ?? 'manual_chat');
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      return result;
    }

    case 'RUN_ARTIFACT_CODE':
      return runBrowserSandboxToolResult(message.payload as SandboxRunRequest);

    case 'GET_TOOL_CALL_HISTORY': {
      const { limit } = (message.payload as { limit?: number } | undefined) ?? {};
      return getToolCallHistory(limit);
    }

    case 'CLEAR_TOOL_CALL_HISTORY': {
      await clearToolCallHistory();
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_PLATFORM_CAPABILITIES':
      return getCurrentBrowserExtensionEnvironment();

    case 'GET_PROJECT_CONTEXT_STATE':
      return getProjectContextState();

    case 'CREATE_PROJECT_CONTEXT': {
      const project = await createProjectContext(message.payload as Parameters<typeof createProjectContext>[0]);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return project;
    }

    case 'UPDATE_PROJECT_CONTEXT': {
      const { projectId, patch } = message.payload as { projectId: string; patch: Parameters<typeof updateProjectContext>[1] };
      const project = await updateProjectContext(projectId, patch);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return project;
    }

    case 'DELETE_PROJECT_CONTEXT': {
      const { projectId } = message.payload as { projectId: string };
      await deleteProjectContext(projectId);
      const deletedMemories = await deleteMemoriesForProject(projectId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      if (deletedMemories > 0) await broadcastStateUpdate(sender.tab?.id);
      return { ok: true, deletedMemories };
    }

    case 'ADD_CONVERSATION_TO_PROJECT': {
      const { projectId, conversation } = message.payload as { projectId: string; conversation: Parameters<typeof addConversationToProject>[1] };
      const added = await addConversationToProject(projectId, conversation);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true, conversation: added };
    }

    case 'REMOVE_CONVERSATION_FROM_PROJECT': {
      const { conversationId } = message.payload as { conversationId: string };
      await removeConversationFromProject(conversationId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'SET_PENDING_PROJECT_CONTEXT': {
      const { projectId } = message.payload as { projectId: string | null };
      await setPendingProjectContext(projectId);
      await broadcastProjectContextUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_CURRENT_DEEPSEEK_CONVERSATION':
      return getCurrentDeepSeekConversation();

    case 'GET_PROJECT_CONTEXT_FOR_CONVERSATION': {
      const { conversation, bindPendingProject } = message.payload as {
        conversation: Parameters<typeof bindPendingProjectConversation>[0];
        bindPendingProject?: boolean;
      };
      const bound = bindPendingProject === true
        ? await bindPendingProjectConversation(conversation)
        : null;
      if (bound) await broadcastProjectContextUpdate(sender.tab?.id);
      const project = await getProjectForConversation(conversation.conversationId);
      if (!project) return null;
      const context = await getProjectPromptContextForConversation(conversation.conversationId);
      return {
        projectId: project.id,
        context: context ? formatProjectPromptContext(context) : null,
      };
    }

    case 'GET_ARTIFACT': {
      const { id } = message.payload as { id: string };
      const artifact = await getArtifact(id);
      return artifact ? { ok: true, artifact } : { ok: false, error: 'artifact_not_found' };
    }

    case 'GET_CONFIG':
      return { version: getExtensionVersion() };

    case 'WHATS_NEW_DISMISSED': {
      await dismissWhatsNew();
      await refreshWhatsNewBadge();
      return { ok: true };
    }

    case 'GET_DEEPSEEK_API_KEY_STATUS':
      return { ok: true, configured: await hasDeepSeekApiKey() };

    case 'SAVE_DEEPSEEK_API_KEY': {
      const { apiKey } = message.payload as { apiKey?: string };
      await saveDeepSeekApiKey(apiKey ?? '');
      officialApiChatMessages = [];
      await createContextMenus();
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true, configured: true };
    }

    case 'CLEAR_DEEPSEEK_API_KEY':
      await clearDeepSeekApiKey();
      officialApiChatMessages = [];
      await createContextMenus();
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true, configured: false };

    case 'GET_MULTIMODAL_SETTINGS_STATUS':
      return { ok: true, ...(await getMultimodalSettingsStatus()) };

    case 'SAVE_MULTIMODAL_SETTINGS':
      return { ok: true, ...(await saveMultimodalSettings(message.payload as MultimodalSettingsPatch)) };

    case 'CLEAR_MULTIMODAL_SETTINGS':
      return { ok: true, ...(await clearMultimodalSettings()) };

    case 'ANALYZE_MULTIMODAL_MEDIA': {
      const response = await analyzeMultimodalMedia(message.payload as MultimodalMediaAnalyzeRequest);
      await broadcastToolCallHistoryUpdate(sender.tab?.id);
      if (!response.ok) {
        return {
          ok: false,
          error: response.error ?? 'multimodal_analysis_failed',
          analyses: response.analyses,
        };
      }
      return response;
    }

    case 'GET_DEEPSEEK_THEME':
      return getDeepSeekTheme();

    case 'SET_DEEPSEEK_THEME': {
      const { theme } = message.payload as { theme?: DeepSeekTheme };
      if (theme !== 'light' && theme !== 'dark') return { ok: false, error: 'invalid_theme' };
      const current = await getDeepSeekTheme();
      if (current === theme) return { ok: true };
      await saveDeepSeekTheme(theme);
      await broadcastThemeUpdate(theme, sender.tab?.id);
      return { ok: true };
    }

    case 'GET_MODEL_TYPE':
      return getModelType();

    case 'SET_MODEL_TYPE': {
      const newModelType = message.payload as ModelType;
      const current = await getModelType();
      if (newModelType === current) return { ok: true };
      await setModelType(newModelType);
      await broadcastStateUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'RECORD_USAGE_TURN':
      return recordUsageTurn(message.payload as UsageTurnInput);

    case 'GET_USAGE_SUMMARY': {
      const { rangeDays } = (message.payload ?? {}) as { rangeDays?: unknown };
      return getUsageSummary(rangeDays);
    }

    case 'CLEAR_USAGE_STATS':
      await clearUsageRecords();
      return { ok: true };

    case 'GET_BACKGROUND':
      return getBackgroundConfig();

    case 'SAVE_BACKGROUND': {
      const bgConfig = message.payload as BackgroundConfig;
      await saveBackgroundConfig(bgConfig);
      await broadcastBackgroundUpdate(bgConfig);
      return { ok: true };
    }

    case 'CLEAR_BACKGROUND': {
      await clearBackgroundConfig();
      await broadcastBackgroundUpdate(null);
      return { ok: true };
    }

    case 'GET_PET':
      return getPetConfig();

    case 'SAVE_PET': {
      const petConfig = message.payload as PetConfig;
      await savePetConfig(petConfig);
      await broadcastPetUpdate(petConfig);
      return { ok: true };
    }

    case 'CLEAR_PET': {
      await clearPetConfig();
      await broadcastPetUpdate(await getPetConfig());
      return { ok: true };
    }

    case 'GET_SYNC_CONFIG':
      return getSyncConfig();

    case 'SAVE_SYNC_CONFIG': {
      await saveSyncConfig(message.payload as SyncConfig);
      return { ok: true };
    }

    case 'WEBDAV_TEST': {
      const backend = createStorageBackend(message.payload as SyncConfig);
      await backend.test();
      return { ok: true };
    }

    case 'SYNC_AUTHORIZE': {
      // Must run in background: chrome.identity.launchWebAuthFlow requires the
      // extension context and cannot be called from a content/offscreen context.
      const draft = message.payload as SyncConfigDraft;
      if (draft.provider === 'gdrive') {
        const refreshToken = await authorizeGDrive(draft);
        return { ok: true, refreshToken };
      }
      if (draft.provider === 'onedrive') {
        const refreshToken = await authorizeOneDrive(draft);
        return { ok: true, refreshToken };
      }
      throw new Error('当前同步方式不需要授权');
    }

    case 'WEBDAV_UPLOAD_LOCAL': {
      const config = await getSyncConfig();
      if (!config) throw new Error(backgroundT('background.sync.missingSync'));

      const backend = createStorageBackend(config);
      const [, snapshot] = await Promise.all([
        backend.ensureStore(),
        getLocalSyncDataSnapshot(),
      ]);

      await uploadSyncDataSnapshot(backend, snapshot);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      return { ok: true, lastSyncAt: now, counts: getSyncCounts(snapshot) };
    }

    case 'WEBDAV_DOWNLOAD_REMOTE': {
      const config = await getSyncConfig();
      if (!config) throw new Error(backgroundT('background.sync.missingSync'));

      const backend = createStorageBackend(config);
      const snapshot = await mergeSyncSnapshotWithLocalImports(await getRemoteSyncDataSnapshot(backend));

      const replacements: Promise<unknown>[] = [
        replaceAllMemories(snapshot.memories),
        replaceAllCustomSkills(snapshot.skills),
        replaceAllSkillSources(snapshot.skillSources),
        replaceAllPresets(snapshot.presets),
      ];
      if (snapshot.projectContext) {
        replacements.push(saveProjectContextState(snapshot.projectContext));
      }
      if (snapshot.savedItems) {
        replacements.push(replaceAllSavedItems(snapshot.savedItems.items));
      }
      await Promise.all(replacements);

      const now = Date.now();
      await saveSyncConfig({ ...config, lastSyncAt: now });
      await broadcastStateUpdate(sender.tab?.id);
      if (snapshot.projectContext) await broadcastProjectContextUpdate(sender.tab?.id);
      if (snapshot.savedItems) await broadcastSavedItemsUpdate(sender.tab?.id);
      return { ok: true, lastSyncAt: now, counts: getSyncCounts(snapshot) };
    }

    case 'CHAT_SUBMIT_PROMPT': {
      const { text, config } = message.payload as { text: string; config?: Partial<OfficialApiChatConfig> };
      if (!(await getChatEnabled())) {
        return { ok: false, error: 'chat_disabled' };
      }
      if (!text?.trim()) return { ok: false, error: 'empty_prompt' };
      // Fire and forget — the streaming response is broadcast
      handleChatSubmitPrompt(text, config, sender.tab?.id).catch(() => {});
      return { ok: true };
    }

    case 'CHAT_NEW_SESSION':
      chatSessionId = null;
      chatParentMessageId = null;
      officialApiChatMessages = [];
      return { ok: true };

    case 'GET_AUTH_STATUS': {
      return getChatAuthStatus(sender.tab?.id);
    }

    case 'GET_OFFICIAL_API_CHAT_CONFIG':
      return getOfficialApiChatConfig();

    case 'SAVE_OFFICIAL_API_CHAT_CONFIG':
      return saveOfficialApiChatConfig(message.payload);

    case 'EXPORT_DEEPSEEK_CONVERSATIONS':
      return handleConversationExport(message.payload, sender.tab?.id);

    case 'CANCEL_DEEPSEEK_EXPORT': {
      const { exportId } = message.payload as { exportId?: string };
      if (!exportId) return { ok: false, error: 'missing_export_id' };
      const controller = conversationExportControllers.get(exportId);
      if (!controller) return { ok: false, error: 'export_not_running' };
      controller.abort();
      conversationExportControllers.delete(exportId);
      await broadcastConversationExportProgress({
        exportId,
        phase: 'cancelled',
        status: 'cancelled',
        current: 0,
        total: 0,
        message: backgroundT('background.export.cancelled'),
      }, sender.tab?.id);
      return { ok: true };
    }

    case 'AUTH_STATUS_CHANGED': {
      await broadcastChatAuthStatus(sender.tab?.id);
      return { ok: true };
    }

    case 'GET_AUTOMATIONS':
      return getAllAutomations();

    case 'GET_AUTOMATION_RUNS': {
      const { automationId, limit } = message.payload as { automationId: string; limit?: number };
      return getAutomationRuns({ automationId, limit });
    }

    case 'CREATE_AUTOMATION': {
      const input = message.payload as AutomationCreateInput;
      validateAutomationInput(input);
      const automation = await createAutomation(input);
      const refreshed = await refreshAutomationNextRunAt(automation.id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return refreshed ?? automation;
    }

    case 'UPDATE_AUTOMATION': {
      const { id, patch } = message.payload as { id: string; patch: AutomationUpdateInput };
      validateAutomationPatch(patch);
      const automation = await updateAutomation(id, patch);
      if (!automation) return { ok: false, error: 'automation_not_found' };
      const refreshed = await refreshAutomationNextRunAt(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return refreshed ?? automation;
    }

    case 'SET_AUTOMATION_STATUS': {
      const { id, status } = message.payload as { id: string; status: AutomationStatus };
      if (!isAutomationStatus(status)) return { ok: false, error: 'invalid_automation_status' };
      const automation = await setAutomationStatus(id, status);
      if (!automation) return { ok: false, error: 'automation_not_found' };
      const refreshed = await refreshAutomationNextRunAt(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      return refreshed ?? automation;
    }

    case 'DELETE_AUTOMATION': {
      const { id } = message.payload as { id: string };
      await deleteAutomation(id);
      await broadcastAutomationUpdate(sender.tab?.id);
      await broadcastAutomationRunsUpdate(sender.tab?.id);
      return { ok: true };
    }

    case 'RUN_AUTOMATION_NOW': {
      const { id } = message.payload as { id: string };
      return runAutomationNow(id, sender.tab?.id);
    }

    case 'SCENARIOS_UPDATED':
      await createContextMenus();
      return { ok: true };

    default:
      return null;
  }
}

async function broadcastToTabs(payload: Record<string, unknown>, excludeTabId?: number) {
  await broadcastRuntimeUpdate(payload, excludeTabId, {
    tabUrlPattern: DEEPSEEK_TAB_URL_PATTERN,
    sendRuntimeMessage: (message) => chrome.runtime.sendMessage(message),
    queryTabsByUrl: (urlPattern) => chrome.tabs.query({ url: urlPattern }),
    sendTabMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    reportError: reportBackgroundStartupError,
  });
}

async function loadOrRefreshClientHeaders(preferredTabId?: number): Promise<Record<string, string> | null> {
  const cached = await loadClientHeadersFromStorage();
  if (cached) return cached;

  await refreshClientHeadersFromDeepSeekTabs(preferredTabId);
  return loadClientHeadersFromStorage();
}

async function refreshClientHeadersFromDeepSeekTabs(preferredTabId?: number): Promise<boolean> {
  const tabs = await getDeepSeekTabsForAuthRefresh(preferredTabId);
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const response = await chrome.tabs.sendMessage(tab.id, REFRESH_AUTH_MESSAGE);
      if (response?.hasToken === true) return true;
    } catch {
      // Content scripts may be absent on stale or restricted tabs; try the next live DeepSeek tab.
    }
  }
  return false;
}

async function getDeepSeekTabsForAuthRefresh(preferredTabId?: number): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: DEEPSEEK_TAB_URL_PATTERN });
  if (!preferredTabId) {
    return tabs.sort((a, b) => Number(b.active) - Number(a.active));
  }

  const preferred = tabs.find((tab) => tab.id === preferredTabId);
  if (!preferred) return tabs;
  return [preferred, ...tabs.filter((tab) => tab.id !== preferredTabId)];
}

async function broadcastStateUpdate(excludeTabId?: number) {
  const [memories, skills, activePreset, modelType, promptSettings] = await Promise.all([
    getAllMemories(),
    getAllSkills({ locale: currentBackgroundLocale }),
    getActivePreset(),
    getModelType(),
    getPromptInjectionSettings(),
  ]);
  await broadcastToTabs({ type: 'STATE_UPDATED', memories, skills, activePreset, modelType, promptSettings }, excludeTabId);
}

async function broadcastBackgroundUpdate(config: BackgroundConfig | null) {
  await broadcastToTabs({ type: 'BACKGROUND_UPDATED', config });
}

async function broadcastPetUpdate(config: PetConfig) {
  await broadcastToTabs({ type: 'PET_UPDATED', config });
}

async function broadcastThemeUpdate(theme: DeepSeekTheme, excludeTabId?: number) {
  await broadcastToTabs({ type: 'THEME_UPDATED', theme }, excludeTabId);
}

async function broadcastMcpServersUpdate(excludeTabId?: number) {
  const servers = await getAllMcpServers();
  await broadcastToTabs({ type: 'MCP_SERVERS_UPDATED', servers }, excludeTabId);
}

async function broadcastToolDescriptorsUpdate(excludeTabId?: number) {
  const toolDescriptors = await getRuntimeToolDescriptors(currentBackgroundLocale);
  await broadcastToTabs({ type: 'TOOL_DESCRIPTORS_UPDATED', toolDescriptors }, excludeTabId);
}

async function broadcastBrowserControlUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'BROWSER_CONTROL_UPDATED' }, excludeTabId);
}

async function broadcastToolCallHistoryUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'TOOL_CALL_HISTORY_UPDATED' }, excludeTabId);
}

async function broadcastProjectContextUpdate(excludeTabId?: number) {
  const state = await getProjectContextState();
  await broadcastToTabs({ type: 'PROJECT_CONTEXT_UPDATED', state }, excludeTabId);
}

async function getCurrentDeepSeekConversation(): Promise<
  { ok: true; conversation: CurrentDeepSeekConversation } | { ok: false; error: string }
> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find((item) => item.id != null && isDeepSeekChatUrl(item.url));
  if (!tab?.id) return { ok: false, error: 'no_active_deepseek_conversation' };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' });
    if (response?.ok && response.conversation) {
      return { ok: true, conversation: response.conversation as CurrentDeepSeekConversation };
    }
    return { ok: false, error: response?.error ?? 'no_current_conversation' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isDeepSeekChatUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'chat.deepseek.com' && /\/(?:a\/)?chat\/s\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function broadcastSavedItemsUpdate(excludeTabId?: number) {
  const savedItems = await getAllSavedItems();
  await broadcastToTabs({ type: 'SAVED_ITEMS_UPDATED', savedItems }, excludeTabId);
}

async function broadcastVoiceSettingsUpdate(excludeTabId?: number) {
  const voiceSettings = await getVoiceSettings();
  await broadcastToTabs({ type: 'VOICE_SETTINGS_UPDATED', voiceSettings }, excludeTabId);
}

async function broadcastAutomationUpdate(excludeTabId?: number) {
  const automations = await getAllAutomations();
  await broadcastToTabs({ type: 'AUTOMATIONS_UPDATED', automations }, excludeTabId);
}

async function broadcastAutomationRunsUpdate(excludeTabId?: number) {
  await broadcastToTabs({ type: 'AUTOMATION_RUNS_UPDATED' }, excludeTabId);
}

async function getChatAuthStatus(preferredTabId?: number) {
  const hasApiKey = await hasDeepSeekApiKey();
  if (hasApiKey) {
    return {
      ok: true,
      available: true,
      provider: 'official-api',
      hasApiKey: true,
      hasToken: false,
    };
  }

  const headers = await loadOrRefreshClientHeaders(preferredTabId);
  return {
    ok: true,
    available: !!headers,
    provider: headers ? 'deepseek-web' : null,
    hasApiKey: false,
    hasToken: !!headers,
  };
}

async function broadcastChatAuthStatus(preferredTabId?: number) {
  const status = await getChatAuthStatus(preferredTabId);
  chrome.runtime.sendMessage({ type: 'AUTH_STATUS_CHANGED', ...status }).catch(() => {});
}

async function broadcastConversationExportProgress(
  progress: ConversationExportProgress,
  excludeTabId?: number,
) {
  await broadcastToTabs({ type: 'DEEPSEEK_EXPORT_PROGRESS', progress }, excludeTabId);
}

async function executeBackgroundRuntimeToolCall(
  call: ToolCall,
  source: ToolExecutionTrigger,
  options?: RuntimeToolCallOptions,
): Promise<ToolResult> {
  return executeRuntimeToolCall(call, source, currentBackgroundLocale, options);
}

async function analyzeMultimodalMedia(
  request: MultimodalMediaAnalyzeRequest,
): Promise<MultimodalMediaAnalyzeResponse> {
  try {
    const prompt = typeof request.prompt === 'string' && request.prompt.trim()
      ? request.prompt.trim()
      : 'Analyze the attached media.';
    const media = normalizeMultimodalMediaInputs(request.media);
    const server = await getMultimodalMcpServerForAnalysis();
    const analyses: MultimodalMediaAnalysisItem[] = [];

    const images = media.filter((item) => item.kind === 'image');
    if (images.length > 0) {
      const result = await executeBackgroundRuntimeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_images', {
          prompt,
          images: images.map((item, index) => {
            if (!item.dataUrl) throw new Error(`${item.name} is missing image data.`);
            return {
              type: 'input_image',
              image_url: item.dataUrl,
              detail: 'auto',
              label: item.name || `image-${index + 1}`,
            };
          }),
          output_schema: 'general',
        }, request),
        'manual_chat',
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(
        `images:${images.map((item) => item.id).join(',')}`,
        'image',
        images,
        result,
      );
      if (!result.ok) {
        return {
          ok: false,
          analyses: [analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    for (const video of media.filter((item) => item.kind === 'video')) {
      if (!video.base64Data) throw new Error(`${video.name} is missing video data.`);
      const result = await executeBackgroundRuntimeToolCall(
        createMultimodalMcpToolCall(server, 'analyze_video', {
          prompt,
          video: {
            inlineData: {
              data: video.base64Data,
              mimeType: video.mimeType,
            },
            mimeType: video.mimeType,
          },
          output_schema: 'summary',
        }, request),
        'manual_chat',
        { timeoutMs: MULTIMODAL_MCP_REQUEST_TIMEOUT_MS },
      );
      const analysis = createMultimodalAnalysisItem(video.id, 'video', [video], result);
      if (!result.ok) {
        return {
          ok: false,
          analyses: [...analyses, analysis],
          error: result.detail || result.summary,
        };
      }
      analyses.push(analysis);
    }

    return { ok: true, analyses };
  } catch (error) {
    return {
      ok: false,
      analyses: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeMultimodalMediaInputs(value: unknown): MultimodalMediaInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('No multimodal media was provided.');
  }
  if (value.length > MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN) {
    throw new Error(`Attach at most ${MULTIMODAL_MEDIA_MAX_ITEMS_PER_TURN} media files per turn.`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`media[${index}] must be an object.`);
    const media = item as Partial<MultimodalMediaInput>;
    const normalized: MultimodalMediaInput = {
      id: nonEmptyString(media.id, `media[${index}].id`),
      kind: media.kind === 'image' || media.kind === 'video' ? media.kind : invalidMediaKind(index),
      name: nonEmptyString(media.name, `media[${index}].name`),
      mimeType: nonEmptyString(media.mimeType, `media[${index}].mimeType`),
      sizeBytes: finiteNonNegativeNumber(media.sizeBytes, `media[${index}].sizeBytes`),
      dataUrl: typeof media.dataUrl === 'string' && media.dataUrl ? media.dataUrl : undefined,
      base64Data: typeof media.base64Data === 'string' && media.base64Data ? media.base64Data : undefined,
    };
    assertSupportedMultimodalMedia(normalized);
    return normalized;
  });
}

async function getMultimodalMcpServerForAnalysis() {
  const servers = await getAllMcpServers({ includeSecrets: false });
  const server = servers.find(isMultimodalMcpServer);
  if (!server) {
    throw new Error('Multimodal MCP preset is missing. Create it on the MCP page first.');
  }
  if (!server.enabled) {
    throw new Error('Multimodal MCP server is disabled. Enable it on the MCP page first.');
  }
  if (!server.execution.enabled || server.execution.mode === 'disabled') {
    throw new Error('Multimodal MCP execution is disabled. Enable execution on the MCP page first.');
  }
  if (!isMultimodalAnalysisToolAllowed(server.allowlist)) {
    throw new Error('Multimodal MCP analysis tools are disabled. Enable analyze_images or analyze_video on the MCP page first.');
  }
  if (!canUseMultimodalMediaInput(server)) {
    throw new Error('Multimodal MCP is not available for media analysis.');
  }
  return server;
}

function createMultimodalMcpToolCall(
  server: Awaited<ReturnType<typeof getMultimodalMcpServerForAnalysis>>,
  name: 'analyze_images' | 'analyze_video',
  payload: Record<string, unknown>,
  request: MultimodalMediaAnalyzeRequest,
): ToolCall {
  return {
    name,
    payload,
    raw: '',
    provider: {
      kind: 'mcp',
      id: server.id,
      displayName: server.displayName,
      transport: server.transport.kind,
    },
    source: {
      trigger: 'manual_chat',
      chatSessionId: request.chatSessionId ?? null,
      parentMessageId: request.parentMessageId ?? null,
    },
  };
}

function createMultimodalAnalysisItem(
  id: string,
  kind: 'image' | 'video',
  media: readonly MultimodalMediaInput[],
  result: ToolResult,
): MultimodalMediaAnalysisItem {
  return {
    id,
    kind,
    media: media.map((item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
    })),
    result,
  };
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
  return value;
}

function invalidMediaKind(index: number): never {
  throw new Error(`media[${index}].kind must be image or video.`);
}

async function runBrowserSandboxToolResult(request: SandboxRunRequest): Promise<ToolResult> {
  const startedAt = Date.now();
  const result = await requestOffscreenSandboxRun(request);
  const completedAt = Date.now();
  const detail = result.ok
    ? result.result || result.stdout || ''
    : result.stderr || result.error || backgroundT('tool.sandbox.failed');

  return {
    ok: result.ok,
    summary: result.ok ? backgroundT('tool.sandbox.executed') : backgroundT('tool.sandbox.failed'),
    detail,
    output: sandboxExecutionResultToJson(result),
    error: result.ok ? undefined : {
      code: result.error || 'sandbox_execution_failed',
      message: detail,
      retryable: result.error === 'sandbox_timeout' || result.error === 'sandbox_frame_timeout',
    },
    startedAt,
    completedAt,
    durationMs: result.durationMs,
    truncated: result.truncated,
  };
}

async function requestOffscreenSandboxRun(request: SandboxRunRequest): Promise<SandboxExecutionResult> {
  if (!chrome.offscreen?.createDocument || !chrome.offscreen?.hasDocument) {
    return createSandboxFailure(
      backgroundT('tool.sandbox.offscreenUnavailableDetail'),
      'sandbox_offscreen_unavailable',
    );
  }

  try {
    await ensureSandboxOffscreenDocument();
  } catch (error) {
    return createSandboxFailure(
      error instanceof Error ? error.message : String(error),
      'sandbox_offscreen_create_failed',
    );
  }

  return sendSandboxRunToOffscreen(request);
}

async function ensureSandboxOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;

  if (!sandboxOffscreenCreation) {
    sandboxOffscreenCreation = chrome.offscreen.createDocument({
      url: SANDBOX_OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.IFRAME_SCRIPTING, chrome.offscreen.Reason.WORKERS],
      justification: 'Run DeepSeek-requested JavaScript, TypeScript, Python, and HTML in an isolated extension sandbox instead of the DeepSeek page.',
    }).finally(() => {
      sandboxOffscreenCreation = null;
    });
  }

  await sandboxOffscreenCreation;
}

function sendSandboxRunToOffscreen(request: SandboxRunRequest): Promise<SandboxExecutionResult> {
  const requestId = crypto.randomUUID();
  const timeoutMs = Math.max(2_000, request.timeoutMs + 2_000);

  return new Promise((resolve) => {
    let settled = false;
    const port = chrome.runtime.connect({ name: SANDBOX_OFFSCREEN_PORT });
    const settle = (result: SandboxExecutionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { port.disconnect(); } catch {}
      resolve(result);
    };
    const timeout = setTimeout(() => {
      settle(createSandboxFailure('Sandbox offscreen document timed out.', 'sandbox_offscreen_timeout', timeoutMs));
    }, timeoutMs);

    port.onMessage.addListener((message: unknown) => {
      const value = message && typeof message === 'object'
        ? message as { type?: unknown; requestId?: unknown; result?: unknown }
        : {};
      if (value.type !== 'OFFSCREEN_SANDBOX_RESULT' || value.requestId !== requestId) return;
      settle(normalizeSandboxExecutionResult(value.result));
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message;
      if (settled) return;
      settle(createSandboxFailure(lastError || 'Sandbox offscreen document disconnected.', 'sandbox_offscreen_disconnected'));
    });

    port.postMessage({
      type: 'OFFSCREEN_SANDBOX_RUN',
      requestId,
      payload: request,
    });
  });
}

function normalizeSandboxExecutionResult(value: unknown): SandboxExecutionResult {
  const result = value && typeof value === 'object' ? value as Partial<SandboxExecutionResult> : {};
  return {
    ok: result.ok === true,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    result: typeof result.result === 'string' ? result.result : undefined,
    html: typeof result.html === 'string' ? result.html : undefined,
    previewText: typeof result.previewText === 'string' ? result.previewText : undefined,
    durationMs: typeof result.durationMs === 'number' && Number.isFinite(result.durationMs) ? result.durationMs : 0,
    truncated: result.truncated === true,
    error: typeof result.error === 'string' ? result.error : undefined,
  };
}

function createSandboxFailure(message: string, code: string, durationMs = 0): SandboxExecutionResult {
  return {
    ok: false,
    stdout: '',
    stderr: message,
    durationMs,
    truncated: false,
    error: code,
  };
}

function sandboxExecutionResultToJson(result: SandboxExecutionResult): Record<string, string | number | boolean> {
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
    result: result.result ?? '',
    html: result.html ?? '',
    previewText: result.previewText ?? '',
    durationMs: result.durationMs,
    truncated: result.truncated,
    error: result.error ?? '',
  };
}

async function handleConversationExport(
  payload: unknown,
  excludeTabId?: number,
): Promise<ConversationExportResult | { ok: false; exportId?: string; error: string }> {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const exportId = typeof value.exportId === 'string' && value.exportId.trim()
    ? value.exportId.trim()
    : crypto.randomUUID();
  const request = normalizeConversationExportRequest(value.request);
  const headers = await loadOrRefreshClientHeaders(excludeTabId);
  if (!headers) {
    return {
      ok: false,
      exportId,
      error: backgroundT('background.auth.missingDeepSeek'),
    };
  }

  const controller = new AbortController();
  conversationExportControllers.set(exportId, controller);

  try {
    const baseUrl = new URL(DEEPSEEK_HOME_URL).origin;
    const exportData = await runConversationExport({
      exportId,
      request,
      baseUrl,
      extensionVersion: getExtensionVersion(),
      signal: controller.signal,
      transport: createDeepSeekConversationExportTransport({
        baseUrl,
        clientHeaders: headers,
        fetchImpl: fetch,
      }),
      onProgress: (progress) => broadcastConversationExportProgress(progress, excludeTabId),
    });

    await broadcastConversationExportProgress({
      exportId,
      phase: 'formatting',
      status: 'running',
      current: 0,
      total: request.formats.length,
      message: backgroundT('background.export.generating'),
    }, excludeTabId);

    assertConversationExportNotCancelled(controller.signal);
    const artifacts = await buildConversationExportArtifactsCancellable(exportData, controller.signal);
    assertConversationExportNotCancelled(controller.signal);
    return {
      ok: true,
      exportId,
      summary: exportData.stats,
      artifacts,
    };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    await broadcastConversationExportProgress({
      exportId,
      phase: aborted ? 'cancelled' : 'failed',
      status: aborted ? 'cancelled' : 'failed',
      current: 0,
      total: 0,
      message: aborted ? backgroundT('background.export.cancelled') : error instanceof Error ? error.message : String(error),
    }, excludeTabId);
    return {
      ok: false,
      exportId,
      error: aborted ? backgroundT('background.export.cancelled') : error instanceof Error ? error.message : String(error),
    };
  } finally {
    conversationExportControllers.delete(exportId);
  }
}

function assertConversationExportNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Conversation export was cancelled.', 'AbortError');
}

async function scanDueAutomationsFromWake() {
  const result = await scanDueAutomations(executeAutomationWithContext);
  if (result.initialized > 0 || result.started > 0 || result.failed > 0) {
    await broadcastAutomationUpdate();
  }
  if (result.started > 0 || result.failed > 0) {
    await broadcastAutomationRunsUpdate();
    await broadcastToolCallHistoryUpdate();
  }
  return result;
}

async function runAutomationNow(id: string, excludeTabId?: number) {
  const automation = await getAutomationById(id);
  if (!automation) return { ok: false, error: 'automation_not_found' };

  const run = await runAutomation({
    automationId: id,
    trigger: 'manual',
    scheduledFor: null,
    executor: executeAutomationWithContext,
  });

  await broadcastAutomationUpdate(excludeTabId);
  await broadcastAutomationRunsUpdate(excludeTabId);
  await broadcastToolCallHistoryUpdate(excludeTabId);

  return run ?? { ok: false, error: 'automation_already_running' };
}

async function executeAutomationWithContext(
  request: AutomationRunnerRequest,
): Promise<AutomationRunnerResult> {
  const [memories, activePreset, toolDescriptors] = await Promise.all([
    getAllMemories(),
    getActivePreset(),
    getRuntimeToolDescriptors(currentBackgroundLocale),
  ]);
  const enabledDescriptors = toolDescriptors.filter((descriptor) => descriptor.execution.enabled);
  const [project, projectPromptContext] = request.chatSessionId
    ? await Promise.all([
      getProjectForConversation(request.chatSessionId),
      getProjectPromptContextForConversation(request.chatSessionId),
    ])
    : [null, null];

  return runDeepSeekAutomation({
    ...request,
    locale: currentBackgroundLocale,
    promptContext: {
      memories: filterMemoriesByProjectScope(memories, project?.id ?? null),
      presetContent: activePreset?.content ?? null,
      projectContext: projectPromptContext ? formatProjectPromptContext(projectPromptContext) : null,
      toolDescriptors: enabledDescriptors,
    },
  }, {
    executeToolCall: (call) => executeBackgroundRuntimeToolCall(call, 'automation'),
  });
}

function validateAutomationInput(input: AutomationCreateInput) {
  if (!input || typeof input !== 'object') throw new Error('Invalid automation input');
  validateNonEmptyString(input.name, 'Automation name');
  validateNonEmptyString(input.prompt, 'Automation prompt');
  validateAutomationScheduleInput(input.schedule);
}

function validateAutomationPatch(patch: AutomationUpdateInput) {
  if (!patch || typeof patch !== 'object') throw new Error('Invalid automation patch');
  if (patch.name !== undefined) validateNonEmptyString(patch.name, 'Automation name');
  if (patch.prompt !== undefined) validateNonEmptyString(patch.prompt, 'Automation prompt');
  if (patch.status !== undefined && !isAutomationStatus(patch.status)) {
    throw new Error('Invalid automation status');
  }
  if (patch.schedule !== undefined) validateAutomationScheduleInput(patch.schedule);
}

function validateAutomationScheduleInput(schedule: AutomationCreateInput['schedule']) {
  if (!schedule || typeof schedule !== 'object') throw new Error('Invalid automation schedule');
  const result = validateAutomationSchedule(schedule);
  if (!result.ok) throw new Error(result.error.message);
}

function validateNonEmptyString(value: unknown, label: string) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function isAutomationStatus(status: unknown): status is AutomationStatus {
  return status === 'active' || status === 'paused' || status === 'archived';
}

async function getLocalSyncDataSnapshot(): Promise<SyncDataSnapshot> {
  const [memories, userSkills, skillSources, presets, projectContext, savedItems] = await Promise.all([
    getAllMemories(),
    getUserSkills(),
    getAllSkillSources(),
    getAllPresets(),
    getProjectContextState(),
    getSavedItemsState(),
  ]);

  return {
    memories: memories.map(({ id, ...memory }) => memory),
    skills: userSkills.filter(isSyncableSkill),
    skillSources: skillSources.filter(isSyncableSkillSource),
    presets,
    projectContext,
    savedItems,
  };
}

async function uploadSyncDataSnapshot(backend: StorageBackend, snapshot: SyncDataSnapshot): Promise<void> {
  await Promise.all([
    backend.put('memories.json', JSON.stringify(snapshot.memories)),
    backend.put('skills.json', JSON.stringify(snapshot.skills)),
    backend.put('skill-sources.json', JSON.stringify(snapshot.skillSources)),
    backend.put('presets.json', JSON.stringify(snapshot.presets)),
    snapshot.projectContext
      ? backend.put('project-context.json', JSON.stringify(snapshot.projectContext))
      : Promise.resolve(),
    snapshot.savedItems
      ? backend.put('saved-items.json', JSON.stringify(snapshot.savedItems))
      : Promise.resolve(),
  ]);
}

async function getRemoteSyncDataSnapshot(backend: StorageBackend): Promise<SyncDataSnapshot> {
  const [remoteMemJson, remoteSkillJson, remotePresetJson, remoteSkillSourceJson, remoteProjectContextJson, remoteSavedItemsJson] = await Promise.all([
    backendGetRequired(backend, 'memories.json'),
    backendGetRequired(backend, 'skills.json'),
    backendGetRequired(backend, 'presets.json'),
    backend.get('skill-sources.json'),
    backend.get('project-context.json'),
    backend.get('saved-items.json'),
  ]);

  const memories = parseValidatedArray('memories.json', remoteMemJson, (item, path) => {
    if (!item || typeof item !== 'object') throw new Error(`${path} must be an object`);
    const { id: _id, ...memory } = item as Memory;
    return validateStoredMemory(memory, path);
  });

  const skills = parseValidatedArray('skills.json', remoteSkillJson, validateSkill)
    .filter(isSyncableSkill);
  const skillSources = remoteSkillSourceJson === null
    ? []
    : parseValidatedArray('skill-sources.json', remoteSkillSourceJson, validateSkillImportSource)
      .filter(isSyncableSkillSource);

  return {
    memories,
    skills,
    skillSources,
    presets: parseValidatedArray('presets.json', remotePresetJson, validatePreset),
    projectContext: remoteProjectContextJson === null
      ? null
      : parseValidatedJson('project-context.json', remoteProjectContextJson, validateProjectContextState),
    savedItems: remoteSavedItemsJson === null
      ? null
      : parseValidatedJson('saved-items.json', remoteSavedItemsJson, validateSavedItemsState),
  };
}

function isSyncableSkill(skill: Skill): boolean {
  return !(skill.source === 'remote' && skill.remote?.provider === 'local');
}

function isSyncableSkillSource(source: SkillImportSource): boolean {
  return source.provider !== 'local';
}

async function mergeSyncSnapshotWithLocalImports(snapshot: SyncDataSnapshot): Promise<SyncDataSnapshot> {
  const [userSkills, skillSources] = await Promise.all([
    getUserSkills(),
    getAllSkillSources(),
  ]);
  const merged = mergeLocalSkillImportsIntoSyncSnapshot(
    {
      skills: snapshot.skills,
      skillSources: snapshot.skillSources,
    },
    {
      skills: userSkills,
      skillSources,
    },
  );
  return {
    ...snapshot,
    skills: merged.skills,
    skillSources: merged.skillSources,
  };
}

async function backendGetRequired(backend: StorageBackend, file: string): Promise<string> {
  const content = await backend.get(file);
  if (content === null) {
    throw new Error(backgroundT('background.sync.missingRemoteFile', { file }));
  }
  return content;
}

function getSyncCounts(snapshot: SyncDataSnapshot): SyncCounts {
  return {
    memories: snapshot.memories.length,
    skills: snapshot.skills.length,
    presets: snapshot.presets.length,
    projects: snapshot.projectContext?.projects.length ?? 0,
    projectConversations: snapshot.projectContext?.conversations.length ?? 0,
    savedItems: snapshot.savedItems?.items.length ?? 0,
  };
}

async function handleChatSubmitPrompt(
  prompt: string,
  configInput?: Partial<OfficialApiChatConfig>,
  excludeTabId?: number,
) {
  const apiKey = await getDeepSeekApiKey();
  const provider: ChatLoopProvider = apiKey ? 'official-api' : 'web';
  await markChatLoopStarted(provider);
  try {
    if (apiKey) {
      const config = configInput
        ? normalizeOfficialApiChatConfig(configInput)
        : await getOfficialApiChatConfig();
      await handleOfficialApiChatSubmitPrompt(prompt, apiKey, config, excludeTabId);
      return;
    }

    await handleWebChatSubmitPrompt(prompt, excludeTabId);
  } finally {
    await markChatLoopFinished();
  }
}

async function handleWebChatSubmitPrompt(prompt: string, excludeTabId?: number) {
  const headers = await loadOrRefreshClientHeaders(excludeTabId);
  if (!headers) {
    broadcastChatChunk({ text: '', done: true, error: backgroundT('background.auth.missingDeepSeek') }, excludeTabId);
    return;
  }

  try {
    if (!chatSessionId) {
      chatSessionId = await createChatSession(headers);
      chatParentMessageId = null;
    }

    const { augmented, enabledDescriptors } = await buildSidepanelPrompt(prompt);

    const initialInput = {
      chatSessionId,
      parentMessageId: chatParentMessageId,
      modelType: null,
      prompt: augmented,
      refFileIds: [],
      thinkingEnabled: false,
      searchEnabled: false,
      clientHeaders: headers,
    };

    await runSidepanelToolLoop(initialInput, enabledDescriptors, excludeTabId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcastChatChunk({ text: '', done: true, error: msg }, excludeTabId);
    if (msg.includes('auth') || msg.includes('token') || msg.includes('401')) {
      chatSessionId = null;
    }
  }
}

async function handleOfficialApiChatSubmitPrompt(
  prompt: string,
  apiKey: string,
  config: OfficialApiChatConfig,
  excludeTabId?: number,
) {
  try {
    const promptContext = await buildSidepanelPrompt(prompt);

    const initialMessages: OfficialDeepSeekMessage[] = [
      ...officialApiChatMessages,
      { role: 'user', content: promptContext.augmented },
    ];

    officialApiChatMessages = await runOfficialApiToolLoop(
      {
        apiKey,
        config,
        messages: initialMessages,
      },
      promptContext.enabledDescriptors,
      excludeTabId,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    broadcastChatChunk({ text: '', done: true, error: msg }, excludeTabId);
  }
}

async function buildSidepanelPrompt(prompt: string): Promise<{
  augmented: string;
  enabledDescriptors: ToolDescriptor[];
}> {
  const [memories, activePreset, toolDescriptors] = await Promise.all([
    getAllMemories(),
    getActivePreset(),
    getRuntimeToolDescriptors(currentBackgroundLocale),
  ]);
  const promptSettings = await getPromptInjectionSettings();
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(activePreset),
    isFirstMessage: chatSessionId === null && officialApiChatMessages.length === 0,
    messageCount: officialApiChatMessages.length + 1,
    cadence: promptSettings.presetCadence,
  });

  const enabledDescriptors = filterSidepanelChatToolDescriptors(toolDescriptors);
  const { augmented } = buildPromptAugmentation(prompt, {
    memories: memories.filter((memory) => memory.scope !== 'project'),
    presetContent: shouldInjectPreset ? activePreset?.content ?? null : null,
    toolDescriptors: enabledDescriptors,
    thinkingEnabled: false,
    locale: currentBackgroundLocale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage: promptSettings.forceResponseLanguage === 'auto' ? null : promptSettings.forceResponseLanguage,
  });

  return { augmented, enabledDescriptors };
}

async function runOfficialApiToolLoop(
  input: {
    apiKey: string;
    config: OfficialApiChatConfig;
    messages: OfficialDeepSeekMessage[];
  },
  toolDescriptors: ToolDescriptor[],
  excludeTabId?: number,
): Promise<OfficialDeepSeekMessage[]> {
  const MAX_STEPS = 20;
  let currentMessages = [...input.messages];

  for (let step = 0; step < MAX_STEPS; step++) {
    let accumulated = '';
    let reasoningAccumulated = '';
    const turn = await submitOfficialDeepSeekStreaming({
      apiKey: input.apiKey,
      config: input.config,
      messages: currentMessages,
    }, {
      onTextChunk(newText: string, fullText: string) {
        accumulated = fullText;
        broadcastChatChunk({ text: newText, done: false, phase: 'answer' }, excludeTabId);
      },
      onReasoningChunk(newText: string, fullText: string) {
        reasoningAccumulated = fullText;
        broadcastChatChunk({ text: '', reasoningText: newText, done: false, phase: 'reasoning' }, excludeTabId);
      },
    });

    const fullText = accumulated || turn.assistantText;

    if (!fullText) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return currentMessages;
    }

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        content: fullText,
        reasoningContent: reasoningAccumulated || turn.reasoningText || undefined,
      },
    ];
    const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });

    if (toolCalls.length === 0) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return currentMessages;
    }

    const execs: ToolExecutionRecord[] = [];
    for (const call of toolCalls) {
      const result = await executeBackgroundRuntimeToolCall(call, 'sidepanel_chat');
      execs.push({
        name: call.name,
        result: {
          ok: result.ok,
          summary: result.summary,
          detail: result.detail,
          output: result.output,
          truncated: result.truncated,
          error: result.error,
        },
      });
    }

    const toolResultsText = execs.map((e) =>
      `<${e.name}_result>\n${JSON.stringify(e.result)}\n</${e.name}_result>`
    ).join('\n');

    currentMessages = [
      ...currentMessages,
      {
        role: 'user',
        content: backgroundT('background.chat.continueWithToolResults', { toolResults: toolResultsText }),
      },
    ];
  }

  broadcastChatChunk({ text: backgroundT('background.chat.maxToolSteps'), done: true }, excludeTabId);
  return currentMessages;
}

async function runSidepanelToolLoop(
  input: {
    chatSessionId: string;
    parentMessageId: number | null;
    modelType: string | null;
    prompt: string;
    refFileIds: string[];
    thinkingEnabled: boolean;
    searchEnabled: boolean;
    clientHeaders: Record<string, string>;
  },
  toolDescriptors: ToolDescriptor[],
  excludeTabId?: number,
) {
  const MAX_STEPS = 20;
  const allExecutions: ToolExecutionRecord[] = [];
  let currentInput = input;

  for (let step = 0; step < MAX_STEPS; step++) {
    let accumulated = '';
    const turn = await submitPromptStreaming({
      ...currentInput,
      powHeaders: await createPowHeaders(currentInput.clientHeaders),
    }, {
      onTextChunk(newText: string, fullText: string) {
        accumulated = fullText;
        broadcastChatChunk({ text: newText, done: false }, excludeTabId);
      },
    });

    chatParentMessageId = turn.responseMessageId;
    const fullText = accumulated || turn.assistantText;

    if (!fullText) {
      broadcastChatChunk({ text: '', done: true }, excludeTabId);
      return;
    }

    const toolCalls = extractToolCalls(fullText, { descriptors: toolDescriptors });

    if (toolCalls.length === 0) {
      broadcastChatChunk({ text: fullText, done: true }, excludeTabId);
      return;
    }

    const execs: ToolExecutionRecord[] = [];
    for (const call of toolCalls) {
      const result = await executeBackgroundRuntimeToolCall(call, 'sidepanel_chat');
      execs.push({
        name: call.name,
        result: {
          ok: result.ok,
          summary: result.summary,
          detail: result.detail,
          output: result.output,
          truncated: result.truncated,
          error: result.error,
        },
      });
    }
    allExecutions.push(...execs);

    const toolResultsText = execs.map((e) =>
      `<${e.name}_result>\n${JSON.stringify(e.result)}\n</${e.name}_result>`
    ).join('\n');

    const continuationPrompt = backgroundT('background.chat.continueWithToolResults', {
      toolResults: toolResultsText,
    });

    currentInput = {
      ...currentInput,
      prompt: continuationPrompt,
      parentMessageId: chatParentMessageId,
    };
  }

  broadcastChatChunk({ text: backgroundT('background.chat.maxToolSteps'), done: true }, excludeTabId);
}

function broadcastChatChunk(
  chunk: {
    text: string;
    done: boolean;
    error?: string;
    reasoningText?: string;
    phase?: 'reasoning' | 'answer';
  },
  excludeTabId?: number,
) {
  chrome.runtime.sendMessage({ type: 'CHAT_STREAM_CHUNK', ...chunk }).catch(() => {});
}

// Called on every service-worker wake. If a chat tool loop was running when
// the previous SW instance was terminated, the sidepanel never received its
// final `done:true` chunk. Emit one so the UI unblocks, then reset in-memory
// chat state so the next turn starts clean.
async function reconcileInterruptedChatLoopOnWake() {
  const interrupted = await reconcileInterruptedChatLoop();
  if (!interrupted) return;
  chatSessionId = null;
  chatParentMessageId = null;
  officialApiChatMessages = [];
  broadcastChatChunk({ text: '', done: true, error: backgroundT('background.chat.interrupted') });
}
