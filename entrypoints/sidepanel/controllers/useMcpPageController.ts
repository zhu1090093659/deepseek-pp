import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocaleMessageKey, MessageParams } from '../../../core/i18n';
import type { McpOAuthStatus } from '../../../core/mcp/oauth-client';
import type {
  McpCapabilityExposureMode,
  McpCapabilitySettings,
  McpCapabilitySettingsPatch,
  McpServerConfig,
  McpServerCreateInput,
  McpToolCacheEntry,
  PlatformEnvironment,
  ToolCallHistoryRecord,
  ToolDescriptor,
} from '../../../core/types';
import { createRequestGenerationFence } from '../async-state';
import { getRuntimeErrorMessage } from '../runtime-response';
import {
  McpPermissionError,
  countEnabledMcpTools,
  findMcpPreset,
  getMcpPresetInput,
  isMcpNativeMessagingSupported,
  isMcpToolSelected,
  mcpToolsController,
  nextMcpToolAllowlist,
  type McpConnectionAction,
  type McpPresetKind,
} from './mcp-tools-controller';

type Translator = (key: LocaleMessageKey, params?: MessageParams) => string;
type BusyAction = 'refresh' | 'test' | 'permission' | 'oauth';
type Banner = { tone: 'success' | 'error' | 'info'; text: string };
function isOAuthHttpServer(server: McpServerConfig): boolean {
  const kind = server.transport.kind;
  const httpBased = kind === 'http' || kind === 'sse' || kind === 'streamable_http';
  return httpBased && server.oauth?.enabled === true;
}

type Confirm = (options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
}) => Promise<boolean>;

