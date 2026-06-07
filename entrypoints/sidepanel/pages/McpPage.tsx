import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SHELL_MCP_NATIVE_HOST,
  SHELL_MCP_SERVER_NAME,
  createShellMcpPresetInput,
} from '../../../core/shell';
import type {
  McpHeaderValue,
  McpSecretValue,
  McpServerConfig,
  McpServerCreateInput,
  McpServerStatus,
  McpServerTransportConfig,
  McpToolAllowlist,
  McpToolCacheEntry,
  ToolCallHistoryRecord,
  ToolDescriptor,
  ToolExecutionMode,
} from '../../../core/types';

type McpTransportKind = McpServerTransportConfig['kind'];
type CacheByServer = Record<string, McpToolCacheEntry | null>;
type BusyAction = 'refresh' | 'test' | 'permission';

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

const TRANSPORT_OPTIONS: { kind: McpTransportKind; label: string; hint: string }[] = [
  { kind: 'streamable_http', label: 'Streamable HTTP', hint: '推荐，兼容新版 MCP HTTP 服务' },
  { kind: 'http', label: 'HTTP', hint: 'JSON-RPC over HTTP POST' },
  { kind: 'sse', label: 'SSE', hint: '旧版 MCP SSE 传输' },
  { kind: 'stdio_bridge', label: 'Stdio Bridge', hint: '本地桥接服务负责启动 stdio MCP 和文件访问边界' },
  { kind: 'native_messaging', label: 'Native', hint: '通过 Browser Native Messaging Host 访问本机能力' },
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
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [caches, setCaches] = useState<CacheByServer>({});
  const [history, setHistory] = useState<ToolCallHistoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [busy, setBusy] = useState<Record<string, BusyAction | null>>({});
  const [message, setMessage] = useState('');

  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;
  const selectedCache = selected ? caches[selected.id] ?? null : null;
  const enabledCount = servers.filter((server) => server.enabled).length;
  const toolCount = useMemo(
    () => servers.reduce((sum, server) => sum + enabledToolCount(server, caches[server.id]?.descriptors ?? []), 0),
    [servers, caches],
  );
  const mcpHistory = history.filter((record) => record.call.provider?.kind === 'mcp');

  const load = async () => {
    setLoading(true);
    try {
      const list: McpServerConfig[] = await chrome.runtime.sendMessage({ type: 'GET_MCP_SERVERS' });
      const nextServers = list ?? [];
      setServers(nextServers);
      setSelectedId((current) => {
        if (current && nextServers.some((server) => server.id === current)) return current;
        return nextServers[0]?.id ?? null;
      });

      const cacheEntries = await Promise.all(
        nextServers.map(async (server) => {
          const cache: McpToolCacheEntry | null = await chrome.runtime.sendMessage({
            type: 'GET_MCP_TOOL_CACHE',
            payload: { serverId: server.id },
          });
          return [server.id, cache] as const;
        }),
      );
      setCaches(Object.fromEntries(cacheEntries));

      const recent: ToolCallHistoryRecord[] = await chrome.runtime.sendMessage({
        type: 'GET_TOOL_CALL_HISTORY',
        payload: { limit: 12 },
      });
      setHistory(recent ?? []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '加载 MCP 配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleUpdate = (msg: { type?: string; servers?: McpServerConfig[] }) => {
      if (msg.type === 'MCP_SERVERS_UPDATED' && Array.isArray(msg.servers)) {
        setServers(msg.servers);
      }
      if (
        msg.type === 'MCP_SERVERS_UPDATED' ||
        msg.type === 'TOOL_DESCRIPTORS_UPDATED' ||
        msg.type === 'TOOL_CALL_HISTORY_UPDATED'
      ) {
        void load();
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setMessage('');
    setShowForm((prev) => !prev);
  };

  const createShellPreset = async () => {
    setMessage('');
    const existing = servers.find((server) =>
      server.displayName === SHELL_MCP_SERVER_NAME ||
      server.transport.nativeHost === SHELL_MCP_NATIVE_HOST
    );
    if (existing) {
      setSelectedId(existing.id);
      setMessage('Shell MCP 已存在，已选中现有配置');
      return;
    }

    const server: McpServerConfig | null = await chrome.runtime.sendMessage({
      type: 'CREATE_MCP_SERVER',
      payload: createShellMcpPresetInput(),
    });
    if (!server) {
      setMessage('创建 Shell MCP 预设失败');
      return;
    }
    setSelectedId(server.id);
    setMessage('已创建 Shell MCP 预设。请运行下方安装命令后重启浏览器。');
    await load();
  };

  const startEdit = (server: McpServerConfig) => {
    setEditing(server);
    setMessage('');
    setShowForm(true);
  };

  const saveServer = async (payload: McpServerCreateInput) => {
    const editingServer = editing ? servers.find((server) => server.id === editing.id) ?? editing : null;
    const requestPayload = editingServer
      ? { ...payload, allowlist: editingServer.allowlist }
      : payload;
    const response = editing
      ? await chrome.runtime.sendMessage({
        type: 'UPDATE_MCP_SERVER',
        payload: { id: editing.id, patch: requestPayload },
      })
      : await chrome.runtime.sendMessage({ type: 'CREATE_MCP_SERVER', payload: requestPayload });

    if (!response) {
      setMessage('保存 MCP 服务失败');
      return;
    }

    setShowForm(false);
    setEditing(null);
    setMessage('');
    await load();
  };

  const removeServer = async (server: McpServerConfig) => {
    if (!confirm(`删除 MCP 服务「${server.displayName}」？`)) return;
    await chrome.runtime.sendMessage({ type: 'DELETE_MCP_SERVER', payload: { id: server.id } });
    if (selectedId === server.id) setSelectedId(null);
    await load();
  };

  const patchServer = async (server: McpServerConfig, patch: Partial<McpServerConfig>) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_MCP_SERVER',
      payload: { id: server.id, patch },
    });
    await load();
  };

  const requestPermission = async (server: McpServerConfig) => {
    setBusyState(server.id, 'permission');
    setMessage('');
    try {
      const result = await requestMcpOriginPermission(server);
      setMessage(result?.ok ? `已授权 ${result.origin ?? '本地宿主'}` : (result?.error ?? '授权被拒绝'));
    } finally {
      setBusyState(server.id, null);
    }
  };

  const refreshServer = async (server: McpServerConfig, action: 'refresh' | 'test') => {
    setBusyState(server.id, action);
    setMessage('');
    try {
      if (requiresOriginPermission(server)) {
        const permission = await requestMcpOriginPermission(server);
        if (!permission?.ok) {
          setMessage(permission?.error ?? `需要授权 ${permission?.origin ?? 'MCP 主机'}`);
          return;
        }
      }
      const result = await chrome.runtime.sendMessage({
        type: action === 'test' ? 'TEST_MCP_SERVER_CONNECTION' : 'REFRESH_MCP_SERVER_TOOLS',
        payload: { serverId: server.id },
      });
      const cache: McpToolCacheEntry | null = result?.cache ?? result ?? null;
      if (cache) {
        setCaches((prev) => ({ ...prev, [server.id]: cache }));
        setMessage(cache.health.status === 'ready'
          ? `连接成功，${cache.health.toolCount} 个工具，${formatMs(cache.health.latencyMs)}`
          : cache.health.error ?? '连接失败');
      }
      await load();
    } finally {
      setBusyState(server.id, null);
    }
  };

  const toggleTool = async (server: McpServerConfig, tool: ToolDescriptor) => {
    const enabled = isToolEnabled(server, tool);
    const allowlist = nextAllowlistForTool(server.allowlist, tool, !enabled);
    await patchServer(server, { allowlist });
  };

  const setBusyState = (serverId: string, action: BusyAction | null) => {
    setBusy((prev) => ({ ...prev, [serverId]: action }));
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            MCP
          </h2>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
            {servers.length} 个服务，{enabledCount} 个启用，{toolCount} 个自动工具
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={createShellPreset}
            className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg transition-all duration-150"
          >
            Shell
          </button>
          <button
            onClick={startCreate}
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新增
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-text-secondary)', background: 'var(--ds-surface)', border: '1px solid var(--ds-border)' }}>
          {message}
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <McpServerForm
            key={editing?.id ?? 'create'}
            initial={editing}
            onSave={saveServer}
            onCancel={() => { setShowForm(false); setEditing(null); setMessage(''); }}
          />
        </div>
      )}

      {loading && servers.length === 0 ? (
        <EmptyState label="正在加载 MCP 配置" />
      ) : servers.length === 0 && !showForm ? (
        <EmptyState label="暂无 MCP 服务" />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            {servers.map((server) => (
              <ServerRow
                key={server.id}
                server={server}
                cache={caches[server.id] ?? null}
                selected={selected?.id === server.id}
                busy={busy[server.id] ?? null}
                onSelect={() => setSelectedId(server.id)}
                onToggle={() => patchServer(server, { enabled: !server.enabled })}
                onEdit={() => startEdit(server)}
                onDelete={() => removeServer(server)}
                onRefresh={() => refreshServer(server, 'refresh')}
                onTest={() => refreshServer(server, 'test')}
              />
            ))}
          </div>

          {selected && (
            <ServerDetail
              server={selected}
              cache={selectedCache}
              history={mcpHistory}
              busy={busy[selected.id] ?? null}
              onPatch={(patch) => patchServer(selected, patch)}
              onRequestPermission={() => requestPermission(selected)}
              onRefresh={() => refreshServer(selected, 'refresh')}
              onTest={() => refreshServer(selected, 'test')}
              onToggleTool={(tool) => toggleTool(selected, tool)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function McpServerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null;
  onSave: (payload: McpServerCreateInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initial ? formFromServer(initial) : DEFAULT_FORM);
  const [error, setError] = useState('');
  const selectedTransport = TRANSPORT_OPTIONS.find((item) => item.kind === form.transportKind) ?? TRANSPORT_OPTIONS[0];

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setTransportKind = (kind: McpTransportKind) => {
    setForm((prev) => ({ ...prev, transportKind: kind }));
  };

  const save = async () => {
    const result = payloadFromForm(form);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError('');
    await onSave(result.payload);
  };

  return (
    <div className="ds-form rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          {initial ? '编辑 MCP 服务' : '新增 MCP 服务'}
        </div>
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
          />
          启用
        </label>
      </div>

      {error && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {error}
        </div>
      )}

      <Field label="名称">
        <input
          value={form.displayName}
          onChange={(event) => update('displayName', event.target.value)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
          placeholder="Filesystem MCP"
        />
      </Field>

      <Field label="传输">
        <select
          value={form.transportKind}
          onChange={(event) => setTransportKind(event.target.value as McpTransportKind)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          {TRANSPORT_OPTIONS.map((item) => (
            <option key={item.kind} value={item.kind}>{item.label}</option>
          ))}
        </select>
        <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>{selectedTransport.hint}</div>
      </Field>

      {form.transportKind !== 'native_messaging' && (
        <Field label={form.transportKind === 'stdio_bridge' ? 'Bridge URL' : '服务 URL'}>
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

      {form.transportKind === 'stdio_bridge' && (
        <div className="space-y-2">
          <Field label="命令">
            <input
              value={form.command}
              onChange={(event) => update('command', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="npx"
            />
          </Field>
          <Field label="参数">
            <input
              value={form.args}
              onChange={(event) => update('args', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </Field>
          <Field label="工作目录">
            <input
              value={form.cwd}
              onChange={(event) => update('cwd', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm"
              placeholder="/Users/me/project"
            />
          </Field>
          <Field label="环境变量">
            <textarea
              value={form.env}
              onChange={(event) => update('env', event.target.value)}
              className="ds-input w-full rounded-lg px-3 py-2 text-sm min-h-18 resize-y"
              placeholder={'KEY=value\nTOKEN=...'}
            />
          </Field>
        </div>
      )}

      {form.transportKind !== 'native_messaging' && (
        <HeaderEditor
          headers={form.headers}
          secrets={form.secrets}
          onHeadersChange={(headers) => update('headers', headers)}
          onSecretsChange={(secrets) => update('secrets', secrets)}
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <NumberField label="连接 ms" value={form.connectMs} onChange={(value) => update('connectMs', value)} />
        <NumberField label="请求 ms" value={form.requestMs} onChange={(value) => update('requestMs', value)} />
        <NumberField label="发现 ms" value={form.discoveryMs} onChange={(value) => update('discoveryMs', value)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <NumberField label="结果字节" value={form.maxResultBytes} onChange={(value) => update('maxResultBytes', value)} />
        <NumberField label="工具上限" value={form.maxToolCount} onChange={(value) => update('maxToolCount', value)} />
      </div>

      <div className="ds-surface-panel rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>默认执行</span>
          <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ds-text-secondary)' }}>
            <input
              type="checkbox"
              checked={form.executionEnabled}
              onChange={(event) => update('executionEnabled', event.target.checked)}
            />
            允许注入
          </label>
        </div>
        <select
          value={form.executionMode}
          onChange={(event) => update('executionMode', event.target.value as ToolExecutionMode)}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">自动执行</option>
          <option value="manual">手动策略</option>
          <option value="disabled">禁用</option>
        </select>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg transition-colors">
          取消
        </button>
        <button onClick={save} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors">
          保存
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
          添加
        </button>
      </div>
      {headers.map((header, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
          <input
            value={header.name}
            onChange={(event) => updateHeader(index, { name: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder="Header"
          />
          <input
            value={header.value}
            onChange={(event) => updateHeader(index, { value: event.target.value })}
            className="ds-input min-w-0 rounded-lg px-2 py-1.5 text-xs"
            placeholder="Value"
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
          添加
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
              placeholder="Secret value"
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
              placeholder="Header name"
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
  busy,
  onSelect,
  onToggle,
  onEdit,
  onDelete,
  onRefresh,
  onTest,
}: {
  server: McpServerConfig;
  cache: McpToolCacheEntry | null;
  selected: boolean;
  busy: BusyAction | null;
  onSelect: () => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onTest: () => void;
}) {
  const status = statusMeta(cache?.health.status ?? server.status);
  const activeTools = enabledToolCount(server, cache?.descriptors ?? []);

  return (
    <div
      className="ds-card rounded-lg p-3 cursor-pointer"
      style={{ borderColor: selected ? 'var(--ds-selected-border)' : undefined }}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--ds-text)' }}>{server.displayName}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: status.color, background: status.bg }}>
              {status.label}
            </span>
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {transportLabel(server.transport.kind)} · {activeTools}/{cache?.descriptors.length ?? 0} 自动
          </div>
        </div>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--ds-text-secondary)' }} onClick={(event) => event.stopPropagation()}>
          <input type="checkbox" checked={server.enabled} onChange={onToggle} />
          启用
        </label>
      </div>
      <div className="flex items-center gap-1.5 mt-2" onClick={(event) => event.stopPropagation()}>
        <button onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
          {busy === 'test' ? '测试中' : '测试'}
        </button>
        <button onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
          {busy === 'refresh' ? '刷新中' : '刷新工具'}
        </button>
        <button onClick={onEdit} className="ds-action-btn ds-action-btn-edit px-2 py-1 text-[11px] rounded-md">
          编辑
        </button>
        <button onClick={onDelete} className="ds-action-btn ds-action-btn-delete px-2 py-1 text-[11px] rounded-md ml-auto">
          删除
        </button>
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
}) {
  const tools = cache?.descriptors ?? [];
  const serverHistory = history.filter((record) => record.call.provider?.id === server.id).slice(0, 5);

  return (
    <div className="ds-surface-panel rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--ds-text)' }}>{server.displayName}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>{endpointLabel(server)}</div>
        </div>
        <div className="flex gap-1.5">
          {requiresOriginPermission(server) && (
            <button onClick={onRequestPermission} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
              授权
            </button>
          )}
          <button onClick={onTest} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            测试
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label="状态" value={statusMeta(cache?.health.status ?? server.status).label} />
        <Metric label="延迟" value={formatMs(cache?.health.latencyMs ?? null)} />
        <Metric label="上次连接" value={formatTime(server.lastConnectedAt ?? cache?.health.checkedAt ?? null)} />
        <Metric label="传输" value={transportLabel(server.transport.kind)} />
      </div>

      {(cache?.health.error || server.lastError) && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {cache?.health.error ?? server.lastError}
        </div>
      )}

      {isShellServer(server) && (
        <ShellSetupHint server={server} cache={cache} />
      )}

      <div className="ds-card rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>自动执行策略</span>
          <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
            <input
              type="checkbox"
              checked={server.execution.enabled}
              onChange={(event) => onPatch({ execution: { ...server.execution, enabled: event.target.checked } })}
            />
            允许注入
          </label>
        </div>
        <select
          value={server.execution.mode}
          onChange={(event) => onPatch({ execution: { ...server.execution, mode: event.target.value as ToolExecutionMode } })}
          className="ds-input w-full rounded-lg px-3 py-2 text-sm"
        >
          <option value="auto">自动执行</option>
          <option value="manual">手动策略</option>
          <option value="disabled">禁用</option>
        </select>
        <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          当前注入 {enabledToolCount(server, tools)} 个工具；禁用或手动策略不会进入 DeepSeek Prompt。
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>发现工具</span>
          <button onClick={onRefresh} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md" disabled={busy !== null}>
            {busy === 'refresh' ? '刷新中' : '刷新'}
          </button>
        </div>
        {tools.length === 0 ? (
          <div className="text-xs py-6 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            尚未发现工具
          </div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolRow key={tool.id} server={server} tool={tool} onToggle={() => onToggleTool(tool)} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>最近调用</div>
        {serverHistory.length === 0 ? (
          <div className="text-xs py-3 text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
            暂无调用记录
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
                    {record.result.ok ? '成功' : '失败'}
                  </span>
                </div>
                <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {formatTime(record.createdAt)} · {record.result.summary}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolRow({ server, tool, onToggle }: { server: McpServerConfig; tool: ToolDescriptor; onToggle: () => void }) {
  const enabled = isToolEnabled(server, tool);
  return (
    <div className="ds-card rounded-lg px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>{tool.title || tool.name}</div>
          <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-blue)' }}>{tool.invocationName}</div>
        </div>
        <label className="flex items-center gap-1 text-[11px]" style={{ color: enabled ? 'var(--ds-success)' : 'var(--ds-text-tertiary)' }}>
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          {enabled ? '自动' : '禁用'}
        </label>
      </div>
      <div className="text-[11px] mt-1 leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
        {tool.description}
      </div>
      <div className="text-[10px] mt-2 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
        {schemaSummary(tool)}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'var(--ds-surface)' }}>
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} style={{ color: 'var(--ds-text-tertiary)' }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5h3a3 3 0 110 6h-3m-3-6h-3a3 3 0 100 6h3m-1.5-3h6" />
        </svg>
      </div>
      <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs mb-1" style={{ color: 'var(--ds-text-secondary)' }}>{label}</span>
      {children}
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

function payloadFromForm(form: FormState): { payload: McpServerCreateInput } | { error: string } {
  const displayName = form.displayName.trim();
  if (!displayName) return { error: '名称不能为空' };

  const timeouts = {
    connectMs: positiveInt(form.connectMs, '连接超时'),
    requestMs: positiveInt(form.requestMs, '请求超时'),
    discoveryMs: positiveInt(form.discoveryMs, '发现超时'),
  };
  const limits = {
    maxResultBytes: positiveInt(form.maxResultBytes, '结果字节'),
    maxToolCount: positiveInt(form.maxToolCount, '工具上限'),
  };
  const invalidNumber = Object.values(timeouts).find((value) => typeof value === 'string') ||
    Object.values(limits).find((value) => typeof value === 'string');
  if (typeof invalidNumber === 'string') return { error: invalidNumber };

  const transportResult = transportFromForm(form);
  if ('error' in transportResult) return transportResult;

  const headersResult = normalizeHeaders(form.headers);
  if ('error' in headersResult) return headersResult;

  const secretsResult = normalizeSecrets(form.secrets);
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

function transportFromForm(form: FormState): { transport: McpServerTransportConfig } | { error: string } {
  if (form.transportKind === 'native_messaging') {
    const nativeHost = form.nativeHost.trim();
    if (!nativeHost) return { error: 'Native Host 不能为空' };
    if (!/^[A-Za-z0-9_.-]+$/.test(nativeHost)) return { error: 'Native Host 只能包含字母、数字、点、下划线和短横线' };
    return { transport: { kind: 'native_messaging', nativeHost } };
  }

  const url = form.url.trim();
  if (!url) return { error: '服务 URL 不能为空' };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: '服务 URL 只支持 http/https' };
  } catch {
    return { error: '服务 URL 格式无效' };
  }

  if (form.transportKind !== 'stdio_bridge') {
    return { transport: { kind: form.transportKind, url } };
  }

  const env = parseEnv(form.env);
  if ('error' in env) return env;
  const command = form.command.trim();
  if (!command) return { error: 'Stdio Bridge 命令不能为空' };
  return {
    transport: {
      kind: 'stdio_bridge',
      url,
      command,
      args: form.args.split(/\s+/).map((item) => item.trim()).filter(Boolean),
      cwd: form.cwd.trim(),
      env: env.env,
    },
  };
}

function normalizeHeaders(headers: McpHeaderValue[]): { headers: McpHeaderValue[] } | { error: string } {
  const normalized: McpHeaderValue[] = [];
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value;
    if (!name && !value) continue;
    if (!isHeaderName(name)) return { error: `Header 名称无效：${name || '(空)'}` };
    if (value.includes('\n') || value.includes('\r')) return { error: `Header 值不能包含换行：${name}` };
    normalized.push({ name, value });
  }
  return { headers: normalized };
}

function normalizeSecrets(secrets: McpSecretValue[]): { secrets: McpSecretValue[] } | { error: string } {
  const normalized: McpSecretValue[] = [];
  for (const secret of secrets) {
    const value = secret.value.trim();
    const headerName = secret.headerName?.trim();
    if (!value && !headerName && !secret.username) continue;
    if (secret.kind === 'header' && !isHeaderName(headerName ?? '')) return { error: 'Header Secret 需要有效 Header 名称' };
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

function parseEnv(value: string): { env: Record<string, string> } | { error: string } {
  const env: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const index = line.indexOf('=');
    if (index <= 0) return { error: `环境变量格式无效：${line}` };
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return { env };
}

function positiveInt(value: string, label: string): number | string {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return `${label} 必须是正整数`;
  return parsed;
}

function isHeaderName(value: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function requiresOriginPermission(server: McpServerConfig): boolean {
  return server.transport.kind !== 'native_messaging' && Boolean(server.transport.url);
}

async function requestMcpOriginPermission(server: McpServerConfig): Promise<{
  ok: boolean;
  origin: string | null;
  error?: string;
}> {
  if (!requiresOriginPermission(server)) return { ok: true, origin: null };
  try {
    const origin = getOriginPattern(server.transport.url ?? '');
    if (!chrome.permissions?.contains || !chrome.permissions?.request) return { ok: true, origin };
    const granted = await chrome.permissions.contains({ origins: [origin] }).catch(() => false);
    if (granted) return { ok: true, origin };
    const ok = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    return { ok, origin };
  } catch (err) {
    return { ok: false, origin: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function getOriginPattern(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务 URL 只支持 http/https');
  }
  return `${parsed.protocol}//${parsed.host}/*`;
}

function enabledToolCount(server: McpServerConfig, tools: ToolDescriptor[]): number {
  return tools.filter((tool) => isToolEnabled(server, tool)).length;
}

function isToolEnabled(server: McpServerConfig, tool: ToolDescriptor): boolean {
  if (!server.enabled || !server.execution.enabled || server.execution.mode !== 'auto') return false;
  const selected = server.allowlist.toolNames.includes(tool.name) || server.allowlist.toolNames.includes(tool.invocationName);
  if (server.allowlist.mode === 'allow') return selected;
  if (server.allowlist.mode === 'deny') return !selected;
  return true;
}

function nextAllowlistForTool(
  allowlist: McpToolAllowlist,
  tool: ToolDescriptor,
  shouldEnable: boolean,
): McpToolAllowlist {
  const names = new Set(allowlist.toolNames);
  const preferredName = tool.name;
  const removeTool = () => {
    names.delete(tool.name);
    names.delete(tool.invocationName);
  };

  if (allowlist.mode === 'allow') {
    if (shouldEnable) names.add(preferredName);
    else removeTool();
    return { mode: 'allow', toolNames: [...names] };
  }

  if (allowlist.mode === 'deny') {
    if (shouldEnable) removeTool();
    else names.add(preferredName);
    return { mode: names.size === 0 ? 'all' : 'deny', toolNames: [...names] };
  }

  if (!shouldEnable) {
    return { mode: 'deny', toolNames: [preferredName] };
  }
  return allowlist;
}

function schemaSummary(tool: ToolDescriptor): string {
  const props = Object.keys(tool.inputSchema.properties ?? {});
  const required = tool.inputSchema.required ?? [];
  if (props.length === 0) return '参数：无';
  return `参数：${props.slice(0, 6).join(', ')}${props.length > 6 ? '…' : ''}${required.length ? `；必填 ${required.join(', ')}` : ''}`;
}

function statusMeta(status: McpServerStatus) {
  if (status === 'ready') return { label: 'ready', color: 'var(--ds-success)', bg: 'var(--ds-success-bg)' };
  if (status === 'error') return { label: 'error', color: 'var(--ds-danger)', bg: 'var(--ds-danger-bg)' };
  if (status === 'disabled') return { label: 'disabled', color: 'var(--ds-text-tertiary)', bg: 'var(--ds-surface)' };
  return { label: 'unknown', color: 'var(--ds-text-secondary)', bg: 'var(--ds-surface)' };
}

function isShellServer(server: McpServerConfig): boolean {
  return server.displayName === SHELL_MCP_SERVER_NAME || server.transport.nativeHost === SHELL_MCP_NATIVE_HOST;
}

function ShellSetupHint({ server, cache }: { server: McpServerConfig; cache: McpToolCacheEntry | null }) {
  const { message, isError } = shellSetupMessage(server, cache);
  const setup = shellInstallCommand();
  return (
    <div className="ds-card rounded-lg px-3 py-2 text-[11px] leading-4" style={{ color: 'var(--ds-text-secondary)' }}>
      <div className="font-medium mb-1" style={{ color: 'var(--ds-text)' }}>Shell Native Host</div>
      {isError ? (
        <div className="rounded px-2 py-1 mb-1.5" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger)' }}>
          {message}
        </div>
      ) : (
        <div>{message}</div>
      )}
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {setup.mode === 'local'
          ? '打开终端，在项目根目录执行以下命令：'
          : '打开终端，执行以下命令（只需一次）：'}
      </div>
      <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
        {setup.command}
      </div>
      {setup.fallbackCommand && (
        <>
          <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
            如果你使用的是已发布扩展而不是本地源码版，执行：
          </div>
          <div className="mt-1 font-mono break-all select-all rounded px-2 py-1" style={{ color: 'var(--ds-text)', background: 'var(--ds-surface)' }}>
            {setup.fallbackCommand}
          </div>
        </>
      )}
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {setup.usesExtensionId
          ? `已自动检测 ${browserLabel(setup.browser)} 扩展 ID。安装需要本机已安装 Node.js/npm。`
          : 'Firefox 使用固定扩展 ID，不需要额外填写 extension id。安装需要本机已安装 Node.js/npm。'}
      </div>
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        命令会安装或更新 Shell Native Host；默认跳过 OfficeCLI，如需 OfficeCLI 可去掉 --skip-officecli。
      </div>
      <div className="mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        {!server.enabled
          ? '安装完成后，打开上方开关启用此服务，再点击「测试」验证连接。'
          : '安装完成后重启浏览器，回到这里点击「测试」验证连接。'}
      </div>
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
  const extensionArg = usesExtensionId ? ` --extension-id ${chrome.runtime.id || '<扩展ID>'}` : '';
  const installArgs = `install --browser ${browser}${extensionArg} --skip-officecli`;
  const localCommand = `npm run shell:install -- ${installArgs}`;
  const publishedCommand = `npx deepseek-pp-shell-host ${installArgs}`;

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

function shellSetupMessage(server: McpServerConfig, cache: McpToolCacheEntry | null): { message: string; isError: boolean } {
  const error = `${cache?.health.error ?? ''} ${server.lastError ?? ''}`.toLowerCase();
  if (error.includes('forbidden')) {
    return { message: 'Native Host 已安装，但未授权当前扩展 ID。请重新运行下方安装命令后重启浏览器。', isError: true };
  }
  if (error.includes('native_host_unavailable') || error.includes('native messaging host not found') || error.includes('not found') || error.includes('specified native messaging host')) {
    return { message: '未找到 Native Host — 请先运行下方安装命令，并确保已安装 Node.js/npm。', isError: true };
  }
  if (error.includes('native_messaging_unavailable')) {
    return { message: '当前浏览器不支持 Native Messaging，请使用 Chrome、Edge 或 Firefox。', isError: true };
  }
  if (
    error.includes('failed to fetch') ||
    error.includes('mcp_network_error') ||
    error.includes('cannot reach') ||
    error.includes('connection refused')
  ) {
    return { message: '无法连接到 Native Host — 请确认已运行安装脚本并重启浏览器。', isError: true };
  }
  if (cache?.health.status === 'ready') {
    return { message: `已连接，发现 ${cache.health.toolCount} 个工具。`, isError: false };
  }
  if (!server.enabled) {
    return { message: '服务已创建但尚未启用。请先安装 Native Host，再启用并测试。', isError: false };
  }
  return { message: '请先安装 Native Host，再点击「测试」验证连接。', isError: false };
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

function formatTime(value: number | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}
