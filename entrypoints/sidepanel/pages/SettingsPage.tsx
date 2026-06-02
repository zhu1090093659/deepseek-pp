import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_BACKGROUND_OPACITY,
  clampBackgroundOpacity,
  normalizeBackgroundConfig,
} from '../../../core/background/config';
import {
  DEFAULT_PET_CONFIG,
  clampPetOpacity,
  clampPetSize,
  normalizePetConfig,
} from '../../../core/pet/config';
import type { BackgroundConfig, Memory, PetConfig, PetPosition, SyncConfig, SyncCounts } from '../../../core/types';
import { SVG_PATHS } from '../constants';
import { getChatEnabled, setChatEnabled } from '../../../core/chat/store';
import ScenarioManager from '../components/ScenarioManager';

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  url: '',
  username: '',
  password: '',
  remotePath: 'DeepSeekPP',
  lastSyncAt: null,
};

const DEFAULT_BACKGROUND_CONFIG: BackgroundConfig = {
  enabled: false,
  type: 'upload',
  url: '',
  imageData: '',
  opacity: DEFAULT_BACKGROUND_OPACITY,
};

type SyncStatus = 'idle' | 'testing' | 'uploading' | 'downloading' | 'success' | 'error';

export default function SettingsPage() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [expertMode, setExpertMode] = useState(false);
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgType, setBgType] = useState<'upload' | 'url'>('upload');
  const [bgUrl, setBgUrl] = useState('');
  const [bgImageData, setBgImageData] = useState('');
  const [bgOpacity, setBgOpacity] = useState(DEFAULT_BACKGROUND_OPACITY);
  const [petEnabled, setPetEnabled] = useState(DEFAULT_PET_CONFIG.enabled);
  const [petPosition, setPetPosition] = useState<PetPosition>(DEFAULT_PET_CONFIG.position);
  const [petSize, setPetSize] = useState(DEFAULT_PET_CONFIG.size);
  const [petOpacity, setPetOpacity] = useState(DEFAULT_PET_CONFIG.opacity);
  const [petMotion, setPetMotion] = useState(DEFAULT_PET_CONFIG.motion);
  const [chatEnabled, setChatEnabledState] = useState(false);

  useEffect(() => {
    getChatEnabled().then(setChatEnabledState);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgConfigRef = useRef<BackgroundConfig>(DEFAULT_BACKGROUND_CONFIG);
  const petConfigRef = useRef<PetConfig>(DEFAULT_PET_CONFIG);

  const bgPreview = bgType === 'url' ? bgUrl : bgImageData;
  const syncBusy = syncStatus === 'testing' || syncStatus === 'uploading' || syncStatus === 'downloading';

  const syncBgState = (config: BackgroundConfig) => {
    bgConfigRef.current = config;
    setBgEnabled(config.enabled);
    setBgType(config.type);
    setBgUrl(config.url ?? '');
    setBgImageData(config.imageData ?? '');
    setBgOpacity(config.opacity);
  };

  const syncPetState = (config: PetConfig) => {
    petConfigRef.current = config;
    setPetEnabled(config.enabled);
    setPetPosition(config.position);
    setPetSize(config.size);
    setPetOpacity(config.opacity);
    setPetMotion(config.motion);
  };

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }).then((list: Memory[]) => {
      setMemoryCount(list?.length ?? 0);
    });
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).then((cfg: { version: string }) => {
      setVersion(cfg?.version ?? '');
    });
    chrome.runtime.sendMessage({ type: 'GET_SYNC_CONFIG' }).then((cfg: SyncConfig | null) => {
      if (cfg) setSyncConfig(cfg);
    });
    chrome.runtime.sendMessage({ type: 'GET_MODEL_TYPE' }).then((val: string | null) => {
      setExpertMode(val === 'expert');
    });
    chrome.runtime.sendMessage({ type: 'GET_BACKGROUND' }).then((cfg: BackgroundConfig | null) => {
      const normalized = normalizeBackgroundConfig(cfg);
      if (normalized) syncBgState(normalized);
    });
    chrome.runtime.sendMessage({ type: 'GET_PET' }).then((cfg: PetConfig | null) => {
      syncPetState(normalizePetConfig(cfg));
    });

    const handlePetUpdate = (message: { type?: string; config?: PetConfig | null }) => {
      if (message.type === 'PET_UPDATED') {
        syncPetState(normalizePetConfig(message.config));
      }
    };

    chrome.runtime.onMessage.addListener(handlePetUpdate);

    return () => {
      chrome.runtime.onMessage.removeListener(handlePetUpdate);
    };
  }, []);

  const handleExpertToggle = async (enabled: boolean) => {
    setExpertMode(enabled);
    await chrome.runtime.sendMessage({
      type: 'SET_MODEL_TYPE',
      payload: enabled ? 'expert' : null,
    });
  };

  const saveBgConfig = async (patch: Partial<BackgroundConfig>) => {
    const config = normalizeBackgroundConfig({
      ...bgConfigRef.current,
      ...patch,
    });
    if (!config) return;
    bgConfigRef.current = config;
    await chrome.runtime.sendMessage({ type: 'SAVE_BACKGROUND', payload: config });
  };

  const handleBgToggle = async (enabled: boolean) => {
    setBgEnabled(enabled);
    await saveBgConfig({ enabled });
  };

  const resizeImage = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  const handleUrlConfirm = async () => {
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
  };

  const handleOpacityChange = (val: number) => {
    const opacity = clampBackgroundOpacity(val);
    setBgOpacity(opacity);
    bgConfigRef.current = {
      ...bgConfigRef.current,
      opacity,
    };
    void saveBgConfig({ opacity });
  };

  const handleClearBg = async () => {
    setBgEnabled(false);
    setBgType('upload');
    setBgUrl('');
    setBgImageData('');
    setBgOpacity(DEFAULT_BACKGROUND_OPACITY);
    bgConfigRef.current = DEFAULT_BACKGROUND_CONFIG;
    await chrome.runtime.sendMessage({ type: 'CLEAR_BACKGROUND' });
  };

  const savePetConfig = async (patch: Partial<PetConfig>) => {
    const config = normalizePetConfig({
      ...petConfigRef.current,
      ...patch,
    });
    petConfigRef.current = config;
    await chrome.runtime.sendMessage({ type: 'SAVE_PET', payload: config });
  };

  const handlePetToggle = async (enabled: boolean) => {
    setPetEnabled(enabled);
    await savePetConfig({ enabled });
  };

  const handlePetPositionChange = async (position: Exclude<PetPosition, 'custom'>) => {
    setPetPosition(position);
    await savePetConfig({ position });
  };

  const handlePetSizeChange = (value: number) => {
    const size = clampPetSize(value);
    setPetSize(size);
    petConfigRef.current = {
      ...petConfigRef.current,
      size,
    };
    void savePetConfig({ size });
  };

  const handlePetOpacityChange = (value: number) => {
    const opacity = clampPetOpacity(value);
    setPetOpacity(opacity);
    petConfigRef.current = {
      ...petConfigRef.current,
      opacity,
    };
    void savePetConfig({ opacity });
  };

  const handlePetMotionToggle = async (motion: boolean) => {
    setPetMotion(motion);
    await savePetConfig({ motion });
  };

  const updateField = (field: keyof SyncConfig, value: string) => {
    setSyncConfig((prev) => ({ ...prev, [field]: value }));
  };

  const requestPermission = async (url: string): Promise<boolean> => {
    try {
      const origin = new URL(url).origin + '/*';
      return await chrome.permissions.request({ origins: [origin] });
    } catch {
      return false;
    }
  };

  const runSyncAction = async (
    status: 'testing' | 'uploading' | 'downloading',
    action: () => Promise<void>,
  ) => {
    if (!syncConfig.url) return;
    setSyncStatus(status);
    setSyncMessage('');

    const granted = await requestPermission(syncConfig.url);
    if (!granted) {
      setSyncStatus('error');
      setSyncMessage('需要访问权限才能连接 WebDAV 服务器');
      return;
    }

    try {
      await chrome.runtime.sendMessage({ type: 'SAVE_SYNC_CONFIG', payload: syncConfig });
      await action();
    } catch (e) {
      setSyncStatus('error');
      setSyncMessage((e as Error).message || '操作失败');
    }
  };

  const formatSyncCounts = (counts?: SyncCounts) => {
    if (!counts) return '';
    return `记忆 ${counts.memories} 条，Skill ${counts.skills} 个，预设 ${counts.presets} 个`;
  };

  const handleTest = () => {
    void runSyncAction('testing', async () => {
      const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_TEST', payload: syncConfig });
      if (result?.ok) {
        setSyncStatus('success');
        setSyncMessage('连接成功');
      } else {
        throw new Error(result?.error || '连接失败');
      }
    });
  };

  const handleUploadLocal = () => {
    if (!confirm('确定要用本地记忆、Skill 和预设覆盖云端数据吗？')) return;

    void runSyncAction('uploading', async () => {
      const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_UPLOAD_LOCAL' });
      if (result?.ok) {
        setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }));
        setSyncStatus('success');
        setSyncMessage(`上传完成，已覆盖云端。${formatSyncCounts(result.counts)}`);
      } else {
        throw new Error(result?.error || '上传失败');
      }
    });
  };

  const handleDownloadRemote = () => {
    if (!confirm('确定要用云端记忆、Skill 和预设覆盖本地数据吗？此操作不可撤销。')) return;

    void runSyncAction('downloading', async () => {
      const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_DOWNLOAD_REMOTE' });
      if (result?.ok) {
        setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }));
        setSyncStatus('success');
        setSyncMessage(`下载完成，已覆盖本地。${formatSyncCounts(result.counts)}`);
        setMemoryCount(result.counts?.memories ?? 0);
      } else {
        throw new Error(result?.error || '下载失败');
      }
    });
  };

  const handleExport = async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-pp-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const memories: Memory[] = JSON.parse(text);
        for (const mem of memories) {
          const { id, createdAt, updatedAt, accessCount, lastAccessedAt, ...rest } = mem;
          await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: rest });
        }
        setMemoryCount((c) => c + memories.length);
      } catch {
        alert('JSON 格式错误');
      }
    };
    input.click();
  };

  const handleClearAll = async () => {
    if (!confirm('确定要清除所有记忆吗？此操作不可撤销。')) return;
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    for (const mem of memories) {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id: mem.id } });
    }
    setMemoryCount(0);
  };

  const formatTime = (ts: number | null) => {
    if (!ts) return '从未同步';
    return new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const inputClass =
    'w-full px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]';

  const inputStyle = {
    background: 'var(--ds-bg)',
    borderColor: 'var(--ds-border)',
    color: 'var(--ds-text)',
  };

  const petPositionItems: Array<{ key: PetPosition; label: string }> = [
    { key: 'bottom-right', label: '右下' },
    { key: 'bottom-left', label: '左下' },
  ];
  if (petPosition === 'custom') {
    petPositionItems.push({ key: 'custom', label: '自定义' });
  }
  const petPositionGridClass = `grid gap-2 ${petPosition === 'custom' ? 'grid-cols-3' : 'grid-cols-2'}`;

  return (
    <div className="p-4 space-y-5">
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          模型设置
        </h2>

        <div className="ds-surface-panel rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                Expert 模式
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                使用 DeepSeek Expert 模型进行对话
              </div>
            </div>
            <button
              onClick={() => handleExpertToggle(!expertMode)}
              className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
              style={{
                background: expertMode ? 'var(--ds-blue)' : 'var(--ds-border)',
              }}
            >
              <span
                className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                style={{
                  transform: expertMode ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          <div
            className="flex justify-between items-center pt-3 border-t"
            style={{ borderColor: 'var(--ds-border)' }}
          >
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                侧边栏对话
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                在侧边栏显示对话标签，支持 DeepSeek API 直连对话
              </div>
            </div>
            <button
              onClick={async () => {
                const next = !chatEnabled;
                setChatEnabledState(next);
                await setChatEnabled(next);
              }}
              className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
              style={{
                background: chatEnabled ? 'var(--ds-blue)' : 'var(--ds-border)',
              }}
            >
              <span
                className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                style={{
                  transform: chatEnabled ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          <div
            className="flex justify-between items-center pt-3 border-t"
            style={{ borderColor: 'var(--ds-border)' }}
          >
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                DeepSeek 小鲸鱼
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                在 DeepSeek 页面显示状态联动宠物
              </div>
            </div>
            <button
              onClick={() => handlePetToggle(!petEnabled)}
              className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
              style={{
                background: petEnabled ? 'var(--ds-blue)' : 'var(--ds-border)',
              }}
            >
              <span
                className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                style={{
                  transform: petEnabled ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          背景设置
        </h2>

        <div className="ds-surface-panel rounded-xl p-4 space-y-3">
          <div className="flex justify-between items-center">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                自定义背景
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                为 DeepSeek 页面设置背景图片
              </div>
            </div>
            <button
              onClick={() => handleBgToggle(!bgEnabled)}
              disabled={!bgPreview}
              className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-40"
              style={{
                background: bgEnabled && bgPreview ? 'var(--ds-blue)' : 'var(--ds-border)',
              }}
            >
              <span
                className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                style={{
                  transform: bgEnabled && bgPreview ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="ds-btn-secondary flex-1 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
              </svg>
              上传图片
            </button>
          </div>

          <div className="flex gap-2">
            <input
              type="url"
              placeholder="粘贴图片 URL"
              value={bgUrl}
              onChange={(e) => setBgUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUrlConfirm()}
              className={inputClass}
              style={inputStyle}
            />
            <button
              onClick={handleUrlConfirm}
              disabled={!bgUrl.trim()}
              className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
            >
              确认
            </button>
          </div>

          {bgPreview && (
            <div
              className="relative rounded-lg overflow-hidden border"
              style={{ borderColor: 'var(--ds-border)', height: '120px' }}
            >
              <img
                src={bgPreview}
                alt="背景预览"
                className="w-full h-full object-cover"
                onError={() => { setBgUrl(''); setBgImageData(''); }}
              />
              <div
                className="absolute inset-0 flex items-center justify-center text-[10px]"
                style={{
                  background: `rgba(var(--ds-bg-rgb), ${(1 - bgOpacity).toFixed(3)})`,
                  backdropFilter: `blur(${((1 - bgOpacity) * 8).toFixed(1)}px)`,
                  WebkitBackdropFilter: `blur(${((1 - bgOpacity) * 8).toFixed(1)}px)`,
                  color: 'var(--ds-text-secondary)',
                  pointerEvents: 'none',
                }}
              >
                模拟效果预览
              </div>
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
                背景透明度
              </label>
              <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
                {bgOpacity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={bgOpacity}
              onChange={(e) => handleOpacityChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--ds-blue) ${bgOpacity * 100}%, var(--ds-border) ${bgOpacity * 100}%)`,
              }}
            />
          </div>

          {bgPreview && (
            <button
              onClick={handleClearBg}
              className="ds-btn-danger w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150"
            >
              清除背景
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          悬浮宠物
        </h2>

        <div className="ds-surface-panel rounded-xl p-4 space-y-3">
          <div className={petPositionGridClass}>
            {petPositionItems.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  if (item.key !== 'custom') void handlePetPositionChange(item.key);
                }}
                className={[
                  'py-2 text-[11px] font-medium rounded-lg border transition-all duration-150',
                  item.key === 'custom' ? 'cursor-default' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  background: petPosition === item.key ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                  color: petPosition === item.key ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                  borderColor: petPosition === item.key ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
                尺寸
              </label>
              <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
                {petSize}px
              </span>
            </div>
            <input
              type="range"
              min="84"
              max="220"
              step="4"
              value={petSize}
              onChange={(e) => handlePetSizeChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--ds-blue) ${((petSize - 84) / (220 - 84)) * 100}%, var(--ds-border) ${((petSize - 84) / (220 - 84)) * 100}%)`,
              }}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
                透明度
              </label>
              <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
                {petOpacity.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.45"
              max="1"
              step="0.05"
              value={petOpacity}
              onChange={(e) => handlePetOpacityChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, var(--ds-blue) ${((petOpacity - 0.45) / (1 - 0.45)) * 100}%, var(--ds-border) ${((petOpacity - 0.45) / (1 - 0.45)) * 100}%)`,
              }}
            />
          </div>

          <div className="flex justify-between items-center">
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                动态漂浮
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                减少动作时可关闭
              </div>
            </div>
            <button
              onClick={() => handlePetMotionToggle(!petMotion)}
              className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
              style={{
                background: petMotion ? 'var(--ds-blue)' : 'var(--ds-border)',
              }}
            >
              <span
                className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                style={{
                  transform: petMotion ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          云同步
        </h2>

        <div className="ds-surface-panel rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
              WebDAV 地址
            </label>
            <input
              type="url"
              placeholder="https://dav.example.com/dav/"
              value={syncConfig.url}
              onChange={(e) => updateField('url', e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                用户名
              </label>
              <input
                type="text"
                value={syncConfig.username}
                onChange={(e) => updateField('username', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label className="block text-[11px] mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
                密码
              </label>
              <input
                type="password"
                value={syncConfig.password}
                onChange={(e) => updateField('password', e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] mb-1" style={{ color: 'var(--ds-text-secondary)' }}>
              远程路径
            </label>
            <input
              type="text"
              value={syncConfig.remotePath}
              onChange={(e) => updateField('remotePath', e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleTest}
            disabled={!syncConfig.url || syncBusy}
            className="ds-btn-secondary col-span-2 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {syncStatus === 'testing' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            测试连接
          </button>
          <button
            onClick={handleUploadLocal}
            disabled={!syncConfig.url || syncBusy}
            className="ds-btn-secondary py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={
              syncConfig.url && !syncBusy
                ? { background: 'var(--ds-blue)', color: 'var(--ds-text-on-primary)', borderColor: 'var(--ds-blue)' }
                : undefined
            }
          >
            {syncStatus === 'uploading' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
              </svg>
            )}
            上传本地
          </button>
          <button
            onClick={handleDownloadRemote}
            disabled={!syncConfig.url || syncBusy}
            className="ds-btn-secondary py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {syncStatus === 'downloading' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
              </svg>
            )}
            下载云端
          </button>
        </div>

        {syncMessage && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{
              color: syncStatus === 'error' ? 'var(--ds-danger)' : 'var(--ds-success)',
              background: syncStatus === 'error' ? 'var(--ds-danger-bg)' : 'var(--ds-success-bg)',
            }}
          >
            {syncMessage}
          </div>
        )}

        <div className="text-[11px] text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
          上次同步: {formatTime(syncConfig.lastSyncAt)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          数据管理
        </h2>

        <div className="ds-surface-panel rounded-xl p-4">
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--ds-text-secondary)' }}>记忆总数</span>
            <span className="text-lg font-semibold" style={{ color: 'var(--ds-blue)' }}>
              {memoryCount}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
            </svg>
            导出记忆
          </button>
          <button
            onClick={handleImport}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
            导入记忆
          </button>
        </div>

        <button
          onClick={handleClearAll}
          className="ds-btn-danger w-full py-2.5 text-xs font-medium rounded-lg transition-all duration-150"
        >
          清除所有记忆
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          关于
        </h2>
        <div className="ds-surface-panel rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg, var(--ds-blue), var(--ds-logo-gradient-end))' }}
            >
              D+
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>
                DeepSeek++ v{version}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                Agentic 记忆与 Skill 系统
              </div>
            </div>
          </div>
          <a
            href="https://github.com/zhu1090093659/deepseek-pp"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] mt-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--ds-text-secondary)' }}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </div>
      </section>

      <section className="space-y-3">
        <ScenarioManager />
      </section>
    </div>
  );
}
