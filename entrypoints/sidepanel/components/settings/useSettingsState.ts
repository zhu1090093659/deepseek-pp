import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BACKGROUND_OPACITY,
  clampBackgroundOpacity,
  normalizeBackgroundConfig,
} from '../../../../core/background/config';
import { getChatEnabled, setChatEnabled } from '../../../../core/chat/store';
import { getFloatingChatEnabled, setFloatingChatEnabled } from '../../../../core/floating-chat/store';
import {
  DEFAULT_PET_CONFIG,
  clampPetOpacity,
  clampPetSize,
  normalizePetConfig,
} from '../../../../core/pet/config';
import type {
  BackgroundConfig,
  GDriveSyncConfig,
  Memory,
  ModelType,
  MultimodalSettingsStatus,
  OneDriveSyncConfig,
  PetConfig,
  PetPosition,
  SyncConfig,
  SyncCounts,
  SyncProvider,
  WebdavSyncConfig,
} from '../../../../core/types';
import { validateImportedMemory } from '../../../../core/sync/schema';
import { getOptionalRedirectUri } from '../../../../core/sync/oauth-client';
import { createBootstrapRuntimeClient } from '../../../../core/messaging/bootstrap-client';

/**
 * Central settings state + handlers.
 *
 * Previously SettingsPage.tsx held ~30 useState hooks and every handler inline.
 * Lifting them here lets each sub-page (General / API / Appearance / Data ...)
 * consume only the slice it needs, while keeping the chrome.runtime message
 * contract byte-for-byte identical to the legacy implementation.
 */

const DEFAULT_WEBDAV_CONFIG: WebdavSyncConfig = {
  provider: 'webdav',
  url: '',
  username: '',
  password: '',
  remotePath: 'DeepSeekPP',
  lastSyncAt: null,
};

const DEFAULT_GDRIVE_CONFIG: GDriveSyncConfig = {
  provider: 'gdrive',
  clientId: '',
  clientSecret: '',
  refreshToken: undefined,
  lastSyncAt: null,
};

const DEFAULT_ONEDRIVE_CONFIG: OneDriveSyncConfig = {
  provider: 'onedrive',
  clientId: '',
  clientSecret: '',
  refreshToken: undefined,
  lastSyncAt: null,
};

const bootstrapRuntimeClient = createBootstrapRuntimeClient(
  (message) => chrome.runtime.sendMessage(message),
);

function defaultConfigForProvider(provider: SyncProvider): SyncConfig {
  if (provider === 'gdrive') return { ...DEFAULT_GDRIVE_CONFIG };
  if (provider === 'onedrive') return { ...DEFAULT_ONEDRIVE_CONFIG };
  return { ...DEFAULT_WEBDAV_CONFIG };
}

// Legacy configs saved before multi-provider support had no `provider` field.
// Treat them as WebDAV so existing users keep working until they reconfigure.
function normalizeLoadedConfig(raw: unknown): SyncConfig {
  if (raw && typeof raw === 'object' && (raw as { provider?: string }).provider) {
    return raw as SyncConfig;
  }
  // Pre-multi-provider WebDAV shape — backfill provider. If the user has not
  // configured anything yet, raw may be a bare object without sync fields;
  // fall through to the default WebDAV config in that case.
  const legacy = raw as Partial<WebdavSyncConfig> | null;
  if (legacy && (legacy.url || legacy.username || legacy.password || legacy.remotePath)) {
    return {
      provider: 'webdav',
      url: legacy.url ?? '',
      username: legacy.username ?? '',
      password: legacy.password ?? '',
      remotePath: legacy.remotePath ?? 'DeepSeekPP',
      lastSyncAt: legacy.lastSyncAt ?? null,
    };
  }
  return { ...DEFAULT_WEBDAV_CONFIG };
}

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  enabled: false,
  type: 'upload',
  url: '',
  imageData: '',
  opacity: DEFAULT_BACKGROUND_OPACITY,
};

export type ApiKeyStatus = 'idle' | 'saving' | 'clearing' | 'success' | 'error';
export type MultimodalStatus = 'idle' | 'saving' | 'clearing' | 'success' | 'error';
export type SyncStatus = 'idle' | 'testing' | 'uploading' | 'downloading' | 'success' | 'error';

const DEFAULT_MULTIMODAL: MultimodalSettingsStatus = {
  openaiConfigured: false,
  geminiConfigured: false,
  openaiImageModel: 'gpt-4.1-mini',
  geminiVideoModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
};

