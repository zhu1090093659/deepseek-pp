import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BACKGROUND_OPACITY,
  clampBackgroundOpacity,
  normalizeBackgroundConfig,
} from '../../../core/background/config';
import { getChatEnabled, setChatEnabled } from '../../../core/chat/store';
import type { FloatingChatRuntimeState } from '../../../core/floating-chat/runtime-state';
import { decodeRuntimeConfigResponse } from '../../../core/messaging/bootstrap-client';
import {
  DEFAULT_PET_CONFIG,
  clampPetOpacity,
  clampPetSize,
  normalizePetConfig,
} from '../../../core/pet/config';
import type {
  BackgroundConfig,
  GDriveSyncConfig,
  ModelType,
  MultimodalSettingsStatus,
  OneDriveSyncConfig,
  PetConfig,
  PetPosition,
  SyncCommandTarget,
  SyncConfig,
  SyncCounts,
  SyncProvider,
  WebdavSyncConfig,
} from '../../../core/types';
import {
  createSyncCommandTarget,
  decodeStoredSyncConfig,
  replaceSyncConfigProvider,
} from '../../../core/sync/config';
import { getOptionalRedirectUri } from '../../../core/sync/oauth-client';
import { getRuntimeErrorMessage, isRuntimeFailure } from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';
import {
  floatingChatSettingsController,
  settingsSyncRuntimeController,
  type SyncRuntimeCommandType,
} from './settings-controller';
import { libraryController } from './library-controller';

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
  lastSyncAt: null,
};

const DEFAULT_ONEDRIVE_CONFIG: OneDriveSyncConfig = {
  provider: 'onedrive',
  clientId: '',
  clientSecret: '',
  lastSyncAt: null,
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireSyncRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Invalid sync runtime revision');
  }
  return value as number;
}

function requireSyncTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('Invalid sync runtime timestamp');
  }
  return value as number;
}

function requireNullableSyncTimestamp(value: unknown): number | null {
  if (value === null) return null;
  return requireSyncTimestamp(value);
}

function defaultConfigForProvider(provider: SyncProvider): SyncConfig {
  if (provider === 'gdrive') return { ...DEFAULT_GDRIVE_CONFIG };
  if (provider === 'onedrive') return { ...DEFAULT_ONEDRIVE_CONFIG };
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
export type SyncStatus = 'idle' | 'testing' | 'uploading' | 'downloading' | 'success' | 'warning' | 'error';
type ActiveSyncStatus = Extract<SyncStatus, 'testing' | 'uploading' | 'downloading'>;

class CommittedRemoteSyncWarning extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommittedRemoteSyncWarning';
  }
}

export interface CapturedSyncTarget {
  command: SyncCommandTarget;
  formVersion: number;
}

const DEFAULT_MULTIMODAL: MultimodalSettingsStatus = {
  openaiConfigured: false,
  geminiConfigured: false,
  openaiImageModel: 'gpt-4.1-mini',
  geminiVideoModel: 'gemini-2.5-flash',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
};

function settingsLoadFallback<T>(label: string, fallback: T): (error: unknown) => T {
  return (error) => {
    console.error(`[DeepSeek++] Failed to load ${label} settings.`, error);
    return fallback;
  };
}