export function useMcpPageController(t: Translator, confirm: Confirm) {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [caches, setCaches] = useState<Record<string, McpToolCacheEntry | null>>({});
  const [history, setHistory] = useState<ToolCallHistoryRecord[]>([]);
  const [capabilitySettings, setCapabilitySettings] = useState<McpCapabilitySettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [busy, setBusy] = useState<Record<string, BusyAction | null>>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [platform, setPlatform] = useState<PlatformEnvironment | null>(null);
  const [oauthStatus, setOauthStatus] = useState<Record<string, McpOAuthStatus | null>>({});
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionInitialized = useRef(false);
  const requestFence = useRef(createRequestGenerationFence());

  const clearBanner = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    setBanner(null);
  }, []);

  const showBanner = useCallback((tone: Banner['tone'], text: string) => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setBanner({ tone, text });
    dismissTimer.current = tone === 'success'
      ? setTimeout(() => setBanner(null), 4000)
      : null;
  }, []);

  const load = useCallback(async () => {
    const generation = requestFence.current.begin();
    setLoading(true);
    try {
      const snapshot = await mcpToolsController.loadMcpSnapshot();
      if (!requestFence.current.isCurrent(generation)) return;
      setPlatform(snapshot.platform);
      setServers(snapshot.servers);
      setCaches(snapshot.caches);
      setHistory(snapshot.history);
      setCapabilitySettings(snapshot.capabilitySettings);
      const oauthEntries = await Promise.all(snapshot.servers
        .filter((server) => server.oauth?.enabled)
        .map(async (server) => (
          [server.id, await mcpToolsController.getMcpOAuthStatus(server.id)] as const
        )));
      if (!requestFence.current.isCurrent(generation)) return;
      setOauthStatus(Object.fromEntries(oauthEntries));
      const shouldSelectInitialServer = !selectionInitialized.current
        && snapshot.servers.length > 0;
      if (shouldSelectInitialServer) selectionInitialized.current = true;
      setSelectedId((current) => {
        if (current && snapshot.servers.some((server) => server.id === current)) return current;
        return shouldSelectInitialServer ? snapshot.servers[0]?.id ?? null : null;
      });
    } catch (error) {
      if (requestFence.current.isCurrent(generation)) {
        showBanner('error', getRuntimeErrorMessage(error) || t('sidepanel.mcpPage.messages.loadFailed'));
      }
    } finally {
      if (requestFence.current.isCurrent(generation)) setLoading(false);
    }
  }, [showBanner, t]);

  useEffect(() => {
    void load();
    const reloadForRuntimeUpdate = (message: { type?: string }) => {
      if (
        message.type === 'MCP_SERVERS_UPDATED'
        || message.type === 'TOOL_DESCRIPTORS_UPDATED'
        || message.type === 'TOOL_CALL_HISTORY_UPDATED'
      ) {
        void load();
      }
    };
    const reloadWhenVisible = () => {
      if (!document.hidden) void load();
    };
    chrome.runtime.onMessage.addListener(reloadForRuntimeUpdate);
    document.addEventListener('visibilitychange', reloadWhenVisible);
    window.addEventListener('focus', reloadWhenVisible);
    return () => {
      requestFence.current.invalidate();
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      chrome.runtime.onMessage.removeListener(reloadForRuntimeUpdate);
      document.removeEventListener('visibilitychange', reloadWhenVisible);
      window.removeEventListener('focus', reloadWhenVisible);
    };
  }, [load]);

  const startCreate = useCallback(() => {
    setEditing(null);
    clearBanner();
    setShowForm((visible) => !visible);
  }, [clearBanner]);

  const startEdit = useCallback((server: McpServerConfig) => {
    setEditing(server);
    clearBanner();
    setShowForm(true);
  }, [clearBanner]);

  const cancelForm = useCallback(() => {
    setShowForm(false);
    setEditing(null);
    clearBanner();
  }, [clearBanner]);

  const createPreset = useCallback(async (kind: McpPresetKind) => {
    clearBanner();
    if (!isMcpNativeMessagingSupported(platform)) {
      showBanner('error', t('sidepanel.mcpPage.messages.nativeMessagingUnsupported'));
      return;
    }
    const existing = findMcpPreset(servers, kind);
    if (existing) {
      setSelectedId(existing.id);
      showBanner('info', t(kind === 'shell'
        ? 'sidepanel.mcpPage.messages.shellExistsSelected'
        : 'sidepanel.mcpPage.messages.multimodalExistsSelected'));
      return;
    }
    try {
      const server = await mcpToolsController.createServer(await getMcpPresetInput(kind));
      setSelectedId(server.id);
      showBanner('success', t(kind === 'shell'
        ? 'sidepanel.mcpPage.messages.shellCreated'
        : 'sidepanel.mcpPage.messages.multimodalCreated'));
      await load();
    } catch {
      showBanner('error', t(kind === 'shell'
        ? 'sidepanel.mcpPage.messages.shellCreateFailed'
        : 'sidepanel.mcpPage.messages.multimodalCreateFailed'));
    }
  }, [clearBanner, load, platform, servers, showBanner, t]);

  const saveServer = useCallback(async (payload: McpServerCreateInput) => {
    const editingServer = editing
      ? servers.find((server) => server.id === editing.id) ?? editing
      : null;
    const requestPayload = editingServer
      ? { ...payload, allowlist: editingServer.allowlist }
      : payload;
    try {
      let saved: McpServerConfig | null;
      if (editingServer) {
        saved = await mcpToolsController.updateServer(editingServer, requestPayload);
        if (!saved) throw new Error('MCP server no longer exists.');
      } else {
        saved = await mcpToolsController.createServer(requestPayload);
      }
      setShowForm(false);
      setEditing(null);
      clearBanner();
      await load();
      // When a server enables OAuth, run the interactive authorization flow
      // immediately after saving so the user does not have to click Authorize
      // separately. A failure here is surfaced as a banner but does not undo
      // the save.
      if (saved && isOAuthHttpServer(saved)) {
        setSelectedId(saved.id);
        setBusy((current) => ({ ...current, [saved.id]: 'oauth' }));
        try {
          const result = await mcpToolsController.authorizeMcpOAuth(saved.id);
          if (result.ok) {
            setOauthStatus((current) => ({ ...current, [saved.id]: result.status }));
            showBanner('success', t('sidepanel.mcpPage.oauth.authorizeSuccess'));
            await load();
          } else {
            showBanner('error', t('sidepanel.mcpPage.oauth.authorizeFailed', {
              error: result.error,
            }));
          }
        } catch (error) {
          showBanner('error', t('sidepanel.mcpPage.oauth.authorizeFailed', {
            error: getRuntimeErrorMessage(error),
          }));
        } finally {
          setBusy((current) => ({ ...current, [saved.id]: null }));
        }
      }
    } catch {
      showBanner('error', t('sidepanel.mcpPage.messages.saveFailed'));
    }
  }, [clearBanner, editing, load, servers, setOauthStatus, showBanner, t]);

  const removeServer = useCallback(async (server: McpServerConfig) => {
    const approved = await confirm({
      title: t('sidepanel.mcpPage.messages.deleteConfirm', { name: server.displayName }),
      message: t('sidepanel.mcpPage.messages.deleteConfirm', { name: server.displayName }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!approved) return;
    try {
      await mcpToolsController.deleteServer(server.id);
      setSelectedId((current) => current === server.id ? null : current);
      await load();
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    }
  }, [confirm, load, showBanner, t]);

  const patchServer = useCallback(async (
    server: McpServerConfig,
    patch: Partial<McpServerConfig>,
  ) => {
    try {
      const saved = await mcpToolsController.updateServer(server, patch);
      if (!saved) throw new Error('MCP server no longer exists.');
      await load();
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    }
  }, [load, showBanner]);

  const setBusyState = useCallback((serverId: string, action: BusyAction | null) => {
    setBusy((current) => ({ ...current, [serverId]: action }));
  }, []);

  const requestPermission = useCallback(async (server: McpServerConfig) => {
    setBusyState(server.id, 'permission');
    clearBanner();
    try {
      const result = await mcpToolsController.requestServerPermission(server);
      if (result.ok) {
        showBanner('success', t('sidepanel.mcpPage.messages.permissionGranted', {
          origin: result.origin ?? t('sidepanel.mcpPage.localHost'),
        }));
      } else {
        showBanner('error', result.error ?? t('sidepanel.mcpPage.messages.permissionDenied'));
      }
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    } finally {
      setBusyState(server.id, null);
    }
  }, [clearBanner, setBusyState, showBanner, t]);

  const connectServer = useCallback(async (
    server: McpServerConfig,
    action: McpConnectionAction,
  ) => {
    setBusyState(server.id, action);
    clearBanner();
    try {
      const cache = await mcpToolsController.connectServer(server, action);
      setCaches((current) => ({ ...current, [server.id]: cache }));
      if (cache.health.status === 'ready') {
        showBanner('success', t('sidepanel.mcpPage.messages.connectionSuccess', {
          tools: cache.health.toolCount,
          latency: formatMilliseconds(cache.health.latencyMs),
        }));
      } else {
        showBanner('error', cache.health.error ?? t('sidepanel.mcpPage.messages.connectionFailed'));
      }
      await load();
    } catch (error) {
      if (error instanceof McpPermissionError) {
        showBanner('error', error.message !== 'MCP origin permission was denied.'
          ? error.message
          : t('sidepanel.mcpPage.messages.permissionRequired', {
            origin: error.origin ?? 'MCP Host',
          }));
      } else {
        showBanner('error', getRuntimeErrorMessage(error));
      }
    } finally {
      setBusyState(server.id, null);
    }
  }, [clearBanner, load, setBusyState, showBanner, t]);

  const authorizeOAuth = useCallback(async (server: McpServerConfig) => {
    setBusyState(server.id, 'oauth');
    clearBanner();
    try {
      const result = await mcpToolsController.authorizeMcpOAuth(server.id);
      if (result.ok) {
        setOauthStatus((current) => ({ ...current, [server.id]: result.status }));
        showBanner('success', t('sidepanel.mcpPage.oauth.authorizeSuccess'));
        await load();
      } else {
        showBanner('error', t('sidepanel.mcpPage.oauth.authorizeFailed', { error: result.error }));
      }
    } catch (error) {
      showBanner('error', t('sidepanel.mcpPage.oauth.authorizeFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    } finally {
      setBusyState(server.id, null);
    }
  }, [clearBanner, load, setBusyState, showBanner, t]);

  const disconnectOAuth = useCallback(async (server: McpServerConfig) => {
    setBusyState(server.id, 'oauth');
    clearBanner();
    try {
      await mcpToolsController.disconnectMcpOAuth(server.id);
      setOauthStatus((current) => ({ ...current, [server.id]: null }));
      showBanner('success', t('sidepanel.mcpPage.oauth.disconnectSuccess'));
      await load();
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    } finally {
      setBusyState(server.id, null);
    }
  }, [clearBanner, load, setBusyState, showBanner, t]);

  const toggleTool = useCallback(async (server: McpServerConfig, tool: ToolDescriptor) => {
    const selected = isMcpToolSelected(server, tool);
    await patchServer(server, {
      allowlist: nextMcpToolAllowlist(server.allowlist, tool, !selected),
    });
  }, [patchServer]);

  const setServerExposure = useCallback(async (
    server: McpServerConfig,
    mode: McpCapabilityExposureMode,
    pinnedDescriptorIds?: readonly string[],
  ) => {
    try {
      const settings = await mcpToolsController.setServerExposure({
        serverId: server.id,
        mode,
        pinnedDescriptorIds,
      });
      setCapabilitySettings(settings);
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    }
  }, [showBanner]);

  const updateCapabilitySettings = useCallback(async (patch: McpCapabilitySettingsPatch) => {
    try {
      const settings = await mcpToolsController.updateCapabilitySettings(patch);
      setCapabilitySettings(settings);
    } catch (error) {
      showBanner('error', getRuntimeErrorMessage(error));
    }
  }, [showBanner]);

  const togglePinnedTool = useCallback(async (server: McpServerConfig, tool: ToolDescriptor) => {
    const configured = capabilitySettings?.servers[server.id];
    const pinned = new Set(configured?.pinnedDescriptorIds ?? []);
    if (pinned.has(tool.id)) pinned.delete(tool.id);
    else pinned.add(tool.id);
    await setServerExposure(server, configured?.mode ?? 'direct', [...pinned]);
  }, [capabilitySettings, setServerExposure]);

  const selected = selectedId
    ? servers.find((server) => server.id === selectedId) ?? null
    : null;
  const enabledCount = servers.filter((server) => server.enabled).length;
  const toolCount = useMemo(() => servers.reduce(
    (sum, server) => sum + countEnabledMcpTools(server, caches[server.id]?.descriptors ?? []),
    0,
  ), [caches, servers]);

  return {
    servers,
    caches,
    mcpHistory: history.filter((record) => record.call.provider?.kind === 'mcp'),
    capabilitySettings,
    selected,
    selectedId,
    setSelectedId,
    loading,
    showForm,
    editing,
    busy,
    banner,
    platform,
    enabledCount,
    toolCount,
    nativeMessagingSupported: isMcpNativeMessagingSupported(platform),
    clearBanner,
    startCreate,
    startEdit,
    cancelForm,
    createShellPreset: () => createPreset('shell'),
    createMultimodalPreset: () => createPreset('multimodal'),
    saveServer,
    removeServer,
    patchServer,
    requestPermission,
    refreshServer: connectServer,
    oauthStatus,
    authorizeOAuth,
    disconnectOAuth,
    toggleTool,
    updateCapabilitySettings,
    setServerExposure,
    togglePinnedTool,
  };
}

function formatMilliseconds(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : '—';
}