export function useSettingsState() {
  // --- shared / general ---
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');
  const [modelType, setModelTypeState] = useState<ModelType>(null);
  const [chatEnabled, setChatEnabledState] = useState(false);
  // null = not yet loaded; the settings page only renders this sub-page after
  // loading completes, so the toggle never shows a stale default.
  const [floatingChatEnabled, setFloatingChatEnabledState] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // --- deepseek api key ---
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('idle');
  const [apiKeyMessage, setApiKeyMessage] = useState('');

  // --- multimodal ---
  const [multimodalConfigured, setMultimodalConfigured] = useState<MultimodalSettingsStatus>(DEFAULT_MULTIMODAL);
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState('');
  const [openaiImageModel, setOpenaiImageModel] = useState('gpt-4.1-mini');
  const [geminiVideoModel, setGeminiVideoModel] = useState('gemini-2.5-flash');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('https://api.openai.com/v1');
  const [geminiBaseUrl, setGeminiBaseUrl] = useState('https://generativelanguage.googleapis.com');
  const [multimodalStatus, setMultimodalStatus] = useState<MultimodalStatus>('idle');
  const [multimodalMessage, setMultimodalMessage] = useState('');

  // --- background ---
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgType, setBgType] = useState<'upload' | 'url'>('upload');
  const [bgUrl, setBgUrl] = useState('');
  const [bgImageData, setBgImageData] = useState('');
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BACKGROUND_OPACITY);

  // --- pet ---
  const [petEnabled, setPetEnabled] = useState(DEFAULT_PET_CONFIG.enabled);
  const [petPosition, setPetPosition] = useState<PetPosition>(DEFAULT_PET_CONFIG.position);
  const [petSize, setPetSize] = useState(DEFAULT_PET_CONFIG.size);
  const [petOpacity, setPetOpacity] = useState(DEFAULT_PET_CONFIG.opacity);
  const [petMotion, setPetMotion] = useState(DEFAULT_PET_CONFIG.motion);

  // --- sync ---
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_WEBDAV_CONFIG);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncMessage, setSyncMessage] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgConfigRef = useRef<BackgroundConfig>(DEFAULT_BACKGROUND_CONFIG);
  const petConfigRef = useRef<PetConfig>(DEFAULT_PET_CONFIG);

  const bgPreview = bgType === 'url' ? bgUrl : bgImageData;
  const syncBusy = syncStatus === 'testing' || syncStatus === 'uploading' || syncStatus === 'downloading';

  const syncBgState = useCallback((config: BackgroundConfig) => {
    bgConfigRef.current = config;
    setBgEnabled(config.enabled);
    setBgType(config.type);
    setBgUrl(config.url ?? '');
    setBgImageData(config.imageData ?? '');
    setBgOpacity(config.opacity);
  }, []);

  const syncPetState = useCallback((config: PetConfig) => {
    petConfigRef.current = config;
    setPetEnabled(config.enabled);
    setPetPosition(config.position);
    setPetSize(config.size);
    setPetOpacity(config.opacity);
    setPetMotion(config.motion);
  }, []);

  const syncMultimodalStatus = useCallback((status: MultimodalSettingsStatus) => {
    setMultimodalConfigured(status);
    setOpenaiImageModel(status.openaiImageModel);
    setGeminiVideoModel(status.geminiVideoModel);
    setOpenaiBaseUrl(status.openaiBaseUrl);
    setGeminiBaseUrl(status.geminiBaseUrl);
  }, []);

  // --- initial load ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [chatOn, floatingOn, keyStatus, mmStatus, memories, cfg, syncCfg, modelType, bgCfg, petCfg] = await Promise.all([
        getChatEnabled().catch((error) => {
          console.error('DeepSeek++ failed to read sidepanel chat setting', error);
          return false;
        }),
        getFloatingChatEnabled().catch((error) => {
          console.error('DeepSeek++ failed to read floating-chat setting', error);
          return true;
        }),
        chrome.runtime.sendMessage({ type: 'GET_DEEPSEEK_API_KEY_STATUS' }).catch(() => undefined),
        chrome.runtime.sendMessage({ type: 'GET_MULTIMODAL_SETTINGS_STATUS' }).catch(() => undefined),
        chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }).catch(() => [] as Memory[]),
        bootstrapRuntimeClient.getConfig().catch(() => undefined),
        chrome.runtime.sendMessage({ type: 'GET_SYNC_CONFIG' }).catch(() => null),
        chrome.runtime.sendMessage({ type: 'GET_MODEL_TYPE' }).catch(() => null),
        chrome.runtime.sendMessage({ type: 'GET_BACKGROUND' }).catch(() => null),
        chrome.runtime.sendMessage({ type: 'GET_PET' }).catch(() => null),
      ]);
      if (cancelled) return;
      setChatEnabledState(chatOn);
      setFloatingChatEnabledState(floatingOn);
      setApiKeyConfigured((keyStatus as { configured?: boolean } | undefined)?.configured === true);
      const mm = mmStatus as ({ ok?: boolean } & MultimodalSettingsStatus) | undefined;
      if (mm?.ok) syncMultimodalStatus(mm);
      setMemoryCount((memories as Memory[])?.length ?? 0);
      setVersion(cfg && 'version' in cfg ? cfg.version : '');
      if (syncCfg) setSyncConfig(normalizeLoadedConfig(syncCfg));
      setModelTypeState(modelType === 'expert' || modelType === 'vision' ? modelType : null);
      const normalizedBg = normalizeBackgroundConfig(bgCfg as BackgroundConfig | null);
      if (normalizedBg) syncBgState(normalizedBg);
      syncPetState(normalizePetConfig(petCfg as PetConfig | null));
      setLoading(false);
    })();

    const handlePetUpdate = (message: { type?: string; config?: PetConfig | null }) => {
      if (message.type === 'PET_UPDATED') {
        syncPetState(normalizePetConfig(message.config));
      }
    };
    chrome.runtime.onMessage.addListener(handlePetUpdate);
    return () => {
      cancelled = true;
      chrome.runtime.onMessage.removeListener(handlePetUpdate);
    };
  }, [syncBgState, syncPetState, syncMultimodalStatus]);

  // --- webpage model mode ---
  const handleModelTypeChange = useCallback(async (nextModelType: ModelType) => {
    setModelTypeState(nextModelType);
    await chrome.runtime.sendMessage({
      type: 'SET_MODEL_TYPE',
      payload: nextModelType,
    });
  }, []);

  // --- sidepanel chat ---
  const handleChatToggle = useCallback(async (next: boolean) => {
    setChatEnabledState(next);
    await setChatEnabled(next);
  }, []);

  // --- global floating chat ---
  const handleFloatingChatToggle = useCallback(async (next: boolean) => {
    setFloatingChatEnabledState(next);
    await setFloatingChatEnabled(next);
  }, []);

  // --- deepseek api key ---
  const handleSaveApiKey = useCallback(
    async (labels: {
      apiKeyRequired: string;
      saveFailed: string;
      apiKeySaved: string;
    }) => {
      const apiKey = apiKeyInput.trim();
      if (!apiKey) {
        setApiKeyStatus('error');
        setApiKeyMessage(labels.apiKeyRequired);
        return;
      }
      setApiKeyStatus('saving');
      setApiKeyMessage('');
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_DEEPSEEK_API_KEY',
          payload: { apiKey },
        });
        if (!result?.ok) throw new Error(result?.error || labels.saveFailed);
        if (!chatEnabled) {
          await setChatEnabled(true);
          setChatEnabledState(true);
        }
        setApiKeyConfigured(true);
        setApiKeyInput('');
        setApiKeyStatus('success');
        setApiKeyMessage(labels.apiKeySaved);
      } catch (error) {
        setApiKeyStatus('error');
        setApiKeyMessage(error instanceof Error ? error.message : labels.saveFailed);
      }
    },
    [apiKeyInput, chatEnabled],
  );

  const handleClearApiKey = useCallback(
    async (clearFailed: string, apiKeyCleared: string) => {
      setApiKeyStatus('clearing');
      setApiKeyMessage('');
      try {
        const result = await chrome.runtime.sendMessage({ type: 'CLEAR_DEEPSEEK_API_KEY' });
        if (!result?.ok) throw new Error(result?.error || clearFailed);
        setApiKeyConfigured(false);
        setApiKeyInput('');
        setApiKeyStatus('success');
        setApiKeyMessage(apiKeyCleared);
      } catch (error) {
        setApiKeyStatus('error');
        setApiKeyMessage(error instanceof Error ? error.message : clearFailed);
      }
    },
    [],
  );

  // --- multimodal ---
  const isHttpBaseUrl = useCallback((value: string) => {
    try {
      const url = new URL(value.trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, []);

  const handleSaveMultimodal = useCallback(
    async (labels: { baseUrlInvalid: string; saveFailed: string; saved: string }) => {
      setMultimodalStatus('saving');
      setMultimodalMessage('');
      try {
        if (!isHttpBaseUrl(openaiBaseUrl) || !isHttpBaseUrl(geminiBaseUrl)) {
          throw new Error(labels.baseUrlInvalid);
        }
        const payload: Record<string, string> = {
          openaiImageModel,
          geminiVideoModel,
          openaiBaseUrl,
          geminiBaseUrl,
        };
        if (openaiApiKeyInput.trim()) payload.openaiApiKey = openaiApiKeyInput.trim();
        if (geminiApiKeyInput.trim()) payload.geminiApiKey = geminiApiKeyInput.trim();
        const result = await chrome.runtime.sendMessage({
          type: 'SAVE_MULTIMODAL_SETTINGS',
          payload,
        });
        if (!result?.ok) throw new Error(result?.error || labels.saveFailed);
        syncMultimodalStatus(result as MultimodalSettingsStatus);
        setOpenaiApiKeyInput('');
        setGeminiApiKeyInput('');
        setMultimodalStatus('success');
        setMultimodalMessage(labels.saved);
      } catch (error) {
        setMultimodalStatus('error');
        setMultimodalMessage(error instanceof Error ? error.message : labels.saveFailed);
      }
    },
    [openaiBaseUrl, geminiBaseUrl, openaiImageModel, geminiVideoModel, openaiApiKeyInput, geminiApiKeyInput, isHttpBaseUrl, syncMultimodalStatus],
  );

  const handleClearMultimodal = useCallback(
    async (labels: { clearFailed: string; cleared: string }) => {
      setMultimodalStatus('clearing');
      setMultimodalMessage('');
      try {
        const result = await chrome.runtime.sendMessage({ type: 'CLEAR_MULTIMODAL_SETTINGS' });
        if (!result?.ok) throw new Error(result?.error || labels.clearFailed);
        syncMultimodalStatus(result as MultimodalSettingsStatus);
        setOpenaiApiKeyInput('');
        setGeminiApiKeyInput('');
        setMultimodalStatus('success');
        setMultimodalMessage(labels.cleared);
      } catch (error) {
        setMultimodalStatus('error');
        setMultimodalMessage(error instanceof Error ? error.message : labels.clearFailed);
      }
    },
    [syncMultimodalStatus],
  );

  // --- background ---
  const saveBgConfig = useCallback(async (patch: Partial<BackgroundConfig>) => {
    const config = normalizeBackgroundConfig({
      ...bgConfigRef.current,
      ...patch,
    });
    if (!config) return;
    bgConfigRef.current = config;
    await chrome.runtime.sendMessage({ type: 'SAVE_BACKGROUND', payload: config });
  }, []);

  const handleBgToggle = useCallback(
    async (enabled: boolean) => {
      setBgEnabled(enabled);
      await saveBgConfig({ enabled });
    },
    [saveBgConfig],
  );

  const resizeImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const MAX = 1920;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const scale = Math.min(MAX / width, MAX / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };
      img.src = objectUrl;
    });
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let data: string;
      try {
        data = await resizeImage(file);
      } catch {
        return;
      }
      setBgType('upload');
      setBgImageData(data);
      setBgEnabled(true);
      bgConfigRef.current = {
        ...bgConfigRef.current,
        enabled: true,
        type: 'upload',
        imageData: data,
        url: '',
      };
      await saveBgConfig({ enabled: true, type: 'upload', imageData: data, url: '' });
      e.target.value = '';
    },
    [resizeImage, saveBgConfig],
  );

  const handleUrlConfirm = useCallback(async () => {
    if (!bgUrl.trim()) return;
    setBgType('url');
    setBgImageData('');
    setBgEnabled(true);
    bgConfigRef.current = {
      ...bgConfigRef.current,
      enabled: true,
      type: 'url',
      url: bgUrl,
      imageData: '',
    };
    await saveBgConfig({ enabled: true, type: 'url', url: bgUrl, imageData: '' });
  }, [bgUrl, saveBgConfig]);

  const handleOpacityChange = useCallback(
    (val: number) => {
      const opacity = clampBackgroundOpacity(val);
      setBgOpacity(opacity);
      bgConfigRef.current = {
        ...bgConfigRef.current,
        opacity,
      };
      void saveBgConfig({ opacity });
    },
    [saveBgConfig],
  );

  const handleClearBg = useCallback(async () => {
    setBgEnabled(false);
    setBgType('upload');
    setBgUrl('');
    setBgImageData('');
    setBgOpacity(DEFAULT_BACKGROUND_OPACITY);
    bgConfigRef.current = DEFAULT_BACKGROUND_CONFIG;
    await chrome.runtime.sendMessage({ type: 'CLEAR_BACKGROUND' });
  }, []);

  // --- pet ---
  const savePetConfig = useCallback(async (patch: Partial<PetConfig>) => {
    const config = normalizePetConfig({
      ...petConfigRef.current,
      ...patch,
    });
    petConfigRef.current = config;
    await chrome.runtime.sendMessage({ type: 'SAVE_PET', payload: config });
  }, []);

  const handlePetToggle = useCallback(
    async (enabled: boolean) => {
      setPetEnabled(enabled);
      await savePetConfig({ enabled });
    },
    [savePetConfig],
  );

  const handlePetPositionChange = useCallback(
    async (position: Exclude<PetPosition, 'custom'>) => {
      setPetPosition(position);
      await savePetConfig({ position });
    },
    [savePetConfig],
  );

  const handlePetSizeChange = useCallback(
    (value: number) => {
      const size = clampPetSize(value);
      setPetSize(size);
      petConfigRef.current = { ...petConfigRef.current, size };
      void savePetConfig({ size });
    },
    [savePetConfig],
  );

  const handlePetOpacityChange = useCallback(
    (value: number) => {
      const opacity = clampPetOpacity(value);
      setPetOpacity(opacity);
      petConfigRef.current = { ...petConfigRef.current, opacity };
      void savePetConfig({ opacity });
    },
    [savePetConfig],
  );

  const handlePetMotionToggle = useCallback(
    async (motion: boolean) => {
      setPetMotion(motion);
      await savePetConfig({ motion });
    },
    [savePetConfig],
  );

  // --- sync ---
  const updateSyncField = useCallback((field: string, value: string) => {
    setSyncConfig((prev) => ({ ...prev, [field]: value }) as SyncConfig);
  }, []);

  const switchSyncProvider = useCallback((provider: SyncProvider) => {
    setSyncConfig(defaultConfigForProvider(provider));
    setSyncStatus('idle');
    setSyncMessage('');
  }, []);

  // OAuth providers don't need host permissions — launchWebAuthFlow handles auth.
  // WebDAV needs an optional host permission requested per-origin.
  const ensurePermission = useCallback(async (config: SyncConfig): Promise<boolean> => {
    if (config.provider !== 'webdav') return true;
    try {
      const origin = new URL(config.url).origin + '/*';
      return await chrome.permissions.request({ origins: [origin] });
    } catch {
      return false;
    }
  }, []);

  const isConfigFilled = useCallback((config: SyncConfig): boolean => {
    if (config.provider === 'webdav') return Boolean(config.url);
    return Boolean(config.clientId && config.clientSecret);
  }, []);

  const runSyncAction = useCallback(
    async (
      status: 'testing' | 'uploading' | 'downloading',
      action: () => Promise<void>,
      labels: { permissionDenied: string; operationFailed: string },
    ) => {
      if (!isConfigFilled(syncConfig)) return;
      setSyncStatus(status);
      setSyncMessage('');
      const granted = await ensurePermission(syncConfig);
      if (!granted) {
        setSyncStatus('error');
        setSyncMessage(labels.permissionDenied);
        return;
      }
      try {
        await chrome.runtime.sendMessage({ type: 'SAVE_SYNC_CONFIG', payload: syncConfig });
        await action();
      } catch (e) {
        setSyncStatus('error');
        setSyncMessage((e as Error).message || labels.operationFailed);
      }
    },
    [syncConfig, ensurePermission, isConfigFilled],
  );

  const handleAuthorizeSync = useCallback(
    async (labels: { success: string; failed: string }) => {
      if (!isConfigFilled(syncConfig)) return;
      setSyncStatus('testing');
      setSyncMessage('');
      try {
        const result = await chrome.runtime.sendMessage({ type: 'SYNC_AUTHORIZE', payload: syncConfig });
        if (!result?.ok || !result.refreshToken) {
          throw new Error(result?.error || labels.failed);
        }
        // Persist the refresh token immediately so a background restart before
        // the next sync doesn't lose authorization.
        const authorized = { ...syncConfig, refreshToken: result.refreshToken } as SyncConfig;
        setSyncConfig(authorized);
        await chrome.runtime.sendMessage({ type: 'SAVE_SYNC_CONFIG', payload: authorized });
        setSyncStatus('success');
        setSyncMessage(labels.success);
      } catch (e) {
        setSyncStatus('error');
        setSyncMessage((e as Error).message || labels.failed);
      }
    },
    [syncConfig, isConfigFilled],
  );

  const handleTestSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      success: string;
      failed: string;
    }) => {
      void runSyncAction('testing', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_TEST', payload: syncConfig });
        if (result?.ok) {
          setSyncStatus('success');
          setSyncMessage(labels.success);
        } else {
          throw new Error(result?.error || labels.failed);
        }
      }, labels);
    },
    [runSyncAction, syncConfig],
  );

  const handleUploadSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      failed: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction('uploading', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_UPLOAD_LOCAL' });
        if (result?.ok) {
          setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }) as SyncConfig);
          setSyncStatus('success');
          setSyncMessage(labels.success(result.counts));
        } else {
          throw new Error(result?.error || labels.failed);
        }
      }, labels);
    },
    [runSyncAction],
  );

  const handleDownloadSync = useCallback(
    (labels: {
      permissionDenied: string;
      operationFailed: string;
      failed: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction('downloading', async () => {
        const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_DOWNLOAD_REMOTE' });
        if (result?.ok) {
          setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }) as SyncConfig);
          setSyncStatus('success');
          setSyncMessage(labels.success(result.counts));
          setMemoryCount(result.counts?.memories ?? 0);
        } else {
          throw new Error(result?.error || labels.failed);
        }
      }, labels);
    },
    [runSyncAction],
  );

  // --- data ---
  const handleExport = useCallback(async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-pp-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(
    async (
      labels: { arrayError: string; jsonError: string },
      onResult?: (result: { ok: boolean; imported?: number; error?: string }) => void,
    ) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          const parsed: unknown = JSON.parse(text);
          if (!Array.isArray(parsed)) {
            throw new Error(labels.arrayError);
          }
          const memories = parsed.map((mem, index) => validateImportedMemory(mem, `memories[${index}]`));
          for (const memory of memories) {
            await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: memory });
          }
          setMemoryCount((c) => c + memories.length);
          onResult?.({ ok: true, imported: memories.length });
        } catch (error) {
          onResult?.({ ok: false, error: error instanceof Error ? error.message : labels.jsonError });
        }
      };
      input.click();
    },
    [],
  );

  const handleClearAllMemories = useCallback(async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    for (const mem of memories) {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id: mem.id } });
    }
    setMemoryCount(0);
  }, []);

  return {
    // shared
    loading,
    memoryCount,
    version,
    modelType,
    chatEnabled,
    handleModelTypeChange,
    handleChatToggle,
    floatingChatEnabled,
    handleFloatingChatToggle,
    // deepseek api key
    apiKeyConfigured,
    apiKeyInput,
    setApiKeyInput,
    apiKeyStatus,
    apiKeyMessage,
    handleSaveApiKey,
    handleClearApiKey,
    // multimodal
    multimodalConfigured,
    openaiApiKeyInput,
    setOpenaiApiKeyInput,
    geminiApiKeyInput,
    setGeminiApiKeyInput,
    openaiImageModel,
    setOpenaiImageModel,
    geminiVideoModel,
    setGeminiVideoModel,
    openaiBaseUrl,
    setOpenaiBaseUrl,
    geminiBaseUrl,
    setGeminiBaseUrl,
    multimodalStatus,
    multimodalMessage,
    handleSaveMultimodal,
    handleClearMultimodal,
    // background
    bgEnabled,
    bgType,
    bgUrl,
    setBgUrl,
    bgImageData,
    bgOpacity,
    bgPreview,
    fileInputRef,
    handleBgToggle,
    handleFileSelect,
    handleUrlConfirm,
    handleOpacityChange,
    handleClearBg,
    // pet
    petEnabled,
    petPosition,
    petSize,
    petOpacity,
    petMotion,
    handlePetToggle,
    handlePetPositionChange,
    handlePetSizeChange,
    handlePetOpacityChange,
    handlePetMotionToggle,
    // sync
    syncConfig,
    updateSyncField,
    switchSyncProvider,
    syncRedirectUri: getOptionalRedirectUri(),
    syncStatus,
    syncBusy,
    syncMessage,
    handleTestSync,
    handleUploadSync,
    handleDownloadSync,
    handleAuthorizeSync,
    // data
    handleExport,
    handleImport,
    handleClearAllMemories,
  };
}

export type SettingsState = ReturnType<typeof useSettingsState>;
