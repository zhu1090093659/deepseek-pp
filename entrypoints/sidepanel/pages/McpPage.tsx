import { useEffect, useState, type ReactNode } from 'react';
import {
  MULTIMODAL_MCP_PACKAGE_NAME,
} from '../../../core/multimodal';
import type { LocaleMessageKey, MessageParams, SupportedLocale } from '../../../core/i18n';
import type {
  McpHeaderValue,
  McpSecretValue,
  McpServerConfig,
  McpServerCreateInput,
  McpServerStatus,
  McpServerTransportConfig,
  McpToolCacheEntry,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolExecutionMode,
  PlatformEnvironment,
} from '../../../core/types';
import PageIntro from '../components/PageIntro';
import { useI18n } from '../i18n';
import {
  countEnabledMcpTools,
  getAllowedMcpTransportKinds,
  isMcpNativeMessagingSupported,
  isMcpToolEnabled,
  isMultimodalMcpServer,
  isShellMcpServer,
  mcpServerNeedsOriginPermission,
} from '../controllers/mcp-tools-controller';
import { useMcpPageController } from '../controllers/useMcpPageController';
import {
  SettingsSection,
  StatusMessage,
  ToggleRow,
  useConfirm,
} from '../components/settings/primitives';

type McpTransportKind = McpServerTransportConfig['kind'];
type BusyAction = 'refresh' | 'test' | 'permission';
type Translator = (key: LocaleMessageKey, params?: MessageParams) => string;

type FormState = {
  displayName: string;
  enabled: boolean;
  transportKind: McpTransportKind;
  url: string;
  nativeHost: string;
  command: string;
  args: string;
  cwd: string;
  env: string;
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  connectMs: string;
  requestMs: string;
  discoveryMs: string;
  maxResultBytes: string;
  maxToolCount: string;
  executionEnabled: boolean;
  executionMode: ToolExecutionMode;
};

const TRANSPORT_OPTIONS: { kind: McpTransportKind; label: string; hintKey: LocaleMessageKey }[] = [
  { kind: 'streamable_http', label: 'Streamable HTTP', hintKey: 'sidepanel.mcpPage.transportHints.streamableHttp' },
  { kind: 'http', label: 'HTTP', hintKey: 'sidepanel.mcpPage.transportHints.http' },
  { kind: 'sse', label: 'SSE', hintKey: 'sidepanel.mcpPage.transportHints.sse' },
  { kind: 'stdio_bridge', label: 'Stdio Bridge', hintKey: 'sidepanel.mcpPage.transportHints.stdioBridge' },
  { kind: 'native_messaging', label: 'Native', hintKey: 'sidepanel.mcpPage.transportHints.nativeMessaging' },
];

const DEFAULT_FORM: FormState = {
  displayName: '',
  enabled: true,
  transportKind: 'streamable_http',
  url: '',
  nativeHost: '',
  command: '',
  args: '',
  cwd: '',
  env: '',
  headers: [],
  secrets: [],
  connectMs: '10000',
  requestMs: '60000',
  discoveryMs: '20000',
  maxResultBytes: '64000',
  maxToolCount: '128',
  executionEnabled: true,
  executionMode: 'auto',
};