export function useSettingsController() {
  // --- shared / general ---
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');
  const [modelType, setModelTypeState] = useState<ModelType>(null);
  const [chatEnabled, setChatEnabledState] = useState(false);
  // null = not yet loaded; the settings page only renders this sub-page after
  // loading completes, so the toggle never shows a stale default.
  const [floatingChatRuntimeState, setFloatingChatRuntimeState] = useState<FloatingChatRuntimeState | null>(null);
  const [floatingChatMessage, setFloatingChatMessage] = useState('');
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
  const [activeSyncStatus, setActiveSyncStatus] = useState<ActiveSyncStatus | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgConfigRef = useRef<BackgroundConfig>(DEFAULT_BACKGROUND_CONFIG);
  const petConfigRef = useRef<PetConfig>(DEFAULT_PET_CONFIG);
  const syncConfigRef = useRef<SyncConfig>(DEFAULT_WEBDAV_CONFIG);
  const syncRevisionRef = useRef<number | null>(null);
  const syncFormVersionRef = useRef(0);
  const syncBusyRef = useRef(false);
  const syncOperationRef = useRef(0);
  const petLoadGenerationRef = useRef(0);

  const bgPreview = bgType === 'url' ? bgUrl : bgImageData;
  const syncBusy = activeSyncStatus !== null;

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

  const applySyncSnapshot = useCallback((config: SyncConfig, revision: number | null) => {
    const next = revision === null
      ? config
      : { ...config, schemaVersion: 1 as const, revision };
    syncConfigRef.current = next;
    syncRevisionRef.current = revision;
    syncFormVersionRef.current += 1;
    setSyncConfig(next);
  }, []);

  const loadSyncConfigValue = useCallback((value: unknown) => {
    if (value === null) {
      applySyncSnapshot({ ...DEFAULT_WEBDAV_CONFIG }, null);
      return;
    }
    const record = decodeStoredSyncConfig(value);
    applySyncSnapshot(record.config, record.revision);
  }, [applySyncSnapshot]);

  // --- initial load ---
  useEffect(() => {
    let cancelled = false;
    const initialPetLoadGeneration = ++petLoadGenerationRef.current;
    (async () => {
      const [chatOn, floatingState, keyStatus, mmStatus, memories, cfg, syncCfg, modelType, bgCfg, petCfg] = await Promise.all([
        getChatEnabled().catch((error) => {
          console.error('DeepSeek++ failed to read sidepanel chat setting', error);
          return false;
        }),
        floatingChatSettingsController.load().catch((error) => {
          if (!cancelled) setFloatingChatMessage(getRuntimeErrorMessage(error));
          return null;
        }),
        sidepanelRuntimeClient.request({ type: 'GET_DEEPSEEK_API_KEY_STATUS' })
          .catch(settingsLoadFallback('DeepSeek API key status', undefined)),
        sidepanelRuntimeClient.request({ type: 'GET_MULTIMODAL_SETTINGS_STATUS' })
          .catch(settingsLoadFallback('multimodal status', undefined)),
        libraryController.getMemories()
          .catch(settingsLoadFallback('memory count', [])),
        sidepanelRuntimeClient.request(
          { type: 'GET_CONFIG' },
          { decode: decodeRuntimeConfigResponse },
        )
          .catch(settingsLoadFallback('extension version', undefined)),
        settingsSyncRuntimeController.getConfig().catch((error) => ({
          ok: false,
          error: getRuntimeErrorMessage(error),
        })),
        sidepanelRuntimeClient.request({ type: 'GET_MODEL_TYPE' })
          .catch(settingsLoadFallback('model type', null)),
        sidepanelRuntimeClient.request({ type: 'GET_BACKGROUND' })
          .catch(settingsLoadFallback('background', null)),
        sidepanelRuntimeClient.request({ type: 'GET_PET' })
          .catch(settingsLoadFallback('pet', null)),
      ]);
      if (cancelled) return;
      setChatEnabledState(chatOn);
      if (floatingState) setFloatingChatRuntimeState(floatingState);
      setApiKeyConfigured((keyStatus as { configured?: boolean } | undefined)?.configured === true);
      const mm = mmStatus as ({ ok?: boolean } & MultimodalSettingsStatus) | undefined;
      if (mm?.ok) syncMultimodalStatus(mm);
      setMemoryCount(memories.length);
      setVersion(cfg && 'version' in cfg ? cfg.version : '');
      if (isRuntimeFailure(syncCfg)) {
        setSyncStatus('error');
        setSyncMessage(syncCfg.error ? String(syncCfg.error) : 'Failed to load sync configuration');
      } else {
        try {
          loadSyncConfigValue(syncCfg);
        } catch (error) {
          setSyncStatus('error');
          setSyncMessage(getRuntimeErrorMessage(error));
        }
      }
      setModelTypeState(modelType === 'expert' || modelType === 'vision' ? modelType : null);
      const normalizedBg = normalizeBackgroundConfig(bgCfg as BackgroundConfig | null);
      if (normalizedBg) syncBgState(normalizedBg);
      if (petLoadGenerationRef.current === initialPetLoadGeneration) {
        syncPetState(normalizePetConfig(petCfg as PetConfig | null));
      }
      setLoading(false);
    })();

    const handlePetUpdate = (message: { type?: string; config?: PetConfig | null }) => {
      if (message.type === 'PET_UPDATED') {
        petLoadGenerationRef.current += 1;
        syncPetState(normalizePetConfig(message.config));
      }
    };
    chrome.runtime.onMessage.addListener(handlePetUpdate);
    return () => {
      cancelled = true;
      petLoadGenerationRef.current += 1;
      chrome.runtime.onMessage.removeListener(handlePetUpdate);
    };
  }, [loadSyncConfigValue, syncBgState, syncPetState, syncMultimodalStatus]);

  // --- webpage model mode ---
  const handleModelTypeChange = useCallback(async (nextModelType: ModelType) => {
    setModelTypeState(nextModelType);
    await sidepanelRuntimeClient.request({
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
    setFloatingChatMessage('');
    try {
      const state = await floatingChatSettingsController.setEnabled(next);
      setFloatingChatRuntimeState(state);
    } catch (error) {
      setFloatingChatMessage(getRuntimeErrorMessage(error));
    }
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
        await sidepanelRuntimeClient.request({
          type: 'SAVE_DEEPSEEK_API_KEY',
          payload: { apiKey },
        });
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
        await sidepanelRuntimeClient.request({ type: 'CLEAR_DEEPSEEK_API_KEY' });
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
        const result = await sidepanelRuntimeClient.request({
          type: 'SAVE_MULTIMODAL_SETTINGS',
          payload,
        });
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
        const result = await sidepanelRuntimeClient.request({ type: 'CLEAR_MULTIMODAL_SETTINGS' });
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
    await sidepanelRuntimeClient.request({ type: 'SAVE_BACKGROUND', payload: config });
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
    await sidepanelRuntimeClient.request({ type: 'CLEAR_BACKGROUND' });
  }, []);

  // --- pet ---
  const savePetConfig = useCallback(async (patch: Partial<PetConfig>) => {
    const config = normalizePetConfig({
      ...petConfigRef.current,
      ...patch,
    });
    petConfigRef.current = config;
    await sidepanelRuntimeClient.request({ type: 'SAVE_PET', payload: config });
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
    if (syncBusyRef.current) return;
    const next = { ...syncConfigRef.current, [field]: value } as SyncConfig;
    syncConfigRef.current = next;
    syncFormVersionRef.current += 1;
    setSyncConfig(next);
  }, []);

  const switchSyncProvider = useCallback((provider: SyncProvider) => {
    if (syncBusyRef.current) return;
    const next = replaceSyncConfigProvider(
      syncConfigRef.current,
      defaultConfigForProvider(provider),
    );
    syncConfigRef.current = next;
    syncFormVersionRef.current += 1;
    setSyncConfig(next);
    setSyncStatus('idle');
    setSyncMessage('');
  }, []);

  const captureSyncTarget = useCallback((): CapturedSyncTarget => ({
    command: createSyncCommandTarget(syncConfigRef.current, syncRevisionRef.current),
    formVersion: syncFormVersionRef.current,
  }), []);

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

  const applyCommittedSyncTarget = useCallback((config: SyncConfig, revision: number) => {
    const next = { ...config, schemaVersion: 1 as const, revision };
    syncConfigRef.current = next;
    syncRevisionRef.current = revision;
    setSyncConfig(next);
  }, []);

  const runSyncAction = useCallback(
    async (
      target: CapturedSyncTarget,
      status: ActiveSyncStatus,
      type: SyncRuntimeCommandType,
      labels: {
        permissionDenied: string;
        operationFailed: string;
        resultFailed: string;
        configChanged: string;
        committedWarning: string;
      },
      committedConfig: (result: Record<string, unknown>) => SyncConfig,
      onSuccess: (result: Record<string, unknown>) => void,
    ) => {
      if (syncBusyRef.current || !isConfigFilled(target.command.config)) return;
      if (
        target.formVersion !== syncFormVersionRef.current
        || target.command.expectedRevision !== syncRevisionRef.current
      ) {
        setSyncStatus('error');
        setSyncMessage(labels.configChanged);
        return;
      }

      const operationId = syncOperationRef.current + 1;
      syncOperationRef.current = operationId;
      syncBusyRef.current = true;
      setActiveSyncStatus(status);
      setSyncStatus(status);
      setSyncMessage('');
      try {
        const granted = await ensurePermission(target.command.config);
        if (!granted) throw new Error(labels.permissionDenied);
        if (
          target.formVersion !== syncFormVersionRef.current
          || target.command.expectedRevision !== syncRevisionRef.current
        ) {
          throw new Error(labels.configChanged);
        }

        const result = await settingsSyncRuntimeController.execute(type, target.command);
        if (isRuntimeFailure(result)) {
          const failure = result as {
            ok: false;
            error?: unknown;
            code?: unknown;
            revision?: unknown;
            lastSyncAt?: unknown;
            reloadConfig?: unknown;
            effectCompleted?: unknown;
          };
          const mustReloadConfig = failure.code === 'sync_config_conflict'
            || failure.code === 'sync_config_commit_indeterminate'
            || failure.code === 'sync_operation_effect_completed_config_persist_failed';
          if (mustReloadConfig) {
            try {
              const latest = await settingsSyncRuntimeController.getConfig();
              if (isRuntimeFailure(latest)) {
                throw new Error(latest.error ? String(latest.error) : labels.configChanged);
              }
              loadSyncConfigValue(latest);
            } catch (refreshError) {
              const original = failure.error ? String(failure.error) : labels.configChanged;
              throw new AggregateError(
                [failure, refreshError],
                `${original}; ${getRuntimeErrorMessage(refreshError)}`,
              );
            }
            if (failure.code === 'sync_operation_effect_completed_config_persist_failed') {
              const detail = failure.error ? String(failure.error) : labels.resultFailed;
              throw new CommittedRemoteSyncWarning(`${labels.committedWarning} ${detail}`);
            }
          } else if (failure.code === 'sync_operation_failed_after_config_commit') {
            const revision = requireSyncRevision(failure.revision);
            applyCommittedSyncTarget({
              ...target.command.config,
              lastSyncAt: requireNullableSyncTimestamp(failure.lastSyncAt),
            } as SyncConfig, revision);
          }
          throw new Error(failure.error ? String(failure.error) : labels.resultFailed);
        }
        if (!isPlainRecord(result) || result.ok !== true) {
          throw new Error(labels.resultFailed);
        }

        const revision = requireSyncRevision(result.revision);
        applyCommittedSyncTarget(committedConfig(result), revision);
        if (syncOperationRef.current === operationId) {
          setSyncStatus('success');
          onSuccess(result);
        }
      } catch (error) {
        if (syncOperationRef.current === operationId) {
          setSyncStatus(error instanceof CommittedRemoteSyncWarning ? 'warning' : 'error');
          setSyncMessage(getRuntimeErrorMessage(error) || labels.operationFailed);
        }
      } finally {
        if (syncOperationRef.current === operationId) {
          syncBusyRef.current = false;
          setActiveSyncStatus(null);
        }
      }
    },
    [applyCommittedSyncTarget, ensurePermission, isConfigFilled, loadSyncConfigValue],
  );

  const handleAuthorizeSync = useCallback(
    (target: CapturedSyncTarget, labels: {
      success: string;
      failed: string;
      configChanged: string;
      committedWarning: string;
    }) => {
      void runSyncAction(
        target,
        'testing',
        'SYNC_AUTHORIZE',
        {
          permissionDenied: labels.failed,
          operationFailed: labels.failed,
          resultFailed: labels.failed,
          configChanged: labels.configChanged,
          committedWarning: labels.committedWarning,
        },
        (result) => {
          if (typeof result.refreshToken !== 'string' || !result.refreshToken) {
            throw new Error(labels.failed);
          }
          return { ...target.command.config, refreshToken: result.refreshToken } as SyncConfig;
        },
        () => setSyncMessage(labels.success),
      );
    },
    [runSyncAction],
  );

  const handleTestSync = useCallback(
    (target: CapturedSyncTarget, labels: {
      permissionDenied: string;
      operationFailed: string;
      configChanged: string;
      success: string;
      failed: string;
      committedWarning: string;
    }) => {
      void runSyncAction(
        target,
        'testing',
        'WEBDAV_TEST',
        { ...labels, resultFailed: labels.failed },
        () => target.command.config,
        () => setSyncMessage(labels.success),
      );
    },
    [runSyncAction],
  );

  const handleUploadSync = useCallback(
    (target: CapturedSyncTarget, labels: {
      permissionDenied: string;
      operationFailed: string;
      configChanged: string;
      failed: string;
      committedWarning: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction(
        target,
        'uploading',
        'WEBDAV_UPLOAD_LOCAL',
        { ...labels, resultFailed: labels.failed },
        (result) => ({
          ...target.command.config,
          lastSyncAt: requireSyncTimestamp(result.lastSyncAt),
        } as SyncConfig),
        (result) => setSyncMessage(labels.success(result.counts as SyncCounts | undefined)),
      );
    },
    [runSyncAction],
  );

  const handleDownloadSync = useCallback(
    (target: CapturedSyncTarget, labels: {
      permissionDenied: string;
      operationFailed: string;
      configChanged: string;
      failed: string;
      committedWarning: string;
      success: (counts?: SyncCounts) => string;
    }) => {
      void runSyncAction(
        target,
        'downloading',
        'WEBDAV_DOWNLOAD_REMOTE',
        { ...labels, resultFailed: labels.failed },
        (result) => ({
          ...target.command.config,
          lastSyncAt: requireSyncTimestamp(result.lastSyncAt),
        } as SyncConfig),
        (result) => {
          const counts = result.counts as SyncCounts | undefined;
          setSyncMessage(labels.success(counts));
          setMemoryCount(counts?.memories ?? 0);
        },
      );
    },
    [runSyncAction],
  );

  // --- data ---
  const handleExport = useCallback(async () => {
    const memories = await libraryController.getMemories();
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
          const result = await sidepanelRuntimeClient.request({
            type: 'IMPORT_MEMORY_DRAFTS',
            payload: { memories: parsed },
          });
          if (!result?.ok) {
            throw new Error(result?.error || labels.jsonError);
          }
          const imported = typeof result.count === 'number' ? result.count : parsed.length;
          setMemoryCount((count) => count + imported);
          onResult?.({ ok: true, imported });
        } catch (error) {
          onResult?.({ ok: false, error: error instanceof Error ? error.message : labels.jsonError });
        }
      };
      input.click();
    },
    [],
  );

  const handleClearAllMemories = useCallback(async () => {
    const memories = await libraryController.getMemories();
    for (const mem of memories) {
      const id = mem.id;
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        throw new Error('Memory id is missing.');
      }
      await libraryController.deleteMemory(id);
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
    floatingChatEnabled: floatingChatRuntimeState?.kind === 'ready',
    floatingChatRuntimeState,
    floatingChatMessage,
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
    captureSyncTarget,
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

export type SettingsState = ReturnType<typeof useSettingsController>;
