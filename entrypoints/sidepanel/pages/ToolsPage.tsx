import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import type { McpServerConfig, McpToolCacheEntry, ToolDescriptor } from '../../../core/types';
import PageIntro from '../components/PageIntro';
import { SettingsSection, StatusMessage, ToggleRow } from '../components/settings/primitives';
import { isMcpToolEnabled, mcpToolsController } from '../controllers/mcp-tools-controller';
import { useToolsPageController } from '../controllers/useToolsPageController';
import { useI18n } from '../i18n';

type DiagState = 'idle' | 'running' | 'done' | 'err';
type DiagResult = Record<string, { status: number; length: number; error?: string; preview?: string }>;

function DiagSearch() {
  const { t } = useI18n();
  const [query, setQuery] = useState(t('sidepanel.toolsPage.diagnosticsDefaultQuery'));
  const [state, setState] = useState<DiagState>('idle');
  const [result, setResult] = useState<DiagResult | null>(null);

  const run = async () => {
    setState('running');
    setResult(null);
    try {
      setResult(await mcpToolsController.diagnoseWebSearch(query));
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
          {state === 'running' ? t('sidepanel.toolsPage.diagnosticsRunning') : t('sidepanel.toolsPage.diagnosticsRun')}
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
                HTTP {info.status} · {t('sidepanel.toolsPage.bytes', { count: info.length })}
                {info.error && <span style={{ color: 'var(--ds-danger)' }}> · {t('sidepanel.toolsPage.errorPrefix', { error: info.error })}</span>}
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
    nameKey: 'sidepanel.toolsPage.webSearchName',
    descriptionKey: 'sidepanel.toolsPage.webSearchDescription',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  },
  {
    key: 'web_fetch',
    nameKey: 'sidepanel.toolsPage.webFetchName',
    descriptionKey: 'sidepanel.toolsPage.webFetchDescription',
    icon: 'M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
] as const satisfies readonly {
  key: string;
  nameKey: LocaleMessageKey;
  descriptionKey: LocaleMessageKey;
  icon: string;
}[];

type ToolKey = typeof TOOLS[number]['key'];

function PythonToolCard({
  server,
  cache,
  busy,
  message,
  messageTone,
  nativeMessagingSupported,
  onCreate,
  onRefresh,
  onToggle,
}: {
  server: McpServerConfig | null;
  cache: McpToolCacheEntry | null;
  busy: 'idle' | 'creating' | 'refreshing' | 'toggling';
  message: string;
  messageTone: 'success' | 'error' | 'warning' | 'info';
  nativeMessagingSupported: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const pythonStatus = cache?.descriptors.find((tool) => tool.name === 'python_status') ?? null;
  const pythonExec = cache?.descriptors.find((tool) => tool.name === 'python_exec') ?? null;
  const enabled = Boolean(server && pythonExec && isMcpToolEnabled(server, pythonExec));
  const hasShell = Boolean(server);
  const canToggle = Boolean(server && pythonExec && busy === 'idle');
  const statusText = !server
    ? nativeMessagingSupported
      ? t('sidepanel.toolsPage.pythonStatusNoShell')
      : t('sidepanel.toolsPage.pythonStatusUnsupported')
    : !cache
      ? t('sidepanel.toolsPage.pythonStatusNoCache')
      : pythonExec
        ? enabled ? t('sidepanel.toolsPage.pythonStatusEnabled') : t('sidepanel.toolsPage.pythonStatusDiscovered')
        : t('sidepanel.toolsPage.pythonStatusMissing');

  return (
    <div className="ds-surface-panel rounded-xl p-4 flex items-start gap-3">
      <svg
        className="w-5 h-5 shrink-0 mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        style={{ color: enabled ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" />
      </svg>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
              {t('sidepanel.toolsPage.pythonTitle')}
            </div>
            <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
              {statusText}
            </div>
          </div>
          <button
            onClick={onToggle}
            disabled={!canToggle}
            aria-pressed={enabled}
            aria-label={t('sidepanel.toolsPage.pythonTitle')}
            className="ds-switch relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-50"
            style={{ background: enabled ? 'var(--ds-blue)' : 'var(--ds-border)' }}
          >
            <span
              className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
              style={{ transform: enabled ? 'translateX(18px)' : 'translateX(0)' }}
            />
          </button>
        </div>

        <div className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.toolsPage.pythonDescription')}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          {!hasShell && (
            <button
              onClick={onCreate}
              disabled={busy !== 'idle' || !nativeMessagingSupported}
              className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md disabled:opacity-50"
            >
              {busy === 'creating' ? t('sidepanel.toolsPage.pythonCreating') : t('sidepanel.toolsPage.pythonCreate')}
            </button>
          )}
          {hasShell && (
            <button
              onClick={onRefresh}
              disabled={busy !== 'idle'}
              className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md disabled:opacity-50"
            >
              {busy === 'refreshing' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.toolsPage.pythonRefresh')}
            </button>
          )}
          {pythonStatus && (
            <span className="px-2 py-1 text-[10px] rounded-md" style={{ color: 'var(--ds-success)', background: 'var(--ds-success-bg)' }}>
              {t('sidepanel.toolsPage.pythonStatusAvailable')}
            </span>
          )}
        </div>

        {message && (
          <div className="mt-2">
            <StatusMessage tone={messageTone}>{message}</StatusMessage>
          </div>
        )}
        {server && cache && !pythonExec && (
          <div className="mt-2">
            <StatusMessage tone="error">{t('sidepanel.toolsPage.pythonMissingDetail')}</StatusMessage>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const { t } = useI18n();
  const {
    settings,
    settingsError,
    permState,
    permUrl,
    allSitesState,
    pythonServer,
    pythonCache,
    pythonBusy,
    pythonMessage,
    pythonMessageTone,
    nativeMessagingSupported,
    updatePermissionUrl,
    createPythonShell,
    refreshPythonTools,
    togglePython,
    toggleWebTool,
    grantPermission,
    grantAllSites,
  } = useToolsPageController(t);

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.toolsPage.toolTitle')}
        description={t('sidepanel.toolsPage.toolDescription')}
      />

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
              <ToggleRow
                title={t(tool.nameKey)}
                description={t(tool.descriptionKey)}
                enabled={settings[tool.key]}
                onToggle={(next) => toggleWebTool(tool.key, next)}
              />
            </div>
          </div>
        ))}
        <PythonToolCard
          server={pythonServer}
          cache={pythonCache}
          busy={pythonBusy}
          message={pythonMessage}
          messageTone={pythonMessageTone}
          nativeMessagingSupported={nativeMessagingSupported}
          onCreate={createPythonShell}
          onRefresh={refreshPythonTools}
          onToggle={togglePython}
        />
      </div>

      {settingsError && <StatusMessage tone="error">{settingsError}</StatusMessage>}

      <div
        className="text-[11px] px-3 py-2 rounded-lg"
        style={{
          color: 'var(--ds-text-tertiary)',
          background: 'var(--ds-surface)',
        }}
      >
        {t('sidepanel.toolsPage.disabledNotice')}
      </div>

      <SettingsSection
        title={t('sidepanel.toolsPage.diagnosticTitle')}
        description={t('sidepanel.toolsPage.diagnosticDescription')}
      >
        <DiagSearch />
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.toolsPage.permissionTitle')}
        description={t('sidepanel.toolsPage.permissionDescription')}
      >
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://example.com"
            value={permUrl}
            onChange={(e) => updatePermissionUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && grantPermission()}
            className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{
              background: 'var(--ds-bg)',
              borderColor: 'var(--ds-border)',
              color: 'var(--ds-text)',
            }}
          />
          <button
            onClick={grantPermission}
            disabled={!permUrl.trim() || permState === 'granting'}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40 flex items-center gap-1.5"
          >
            {permState === 'granting' ? (
              <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : null}
            {t('sidepanel.toolsPage.grantPermission')}
          </button>
        </div>
        {permState === 'granted' && (
          <StatusMessage tone="success">{t('sidepanel.toolsPage.permissionGranted')}</StatusMessage>
        )}
        {permState === 'denied' && (
          <StatusMessage tone="error">{t('sidepanel.toolsPage.permissionDenied')}</StatusMessage>
        )}
        {permState === 'error' && (
          <StatusMessage tone="error">{t('sidepanel.toolsPage.permissionInvalidUrl')}</StatusMessage>
        )}

        <div className="pt-1">
          <button
            onClick={grantAllSites}
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
              ? t('sidepanel.toolsPage.allSitesRequesting')
              : allSitesState === 'granted'
                ? t('sidepanel.toolsPage.allSitesGranted')
                : t('sidepanel.toolsPage.allSitesGrant')}
          </button>
          <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.toolsPage.allSitesHelp')}
          </p>
        </div>
      </SettingsSection>
    </div>
  );
}