export default function McpPage() {
  const { t, locale } = useI18n();
  const { confirm, node: confirmNode } = useConfirm();
  const {
    servers,
    caches,
    mcpHistory,
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
    nativeMessagingSupported,
    startCreate,
    startEdit,
    cancelForm,
    createShellPreset,
    createMultimodalPreset,
    saveServer,
    removeServer,
    patchServer,
    requestPermission,
    refreshServer,
    toggleTool,
  } = useMcpPageController(t, confirm);

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.mcpPage.title')}
        description={t('sidepanel.mcpPage.description')}
        meta={t('sidepanel.mcpPage.summary', {
          servers: servers.length,
          enabled: enabledCount,
          tools: toolCount,
        })}
        actions={(
          <>
            <button
              onClick={createShellPreset}
              disabled={!nativeMessagingSupported}
              title={!nativeMessagingSupported ? t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') : undefined}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150 disabled:opacity-50"
            >
              {t('sidepanel.mcpPage.shell')}
            </button>
            <button
              onClick={createMultimodalPreset}
              disabled={!nativeMessagingSupported}
              title={!nativeMessagingSupported ? t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') : undefined}
              className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150 disabled:opacity-50"
            >
              {t('sidepanel.mcpPage.multimodal')}
            </button>
            <button
              onClick={startCreate}
              className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('sidepanel.mcpPage.addServer')}
            </button>
          </>
        )}
      />

      {banner && (
        <StatusMessage tone={banner.tone === 'info' ? 'success' : banner.tone}>
          {banner.text}
        </StatusMessage>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <McpServerForm
            key={editing?.id ?? 'create'}
            initial={editing}
            platform={platform}
            onSave={saveServer}
            onCancel={cancelForm}
          />
        </div>
      )}

      {confirmNode}

      {loading && servers.length === 0 ? (
        <EmptyState label={t('sidepanel.mcpPage.loading')} />
      ) : servers.length === 0 && !showForm ? (
        <EmptyState
          label={t('sidepanel.mcpPage.empty')}
          hint={t('sidepanel.mcpPage.emptyHint')}
          actions={
            <>
              <button
                onClick={startCreate}
                className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('sidepanel.mcpPage.emptyCreateAction')}
              </button>
              {nativeMessagingSupported && (
                <button
                  onClick={createShellPreset}
                  className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150"
                >
                  {t('sidepanel.mcpPage.emptyInstallShell')}
                </button>
              )}
            </>
          }
        />
      ) : (
        <div className="space-y-2">
          {servers.map((server) => {
            const isSelected = selected?.id === server.id;
            return (
              <div key={server.id} className="space-y-2">
                <ServerRow
                  server={server}
                  cache={caches[server.id] ?? null}
                  selected={isSelected}
                  expanded={isSelected}
                  onSelect={() => setSelectedId(isSelected ? null : server.id)}
                  onToggle={() => patchServer(server, { enabled: !server.enabled })}
                  onEdit={() => startEdit(server)}
                  onDelete={() => removeServer(server)}
                  t={t}
                />
                {isSelected && (
                  <ServerDetail
                    server={server}
                    cache={caches[server.id] ?? null}
                    history={mcpHistory}
                    busy={busy[server.id] ?? null}
                    onPatch={(patch) => patchServer(server, patch)}
                    onRequestPermission={() => requestPermission(server)}
                    onRefresh={() => refreshServer(server, 'refresh')}
                    onTest={() => refreshServer(server, 'test')}
                    onToggleTool={(tool) => toggleTool(server, tool)}
                    t={t}
                    locale={locale}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function McpServerForm({
  initial,
  platform,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null;
  platform: PlatformEnvironment | null;
  onSave: (payload: McpServerCreateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(() => initial ? formFromServer(initial) : DEFAULT_FORM);
  const [error, setError] = useState('');
  const supportedTransportKinds = getAllowedMcpTransportKinds(
    TRANSPORT_OPTIONS.map((item) => item.kind),
    platform,
  );
  const transportOptions = TRANSPORT_OPTIONS.filter((item) => supportedTransportKinds.includes(item.kind));
  const selectedTransport = transportOptions.find((item) => item.kind === form.transportKind) ?? transportOptions[0] ?? TRANSPORT_OPTIONS[0];

  useEffect(() => {
    if (supportedTransportKinds.includes(form.transportKind)) return;
    setForm((prev) => ({
      ...prev,
      transportKind: 'streamable_http',
      nativeHost: '',
    }));
  }, [form.transportKind, supportedTransportKinds.join('|')]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setTransportKind = (kind: McpTransportKind) => {
    setForm((prev) => ({ ...prev, transportKind: kind }));
  };

  const save = async () => {
    const result = payloadFromForm(form, t, platform);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError('');
    await onSave(result.payload);
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="ds-form rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {initial ? t('sidepanel.mcpPage.form.editTitle') : t('sidepanel.mcpPage.form.createTitle')}
        </div>
        <ToggleRow
          title={t('sidepanel.mcpPage.enabled')}
          enabled={form.enabled}
          onToggle={(next) => update('enabled', next)}
        />
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {error}
        </div>
      )}

      <SettingsSection title={t('sidepanel.mcpPage.form.basic')}>
        <Field label={t('sidepanel.mcpPage.form.name')}>
          <input
            value={form.displayName}
            onChange={(event) => update('displayName', event.target.value)}
            className="ds-input w-full rounded-lg px-3 py-2 text-sm"
            placeholder="Filesystem MCP"
          />
        </Field>

        <div>
          <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.mcpPage.form.transport')}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('sidepanel.mcpPage.form.transport')}>
            {transportOptions.map((item) => {
              const active = item.kind === form.transportKind;
              return (
                <button
                  key={item.kind}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTransportKind(item.kind)}
                  className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-all duration-150"
                  style={{
                    background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                    color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                    borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] mt-1.5" style={{ color: 'var(--ds-text-tertiary)' }}>{t(selectedTransport.hintKey)}</div>
        </div>

        {form.transportKind !== 'native_messaging' && (
          <Field
            label={form.transportKind === 'stdio_bridge' ? t('sidepanel.mcpPage.form.bridgeEndpointUrl') : t('sidepanel.mcpPage.form.serviceUrl')}
            hint={form.transportKind === 'stdio_bridge' ? t('sidepanel.mcpPage.form.bridgeEndpointHint') : undefined}
          >
            <input
              value={form.url}
              onChange={(event) => update('url', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder={form.transportKind === 'stdio_bridge' ? 'http://127.0.0.1:8765/mcp' : 'https://example.com/mcp'}
            />
          </Field>
        )}

        {form.transportKind === 'native_messaging' && (
          <Field label="Native Host">
            <input
              value={form.nativeHost}
              onChange={(event) => update('nativeHost', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="com.example.mcp_host"
            />
          </Field>
        )}
      </SettingsSection>

      {form.transportKind === 'stdio_bridge' && (
        <SettingsSection title={t('sidepanel.mcpPage.form.stdioSection')}>
          <Field label={t('sidepanel.mcpPage.form.command')}>
            <input
              value={form.command}
              onChange={(event) => update('command', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="npx"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.args')}>
            <input
              value={form.args}
              onChange={(event) => update('args', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.cwd')}>
            <input
              value={form.cwd}
              onChange={(event) => update('cwd', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="/Users/me/project"
            />
          </Field>
          <Field label={t('sidepanel.mcpPage.form.env')}>
            <textarea
              value={form.env}
              onChange={(event) => update('env', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm min-h-18 resize-y"
              placeholder={'KEY=value\nTOKEN=...'}
            />
          </Field>
        </SettingsSection>
      )}

      <div>
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium w-full"
          style={{ color: 'var(--ds-text-secondary)' }}
        >
          <svg
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {t('sidepanel.mcpPage.form.advanced')}
          <span className="text-[10px] font-normal" style={{ color: 'var(--ds-text-tertiary)' }}>
            · {t('sidepanel.mcpPage.form.advancedHint')}
          </span>
        </button>
        {advancedOpen && (
          <div className="mt-2 space-y-3">
            {form.transportKind !== 'native_messaging' && (
              <HeaderEditor
                headers={form.headers}
                secrets={form.secrets}
                onHeadersChange={(headers) => update('headers', headers)}
                onSecretsChange={(secrets) => update('secrets', secrets)}
              />
            )}

            <div className="grid grid-cols-3 gap-2">
              <NumberField label={t('sidepanel.mcpPage.form.connectMs')} value={form.connectMs} onChange={(value) => update('connectMs', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.requestMs')} value={form.requestMs} onChange={(value) => update('requestMs', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.discoveryMs')} value={form.discoveryMs} onChange={(value) => update('discoveryMs', value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('sidepanel.mcpPage.form.resultBytes')} value={form.maxResultBytes} onChange={(value) => update('maxResultBytes', value)} />
              <NumberField label={t('sidepanel.mcpPage.form.toolLimit')} value={form.maxToolCount} onChange={(value) => update('maxToolCount', value)} />
            </div>

            <div className="ds-surface-panel rounded-lg p-3 space-y-2">
              <ToggleRow
                title={t('sidepanel.mcpPage.form.defaultExecution')}
                description={t('sidepanel.mcpPage.form.allowInject')}
                enabled={form.executionEnabled}
                onToggle={(next) => update('executionEnabled', next)}
              />
              <select
                value={form.executionMode}
                onChange={(event) => update('executionMode', event.target.value as ToolExecutionMode)}
                className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              >
                <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
                <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
                <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg transition-colors">
          {t('common.cancel')}
        </button>
        <button onClick={save} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors">
          {t('sidepanel.mcpPage.form.save')}
        </button>
      </div>
    </div>
  );
}

function HeaderEditor({
  headers,
  secrets,
  onHeadersChange,
  onSecretsChange,
}: {
  headers: McpHeaderValue[];
  secrets: McpSecretValue[];
  onHeadersChange: (headers: McpHeaderValue[]) => void;
  onSecretsChange: (secrets: McpSecretValue[]) => void;
}) {
  const { t } = useI18n();
  const updateHeader = (index: number, patch: Partial<McpHeaderValue>) => {
    onHeadersChange(headers.map((header, itemIndex) => itemIndex === index ? { ...header, ...patch } : header));
  };
  const updateSecret = (index: number, patch: Partial<McpSecretValue>) => {
    onSecretsChange(secrets.map((secret, itemIndex) => itemIndex === index ? { ...secret, ...patch } : secret));
  };

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Headers</span>
        <button
          onClick={() => onHeadersChange([...headers, { name: '', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </button>
      </div>
      {headers.map((header, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <input
            value={header.name}
            onChange={(event) => updateHeader(index, { name: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerName')}
          />
          <input
            value={header.value}
            onChange={(event) => updateHeader(index, { value: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder={t('sidepanel.mcpPage.headers.headerValue')}
          />
          <button
            onClick={() => onHeadersChange(headers.filter((_, itemIndex) => itemIndex !== index))}
            className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
          >
            ×
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>Secrets</span>
        <button
          onClick={() => onSecretsChange([...secrets, { id: crypto.randomUUID(), kind: 'bearer', value: '' }])}
          className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
        >
          {t('common.add')}
        </button>
      </div>
      {secrets.map((secret, index) => (
        <div key={index} className="space-y-1.5">
          <div className="grid grid-cols-[90px_1fr_auto] gap-1.5">
            <select
              value={secret.kind}
              onChange={(event) => updateSecret(index, { kind: event.target.value as McpSecretValue['kind'] })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            >
              <option value="bearer">Bearer</option>
              <option value="basic">Basic</option>
              <option value="header">Header</option>
            </select>
            <input
              value={secret.value}
              onChange={(event) => updateSecret(index, { value: event.target.value })}
              className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretValue')}
              type="password"
            />
            <button
              onClick={() => onSecretsChange(secrets.filter((_, itemIndex) => itemIndex !== index))}
              className="ds-action-btn ds-action-btn-delete w-8 rounded-lg text-xs"
            >
              ×
            </button>
          </div>
          {secret.kind === 'header' && (
            <input
              value={secret.headerName ?? ''}
              onChange={(event) => updateSecret(index, { headerName: event.target.value })}
              className="ds-input w-full rounded-lg px-2 py-1.5 text-xs"
              placeholder={t('sidepanel.mcpPage.headers.secretHeaderName')}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ServerRow({
  server,
  cache,
  selected,
  expanded,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  t: Translator;
}) {
  const status = statusMeta(cache?.health.status ?? server.status, t);
  const activeTools = countEnabledMcpTools(server, cache?.descriptors ?? []);

  return (
    <div
      className="ds-card rounded-lg p-3 cursor-pointer transition-colors"
      style={{ borderColor: selected ? 'var(--ds-selected-border)' : undefined }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg
            className="w-3 h-3 shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)', color: 'var(--ds-text-tertiary)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-sm font-medium truncate" style={{ color: 'var(--ds-text)' }}>{server.displayName}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: status.color, background: status.bg }}>
            {status.label}
          </span>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <ToggleRow
            title={t('sidepanel.mcpPage.enabled')}
            enabled={server.enabled}
            onToggle={onToggle}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-1.5 pl-5">
        <div className="text-[11px] truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
          {transportLabel(server.transport.kind)} · {t('sidepanel.mcpPage.row.autoTools', {
            active: activeTools,
            total: cache?.descriptors.length ?? 0,
          })}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(event) => event.stopPropagation()}>
          <button onClick={onEdit} className="ds-action-btn ds-action-btn-edit px-2 py-1 text-[11px] rounded-md">
            {t('common.edit')}
          </button>
          <button onClick={onDelete} className="ds-action-btn ds-action-btn-delete px-2 py-1 text-[11px] rounded-md">
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerDetail({
  server,
  cache,
  history,
  busy,
  onPatch,
  onRequestPermission,
  onRefresh,
  onTest,
  onToggleTool,
  t,
  locale,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  history: ToolCallHistoryRecord[];
  busy: BusyAction | null;
  onPatch: (patch: Partial<McpServerConfig>) => Promise<void>;
  onRequestPermission: () => void;
  onRefresh: () => void;
  onTest: () => void;
  onToggleTool: (tool: ToolDescriptor) => void;
  t: Translator;
  locale: SupportedLocale;
}) {
  const tools = cache?.descriptors ?? [];
  const serverHistory = history.filter((record) => record.call.provider?.id === server.id).slice(0, 5);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3 animate-slide-down">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] truncate" style={{ color: 'var(--ds-text-tertiary)' }}>{endpointLabel(server)}</div>
        </div>
        <div className="flex gap-1.5">
          {mcpServerNeedsOriginPermission(server) && (
            <button onClick={onRequestPermission} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
              {t('sidepanel.mcpPage.detail.grant')}
            </button>
          )}
          <button onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'test' ? t('sidepanel.mcpPage.row.testing') : t('common.test')}
          </button>
          <button onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'refresh' ? t('sidepanel.toolsPage.pythonRefreshing') : t('sidepanel.mcpPage.row.refreshTools')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label={t('sidepanel.mcpPage.detail.status')} value={statusMeta(cache?.health.status ?? server.status, t).label} />
        <Metric label={t('sidepanel.mcpPage.detail.latency')} value={formatMs(cache?.health.latencyMs ?? null)} />
        <Metric label={t('sidepanel.mcpPage.detail.lastConnected')} value={formatTime(server.lastConnectedAt ?? cache?.health.checkedAt ?? null, locale)} />
        <Metric label={t('sidepanel.mcpPage.detail.transport')} value={transportLabel(server.transport.kind)} />
      </div>

      {(cache?.health.error || server.lastError) && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {cache?.health.error ?? server.lastError}
        </div>
      )}

      {isShellMcpServer(server) && (
        <ShellSetupHint server={server} cache={cache} t={t} />
      )}

      {isMultimodalMcpServer(server) && (
        <MultimodalSetupHint server={server} cache={cache} t={t} />
      )}

      <div className="ds-card rounded-lg p-3 space-y-2">
        <ToggleRow
          title={t('sidepanel.mcpPage.detail.executionPolicy')}
          description={t('sidepanel.mcpPage.detail.injectionSummary', { count: countEnabledMcpTools(server, tools) })}
          enabled={server.execution.enabled}
          onToggle={(next) => onPatch({ execution: { ...server.execution, enabled: next } })}
        />
        <select
          value={server.execution.mode}
          onChange={(event) => onPatch({ execution: { ...server.execution, mode: event.target.value as ToolExecutionMode } })}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">{t('sidepanel.mcpPage.form.modeAuto')}</option>
          <option value="manual">{t('sidepanel.mcpPage.form.modeManual')}</option>
          <option value="disabled">{t('sidepanel.mcpPage.form.modeDisabled')}</option>
        </select>
      </div>

      <CollapsibleSection
        label={t('sidepanel.mcpPage.detail.discoveredTools')}
        count={tools.length}
        defaultOpen
      >
        {tools.length === 0 ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noTools')}
          </div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolRow key={tool.id} server={server} tool={tool} onToggle={() => onToggleTool(tool)} t={t} />
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        label={t('sidepanel.mcpPage.detail.recentCalls')}
        count={serverHistory.length}
        defaultOpen={false}
        open={historyOpen}
        onToggle={() => setHistoryOpen((prev) => !prev)}
      >
        {serverHistory.length === 0 ? (
          <div className="text-xs py-3 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.mcpPage.detail.noHistory')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {serverHistory.map((record) => (
              <div key={record.id} className="ds-card rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
                    {record.call.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: record.result.ok ? 'var(--ds-success)' : 'var(--ds-danger)', background: record.result.ok ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)' }}>
                    {record.result.ok ? t('sidepanel.mcpPage.success') : t('sidepanel.mcpPage.failure')}
                  </span>
                </div>
                <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {formatTime(record.createdAt, locale)} · {record.result.summary}
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}

function CollapsibleSection({
  label,
  count,
  defaultOpen,
  open: openProp,
  onToggle: onToggleProp,
  children,
}: {
  label: string;
  count: number;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : internalOpen;
  const toggle = () => (isControlled ? onToggleProp?.() : setInternalOpen((prev) => !prev));
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between w-full gap-2"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
          <svg
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', color: 'var(--ds-text-tertiary)' }}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {label}
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}>
            {count}
          </span>
        </span>
      </button>
      {open && children}
    </div>
  );
}

function ToolRow({
  server,
  tool,
  onToggle,
  t,
}: {
  server: McpServerConfig;
  tool: ToolDescriptor;
  onToggle: () => void;
  t: Translator;
}) {
  const enabled = isMcpToolEnabled(server, tool);
  return (
    <div className="ds-card rounded-lg px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>{tool.title || tool.name}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-blue)' }}>{tool.invocationName}</div>
        </div>
        <ToggleRow
          title={enabled ? t('sidepanel.mcpPage.auto') : t('sidepanel.mcpPage.disabled')}
          enabled={enabled}
          onToggle={onToggle}
        />
      </div>
      <div className="text-[11px] mt-1 leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
        {tool.description}
      </div>
      <div className="text-[10px] mt-2 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
        {schemaSummary(tool, t)}
      </div>
    </div>
  );
}

function EmptyState({ label, hint, actions }: { label: string; hint?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-surface)' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: 'var(--ds-text-tertiary)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5h3a3 3 0 110 6h-3m-3-6h-3a3 3 0 100 6h3m-1.5-3h6" />
        </svg>
      </div>
      <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</p>
      {hint && <p className="text-[11px] -mt-1 max-w-[240px]" style={{ color: 'var(--ds-text-tertiary)' }}>{hint}</p>}
      {actions && <div className="flex flex-wrap gap-2 justify-center mt-1">{actions}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>{hint}</span>}
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Field label={label}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ds-input w-full rounded-lg px-2 py-1.5 text-xs"
        inputMode="numeric"
      />
    </Field>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: 'var(--ds-bg)', border: '1px solid var(--ds-border)' }}>
      <div style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="mt-0.5 truncate" style={{ color: 'var(--ds-text)' }}>{value}</div>
    </div>
  );
}

function formFromServer(server: McpServerConfig): FormState {
  return {
    displayName: server.displayName,
    enabled: server.enabled,
    transportKind: server.transport.kind,
    url: server.transport.url ?? '',
    nativeHost: server.transport.nativeHost ?? '',
    command: server.transport.command ?? '',
    args: server.transport.args?.join(' ') ?? '',
    cwd: server.transport.cwd ?? '',
    env: Object.entries(server.transport.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n'),
    headers: server.headers.length > 0 ? server.headers : [],
    secrets: server.secrets.length > 0 ? server.secrets : [],
    connectMs: String(server.timeouts.connectMs),
    requestMs: String(server.timeouts.requestMs),
    discoveryMs: String(server.timeouts.discoveryMs),
    maxResultBytes: String(server.limits.maxResultBytes),
    maxToolCount: String(server.limits.maxToolCount),
    executionEnabled: server.execution.enabled,
    executionMode: server.execution.mode,
  };
}

function payloadFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { payload: McpServerCreateInput } | { error: string } {
  const displayName = form.displayName.trim();
  if (!displayName) return { error: t('sidepanel.mcpPage.validation.nameRequired') };

  const timeouts = {
    connectMs: positiveInt(form.connectMs, t('sidepanel.mcpPage.form.connectMs'), t),
    requestMs: positiveInt(form.requestMs, t('sidepanel.mcpPage.form.requestMs'), t),
    discoveryMs: positiveInt(form.discoveryMs, t('sidepanel.mcpPage.form.discoveryMs'), t),
  };
  const limits = {
    maxResultBytes: positiveInt(form.maxResultBytes, t('sidepanel.mcpPage.form.resultBytes'), t),
    maxToolCount: positiveInt(form.maxToolCount, t('sidepanel.mcpPage.form.toolLimit'), t),
  };
  const invalidNumber = Object.values(timeouts).find((value) => typeof value === 'string') ||
    Object.values(limits).find((value) => typeof value === 'string');
  if (typeof invalidNumber === 'string') return { error: invalidNumber };

  const transportResult = transportFromForm(form, t, platform);
  if ('error' in transportResult) return transportResult;

  const headersResult = normalizeHeaders(form.headers, t);
  if ('error' in headersResult) return headersResult;

  const secretsResult = normalizeSecrets(form.secrets, t);
  if ('error' in secretsResult) return secretsResult;

  return {
    payload: {
      displayName,
      enabled: form.enabled,
      transport: transportResult.transport,
      headers: headersResult.headers,
      secrets: secretsResult.secrets,
      timeouts: timeouts as { connectMs: number; requestMs: number; discoveryMs: number },
      limits: limits as { maxResultBytes: number; maxToolCount: number },
      allowlist: {
        mode: 'all',
        toolNames: [],
      },
      execution: {
        enabled: form.executionEnabled,
        mode: form.executionMode,
      },
    },
  };
}

function transportFromForm(
  form: FormState,
  t: Translator,
  platform: PlatformEnvironment | null,
): { transport: McpServerTransportConfig } | { error: string } {
  if (form.transportKind === 'native_messaging') {
    if (!isMcpNativeMessagingSupported(platform)) {
      return { error: t('sidepanel.mcpPage.messages.nativeMessagingUnsupported') };
    }
    const nativeHost = form.nativeHost.trim();
    if (!nativeHost) return { error: t('sidepanel.mcpPage.validation.nativeHostRequired') };
    if (!/^[A-Za-z0-9_.-]+$/.test(nativeHost)) return { error: t('sidepanel.mcpPage.validation.nativeHostInvalid') };
    return { transport: { kind: 'native_messaging', nativeHost } };
  }

  const url = form.url.trim();
  if (!url) {
    return {
      error: t(form.transportKind === 'stdio_bridge'
        ? 'sidepanel.mcpPage.validation.bridgeEndpointRequired'
        : 'sidepanel.mcpPage.validation.serviceUrlRequired'),
    };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: t('sidepanel.mcpPage.validation.serviceUrlUnsupported') };
  } catch {
    return { error: t('sidepanel.mcpPage.validation.serviceUrlInvalid') };
  }

  if (form.transportKind !== 'stdio_bridge') {
    return { transport: { kind: form.transportKind, url } };
  }

  const env = parseEnv(form.env, t);
  if ('error' in env) return env;
  const command = form.command.trim();
  return {
    transport: {
      kind: 'stdio_bridge',
      url,
      command,
      args: command ? form.args.split(/\s+/).map((item) => item.trim()).filter(Boolean) : [],
      cwd: form.cwd.trim(),
      env: env.env,
    },
  };
}

function normalizeHeaders(headers: McpHeaderValue[], t: Translator): { headers: McpHeaderValue[] } | { error: string } {
  const normalized: McpHeaderValue[] = [];
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value;
    if (!name && !value) continue;
    if (!isHeaderName(name)) {
      return {
        error: t('sidepanel.mcpPage.validation.headerInvalidName', {
          name: name || t('sidepanel.mcpPage.validation.emptyValue'),
        }),
      };
    }
    if (value.includes('\n') || value.includes('\r')) {
      return { error: t('sidepanel.mcpPage.validation.headerInvalidValue', { name }) };
    }
    normalized.push({ name, value });
  }
  return { headers: normalized };
}

function normalizeSecrets(secrets: McpSecretValue[], t: Translator): { secrets: McpSecretValue[] } | { error: string } {
  const normalized: McpSecretValue[] = [];
  for (const secret of secrets) {
    const value = secret.value.trim();
    const headerName = secret.headerName?.trim();
    if (!value && !headerName && !secret.username) continue;
    if (secret.kind === 'header' && !isHeaderName(headerName ?? '')) {
      return { error: t('sidepanel.mcpPage.validation.headerSecretRequired') };
    }
    normalized.push({
      id: secret.id || crypto.randomUUID(),
      kind: secret.kind,
      value,
      headerName,
      username: secret.username?.trim(),
    });
  }
  return { secrets: normalized };
}

function parseEnv(value: string, t: Translator): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf('=');
    if (index <= 0) return { error: t('sidepanel.mcpPage.validation.envInvalid', { line }) };
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return { env };
}

function positiveInt(value: string, label: string, t: Translator): number | string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return t('sidepanel.mcpPage.validation.positiveInteger', { label });
  }
  return parsed;
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function schemaSummary(tool: ToolDescriptor, t: Translator): string {
  const props = Object.keys(tool.inputSchema.properties ?? {});
  const required = tool.inputSchema.required ?? [];
  if (props.length === 0) return t('sidepanel.mcpPage.detail.schemaNone');
  return t('sidepanel.mcpPage.detail.schemaSummary', {
    props: `${props.slice(0, 6).join(', ')}${props.length > 6 ? '...' : ''}`,
    required: required.length
      ? t('sidepanel.mcpPage.detail.schemaRequired', { required: required.join(', ') })
      : '',
  });
}

function statusMeta(status: McpServerStatus, t: Translator) {
  if (status === 'ready') return { label: t('sidepanel.mcpPage.status.ready'), color: 'var(--ds-success)', bg: 'var(--ds-success-bg)' };
  if (status === 'error') return { label: t('sidepanel.mcpPage.status.error'), color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' };
  if (status === 'disabled') return { label: t('sidepanel.mcpPage.status.disabled'), color: 'var(--ds-text-tertiary)', bg: 'var(--ds-surface)' };
  return { label: t('sidepanel.mcpPage.status.unknown'), color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' };
}

function ShellSetupHint({
  server,
  cache,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  t: Translator;
}) {
  const { message, isError } = shellSetupMessage(server, cache, t);
  const setup = shellInstallCommand();
  return (
    <NativeHostHint
      title="Shell Native Host"
      message={message}
      isError={isError}
      ready={cache?.health.status === 'ready'}
      setup={setup}
      installSteps={(<>
        <div style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.mode === 'local'
            ? t('sidepanel.mcpPage.shellSetup.localIntro')
            : t('sidepanel.mcpPage.shellSetup.publishedIntro')}
        </div>
        <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
          {setup.command}
        </div>
        {setup.fallbackCommand && (
          <>
            <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.mcpPage.shellSetup.fallbackIntro')}
            </div>
            <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
              {setup.fallbackCommand}
            </div>
          </>
        )}
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.usesExtensionId
            ? t('sidepanel.mcpPage.shellSetup.detectedExtensionId', { browser: browserLabel(setup.browser) })
            : t('sidepanel.mcpPage.shellSetup.firefoxFixedId')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.shellSetup.installNote')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {!server.enabled
            ? t('sidepanel.mcpPage.shellSetup.enableAndTest')
            : t('sidepanel.mcpPage.shellSetup.restartAndTest')}
        </div>
      </>)}
      t={t}
    />
  );
}

function MultimodalSetupHint({
  server,
  cache,
  t,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  t: Translator;
}) {
  const { message, isError } = nativeSetupMessage(server, cache, t, 'multimodal');
  const setup = multimodalInstallCommand();
  return (
    <NativeHostHint
      title="Multimodal Native Host"
      message={message}
      isError={isError}
      ready={cache?.health.status === 'ready'}
      setup={setup}
      installSteps={(<>
        <div style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.mode === 'local'
            ? t('sidepanel.mcpPage.multimodalSetup.localIntro')
            : t('sidepanel.mcpPage.multimodalSetup.publishedIntro')}
        </div>
        <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
          {setup.command}
        </div>
        {setup.fallbackCommand && (
          <>
            <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.mcpPage.multimodalSetup.fallbackIntro')}
            </div>
            <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
              {setup.fallbackCommand}
            </div>
          </>
        )}
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {setup.usesExtensionId
            ? t('sidepanel.mcpPage.shellSetup.detectedExtensionId', { browser: browserLabel(setup.browser) })
            : t('sidepanel.mcpPage.shellSetup.firefoxFixedId')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.multimodalSetup.settingsNote')}
        </div>
        <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
          {!server.enabled
            ? t('sidepanel.mcpPage.multimodalSetup.enableAndTest')
            : t('sidepanel.mcpPage.shellSetup.restartAndTest')}
        </div>
      </>)}
      t={t}
    />
  );
}

function NativeHostHint({
  title,
  message,
  isError,
  ready,
  installSteps,
  t,
}: {
  title: string;
  message: string;
  isError: boolean;
  ready: boolean;
  setup: { mode: string };
  installSteps: ReactNode;
  t: Translator;
}) {
  // Expanded by default on error / not-installed; collapsed when already connected.
  // The toggle is fully user-controlled — initial state is derived from `ready`
  // via a lazy initializer so subsequent re-renders (frequent load() refreshes)
  // never reset the user's choice.
  const [open, setOpen] = useState(() => !ready);
  return (
    <div className="ds-card rounded-lg px-3 py-2 text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1.5 w-full"
      >
        <svg
          className="w-3 h-3 transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', color: 'var(--ds-text-tertiary)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium" style={{ color: 'var(--ds-text)' }}>{title}</span>
      </button>
      {open ? (
        <>
          {isError ? (
            <div className="rounded px-2 py-1 mt-1.5 mb-1.5" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger)' }}>
              {message}
            </div>
          ) : (
            <div className="mt-1">{message}</div>
          )}
          <div className="mt-1.5 space-y-0.5">{installSteps}</div>
        </>
      ) : (
        <div className="mt-1 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.mcpPage.detail.hintExpand')}
        </div>
      )}
    </div>
  );
}

type NativeHostBrowser = 'chrome' | 'chromium' | 'edge' | 'firefox';

function shellInstallCommand(): {
  browser: NativeHostBrowser;
  command: string;
  fallbackCommand?: string;
  usesExtensionId: boolean;
  mode: 'local' | 'published';
} {
  const browser = currentNativeHostBrowser();
  const usesExtensionId = browser !== 'firefox';
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<extension-id>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg} --skip-officecli`;
  const localCommand = `npm run shell:install -- ${installArgs}`;
  const publishedCommand = `npx deepseek-pp-shell-host ${installArgs}`;

  if (isUnpackedExtension()) {
    return { browser, command: localCommand, fallbackCommand: publishedCommand, usesExtensionId, mode: 'local' };
  }

  return { browser, command: publishedCommand, usesExtensionId, mode: 'published' };
}

function multimodalInstallCommand(): {
  browser: NativeHostBrowser;
  command: string;
  fallbackCommand?: string;
  usesExtensionId: boolean;
  mode: 'local' | 'published';
} {
  const browser = currentNativeHostBrowser();
  const usesExtensionId = browser !== 'firefox';
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<extension-id>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg}`;
  const localCommand = `npm run multimodal:install -- ${installArgs}`;
  const publishedCommand = `npx ${MULTIMODAL_MCP_PACKAGE_NAME} ${installArgs}`;

  if (isUnpackedExtension()) {
    return { browser, command: localCommand, fallbackCommand: publishedCommand, usesExtensionId, mode: 'local' };
  }

  return { browser, command: publishedCommand, usesExtensionId, mode: 'published' };
}

function isUnpackedExtension(): boolean {
  return !chrome.runtime.getManifest().update_url;
}

function currentNativeHostBrowser(): NativeHostBrowser {
  const ua = navigator.userAgent;
  if (/\bFirefox\//.test(ua)) return 'firefox';
  if (/\bEdg\//.test(ua)) return 'edge';
  if (/\bChromium\//.test(ua) && !/\bChrome\//.test(ua)) return 'chromium';
  return 'chrome';
}

function browserLabel(browser: NativeHostBrowser): string {
  if (browser === 'edge') return 'Edge';
  if (browser === 'firefox') return 'Firefox';
  if (browser === 'chromium') return 'Chromium';
  return 'Chrome';
}

function shellSetupMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
): { message: string; isError: boolean } {
  return nativeSetupMessage(server, cache, t, 'shell');
}

function nativeSetupMessage(
  server: McpServerConfig,
  cache: McpToolCacheEntry | null,
  t: Translator,
  kind: 'shell' | 'multimodal',
): { message: string; isError: boolean } {
  const setupKey = kind === 'shell' ? 'sidepanel.mcpPage.shellSetup' : 'sidepanel.mcpPage.multimodalSetup';
  const error = `${cache?.health.error ?? ''} ${server.lastError ?? ''}`.toLowerCase();
  if (error.includes('forbidden')) {
    return { message: t(`${setupKey}.forbidden` as LocaleMessageKey), isError: true };
  }
  if (error.includes('native_host_unavailable') || error.includes('native messaging host not found') || error.includes('not found') || error.includes('specified native messaging host')) {
    return { message: t(`${setupKey}.notFound` as LocaleMessageKey), isError: true };
  }
  if (error.includes('native_messaging_unavailable')) {
    return { message: t('sidepanel.mcpPage.shellSetup.unavailable'), isError: true };
  }
  if (
    error.includes('failed to fetch') ||
    error.includes('mcp_network_error') ||
    error.includes('cannot reach') ||
    error.includes('connection refused')
  ) {
    return { message: t(`${setupKey}.cannotConnect` as LocaleMessageKey), isError: true };
  }
  if (cache?.health.status === 'ready') {
    return { message: t(`${setupKey}.ready` as LocaleMessageKey, { count: cache.health.toolCount }), isError: false };
  }
  if (!server.enabled) {
    return { message: t(`${setupKey}.disabled` as LocaleMessageKey), isError: false };
  }
  return { message: t(`${setupKey}.installFirst` as LocaleMessageKey), isError: false };
}

function transportLabel(kind: McpTransportKind): string {
  return TRANSPORT_OPTIONS.find((item) => item.kind === kind)?.label ?? kind;
}

function endpointLabel(server: McpServerConfig): string {
  if (server.transport.kind === 'native_messaging') return server.transport.nativeHost || 'Native Messaging';
  if (server.transport.kind === 'stdio_bridge') return `${server.transport.url || 'Bridge URL'} · ${server.transport.command || 'command'}`;
  return server.transport.url || transportLabel(server.transport.kind);
}

function formatMs(value: number | null | undefined): string {
  return typeof value === 'number' ? `${value} ms` : '-';
}

function formatTime(value: number | null | undefined, locale?: SupportedLocale): string {
  if (!value) return '-';
  return new Date(value).toLocaleString(locale);
}
