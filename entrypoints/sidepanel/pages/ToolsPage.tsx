import { useEffect, useState } from 'react';

type PermissionState = 'idle' | 'granting' | 'granted' | 'denied' | 'error';
type DiagState = 'idle' | 'running' | 'done' | 'err';
type DiagResult = Record<string, { status: number; length: number; error?: string; preview?: string }>;

function DiagSearch() {
  const [query, setQuery] = useState('橘鸦 up主');
  const [state, setState] = useState<DiagState>('idle');
  const [result, setResult] = useState<DiagResult | null>(null);

  const run = async () => {
    setState('running');
    setResult(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DIAGNOSE_WEB_SEARCH', payload: { query } });
      setResult(res as DiagResult);
      setState('done');
    } catch {
      setState('err');
    }
  };

  const inputStyle = {
    background: 'var(--ds-bg)',
    borderColor: 'var(--ds-border)',
    color: 'var(--ds-text)',
  };

  return (
    <div className="ds-surface-panel rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none"
          style={inputStyle}
        />
        <button
          onClick={run}
          disabled={state === 'running' || !query.trim()}
          className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg disabled:opacity-40"
        >
          {state === 'running' ? '诊断中...' : '诊断'}
        </button>
      </div>
      {result && (
        <div className="text-[11px] space-y-2">
          {Object.entries(result).map(([domain, info]) => (
            <div key={domain} className="rounded-lg px-3 py-2" style={{
              background: info.status >= 200 && info.status < 400 ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)',
            }}>
              <div style={{ fontWeight: 600, color: 'var(--ds-text)' }}>{domain}</div>
              <div style={{ color: 'var(--ds-text-secondary)' }}>
                HTTP {info.status} · {info.length} 字节
                {info.error && <span style={{ color: 'var(--ds-danger)' }}> · 错误: {info.error}</span>}
              </div>
              {info.preview && (
                <div className="mt-1 p-2 rounded text-[10px] leading-relaxed" style={{
                  background: 'var(--ds-bg)', color: 'var(--ds-text-secondary)', maxHeight: 80, overflow: 'hidden',
                }}>
                  {info.preview.slice(0, 300)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLS = [
  {
    key: 'web_search',
    name: '搜索互联网 (web_search)',
    description: '在 Bing 搜索关键词，返回标题、URL 和摘要',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  {
    key: 'web_fetch',
    name: '获取网页 (web_fetch)',
    description: '下载指定 URL 并提取可视文本内容',
    icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
] as const;

type ToolKey = typeof TOOLS[number]['key'];

export default function ToolsPage() {
  const [settings, setSettings] = useState<Record<ToolKey, boolean>>({
    web_search: true,
    web_fetch: true,
  });
  const [permState, setPermState] = useState<PermissionState>('idle');
  const [permUrl, setPermUrl] = useState('');
  const [allSitesState, setAllSitesState] = useState<PermissionState>('idle');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_WEB_TOOL_SETTINGS' }).then((result: Record<string, boolean>) => {
      if (result) {
        setSettings((prev) => ({ ...prev, ...result }));
      }
    });
  }, []);

  const handleToggle = async (key: ToolKey, enabled: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: enabled }));
    await chrome.runtime.sendMessage({
      type: 'SET_WEB_TOOL_SETTING',
      payload: { name: key, enabled },
    });
  };

  const handleGrantPermission = async () => {
    const trimmed = permUrl.trim();
    if (!trimmed) return;
    let origin: string;
    try {
      origin = new URL(trimmed).origin + '/*';
    } catch {
      setPermState('error');
      return;
    }
    setPermState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: [origin] },
    });
    if (result?.ok) {
      setPermState('granted');
    } else {
      setPermState('denied');
    }
  };

  const handleGrantAllSites = async () => {
    setAllSitesState('granting');
    const result = await chrome.runtime.sendMessage({
      type: 'REQUEST_HOST_PERMISSION',
      payload: { origins: ['http://*/*', 'https://*/*'] },
    });
    setAllSitesState(result?.ok ? 'granted' : 'denied');
  };

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          工具开关
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          关闭后该工具不会注入到对话中，AI 将无法调用
        </p>
      </div>

      <div className="space-y-2">
        {TOOLS.map((tool) => (
          <div
            key={tool.key}
            className="ds-surface-panel rounded-xl p-4 flex items-start gap-3"
          >
            <svg
              className="w-5 h-5 shrink-0 mt-0.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              style={{ color: settings[tool.key] ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={tool.icon} />
            </svg>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div
                  className="text-xs font-medium truncate"
                  style={{ color: 'var(--ds-text)' }}
                >
                  {tool.name}
                </div>
                <button
                  onClick={() => handleToggle(tool.key, !settings[tool.key])}
                  className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
                  style={{
                    background: settings[tool.key] ? 'var(--ds-blue)' : 'var(--ds-border)',
                  }}
                >
                  <span
                    className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
                    style={{
                      transform: settings[tool.key] ? 'translateX(18px)' : 'translateX(0)',
                    }}
                  />
                </button>
              </div>
              <div
                className="text-[11px] mt-1 leading-relaxed"
                style={{ color: 'var(--ds-text-secondary)' }}
              >
                {tool.description}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="text-[11px] px-3 py-2 rounded-lg"
        style={{
          color: 'var(--ds-text-tertiary)',
          background: 'var(--ds-surface)',
        }}
      >
        关闭工具后，新对话将不再包含该工具的调用格式。已开启的对话不受影响。
      </div>

      {/* ---- 测试搜索 ---- */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          诊断搜索
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          直接测试搜索是否可用，绕过 AI 对话链路
        </p>
        <DiagSearch />
      </section>

      <section className="space-y-2">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          web_fetch 权限
        </h2>
        <p className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          获取网页需要访问对应站点的权限。在此输入网址并授予权限。
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://example.com"
            value={permUrl}
            onChange={(e) => { setPermUrl(e.target.value); setPermState('idle'); }}
            onKeyDown={(e) => e.key === 'Enter' && handleGrantPermission()}
            className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{
              background: 'var(--ds-bg)',
              borderColor: 'var(--ds-border)',
              color: 'var(--ds-text)',
            }}
          />
          <button
            onClick={handleGrantPermission}
            disabled={!permUrl.trim() || permState === 'granting'}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40 flex items-center gap-1.5"
          >
            {permState === 'granting' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            授权
          </button>
        </div>
        {permState === 'granted' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-success)', background: 'var(--ds-success-bg)' }}
          >
            权限已授予，可以访问该站点
          </div>
        )}
        {permState === 'denied' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}
          >
            权限被拒绝，请重试或前往 chrome://extensions 手动添加
          </div>
        )}
        {permState === 'error' && (
          <div
            className="text-[11px] px-3 py-2 rounded-lg"
            style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}
          >
            网址格式不正确，请输入完整 URL（如 https://example.com）
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={handleGrantAllSites}
            disabled={allSitesState === 'granting' || allSitesState === 'granted'}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-[12px] font-medium rounded-xl transition-all duration-150 disabled:opacity-50"
            style={{
              background: allSitesState === 'granted' ? 'var(--ds-success-bg)' : 'var(--ds-surface)',
              color: allSitesState === 'granted' ? 'var(--ds-success)' : 'var(--ds-blue)',
              border: `1px solid ${allSitesState === 'granted' ? 'var(--ds-success-border)' : 'var(--ds-blue)'}`,
            }}
          >
            {allSitesState === 'granting' ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : allSitesState === 'granted' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {allSitesState === 'granting'
              ? '请求中...'
              : allSitesState === 'granted'
                ? '已授权全部网站'
                : '授权全部网站'}
          </button>
          <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            一键授予扩展访问所有网站的权限，此后 web_fetch 获取任意页面不再弹窗
          </p>
        </div>
      </section>
    </div>
  );
}
