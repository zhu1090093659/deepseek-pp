import { useEffect, useState } from 'react';
import type { Memory, SyncConfig } from '../../../core/types';
import { SVG_PATHS } from '../constants';

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  url: '',
  username: '',
  password: '',
  remotePath: 'DeepSeekPP',
  lastSyncAt: null,
};

type SyncStatus = 'idle' | 'testing' | 'syncing' | 'success' | 'error';

export default function SettingsPage() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');
  const [syncConfig, setSyncConfig] = useState<SyncConfig>(DEFAULT_SYNC_CONFIG);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncMessage, setSyncMessage] = useState('');
  const [expertMode, setExpertMode] = useState(false);

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
  }, []);

  const handleExpertToggle = async (enabled: boolean) => {
    setExpertMode(enabled);
    await chrome.runtime.sendMessage({
      type: 'SET_MODEL_TYPE',
      payload: enabled ? 'expert' : null,
    });
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
    status: 'testing' | 'syncing',
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

  const handleTest = () =>
    runSyncAction('testing', async () => {
      await chrome.runtime.sendMessage({ type: 'WEBDAV_TEST', payload: syncConfig });
      setSyncStatus('success');
      setSyncMessage('连接成功');
    });

  const handleSync = () =>
    runSyncAction('syncing', async () => {
      const result = await chrome.runtime.sendMessage({ type: 'WEBDAV_SYNC' });
      if (result?.ok) {
        setSyncConfig((prev) => ({ ...prev, lastSyncAt: result.lastSyncAt }));
        setSyncStatus('success');
        setSyncMessage('同步完成');
        const list: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
        setMemoryCount(list?.length ?? 0);
      } else {
        throw new Error(result?.error || '同步失败');
      }
    });

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

  return (
    <div className="p-4 space-y-5">
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          模型设置
        </h2>

        <div className="ds-surface-panel rounded-xl p-4">
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
                className="absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                style={{
                  transform: expertMode ? 'translateX(18px)' : 'translateX(0)',
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

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={!syncConfig.url || syncStatus === 'testing' || syncStatus === 'syncing'}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
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
            onClick={handleSync}
            disabled={!syncConfig.url || syncStatus === 'testing' || syncStatus === 'syncing'}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
            style={
              syncConfig.url && syncStatus !== 'testing' && syncStatus !== 'syncing'
                ? { background: 'var(--ds-blue)', color: '#fff', borderColor: 'var(--ds-blue)' }
                : undefined
            }
          >
            {syncStatus === 'syncing' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            )}
            立即同步
          </button>
        </div>

        {syncMessage && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{
              color: syncStatus === 'error' ? '#EF4444' : '#10B981',
              background: syncStatus === 'error' ? '#FEF2F2' : '#ECFDF5',
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
              style={{ background: 'linear-gradient(135deg, var(--ds-blue), #7C8FFF)' }}
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
    </div>
  );
}
