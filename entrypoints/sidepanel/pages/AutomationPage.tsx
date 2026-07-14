import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Automation,
  AutomationCreateInput,
  AutomationPromptOptions,
  AutomationRun,
  AutomationSchedule,
  AutomationScheduleKind,
} from '../../../core/automation/types';
import {
  decodeAutomationList,
  decodeAutomationRunList,
} from '../../../core/automation/storage-codec';
import { validateAutomationSchedule } from '../../../core/automation/schedule';
import type { SupportedLocale } from '../../../core/i18n';
import { createRequestGenerationFence } from '../async-state';
import PageIntro from '../components/PageIntro';
import {
  SkeletonList,
  StatusMessage,
  ToggleRow,
  useBanner,
  useConfirm,
} from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { isSidepanelRuntimeEvent } from '../runtime-event-codec';
import { getRuntimeErrorMessage } from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const AUTOMATION_UPDATE_EVENTS = ['AUTOMATIONS_UPDATED', 'AUTOMATION_RUNS_UPDATED'] as const;

const DEFAULT_PROMPT_OPTIONS: AutomationPromptOptions = {
  modelType: null,
  searchEnabled: false,
  thinkingEnabled: false,
  refFileIds: [],
};

type FormState = {
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  expression: string;
  timezone: string;
  modelType: string;
  searchEnabled: boolean;
  thinkingEnabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  scheduleKind: 'manual',
  expression: '',
  timezone: DEFAULT_TIMEZONE,
  modelType: '',
  searchEnabled: false,
  thinkingEnabled: false,
};

export default function AutomationPage() {
  const { t } = useI18n();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [runs, setRuns] = useState<Record<string, AutomationRun[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [hasConfirmedSnapshot, setHasConfirmedSnapshot] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadFence = useRef(createRequestGenerationFence());
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const activeCount = useMemo(
    () => automations.filter((item) => item.status === 'active').length,
    [automations],
  );

  const load = async () => {
    const generation = loadFence.current.begin();
    setLoading(true);
    setLoadError(null);
    try {
      const items = await sidepanelRuntimeClient.request(
        { type: 'GET_AUTOMATIONS' },
        {
          unavailableMessage: t('sidepanel.automationPage.loadFailed'),
          decode: (value) => decodeAutomationList(value, 'GET_AUTOMATIONS response'),
        },
      );
      const runEntries = await Promise.all(
        items.map(async (automation) => {
          const recent = await sidepanelRuntimeClient.request(
            {
              type: 'GET_AUTOMATION_RUNS',
              payload: { automationId: automation.id, limit: 3 },
            },
            {
              unavailableMessage: t('sidepanel.automationPage.loadFailed'),
              decode: (value) => decodeAutomationRunList(
                value,
                'GET_AUTOMATION_RUNS response',
              ),
            },
          );
          return [automation.id, recent] as const;
        }),
      );
      if (!loadFence.current.isCurrent(generation)) return;
      setAutomations(items);
      setRuns(Object.fromEntries(runEntries));
      setHasConfirmedSnapshot(true);
    } catch (error) {
      if (!loadFence.current.isCurrent(generation)) return;
      setLoadError(
        getRuntimeErrorMessage(error) || t('sidepanel.automationPage.loadFailed'),
      );
    } finally {
      if (loadFence.current.isCurrent(generation)) setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleUpdate = (message: unknown) => {
      if (isSidepanelRuntimeEvent(message, AUTOMATION_UPDATE_EVENTS)) void load();
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      loadFence.current.invalidate();
      chrome.runtime.onMessage.removeListener(handleUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    banner.clear();
    setShowForm((prev) => !prev);
  };

  const startEdit = (automation: Automation) => {
    setEditing(automation);
    setForm(fromAutomation(automation));
    banner.clear();
    setShowForm(true);
  };

  const save = async () => {
    const payload = toAutomationInput(form);
    if (!payload.name || !payload.prompt) {
      banner.show('error', t('sidepanel.automationPage.namePromptRequired'));
      return;
    }
    if (payload.schedule.enabled && !payload.schedule.expression) {
      banner.show('error', t('sidepanel.automationPage.expressionRequired'));
      return;
    }
    const scheduleValidation = validateAutomationSchedule(payload.schedule);
    if (!scheduleValidation.ok) {
      banner.show('error', scheduleValidation.error.message);
      return;
    }

    try {
      const response = editing
        ? await sidepanelRuntimeClient.request({
          type: 'UPDATE_AUTOMATION',
          payload: { id: editing.id, patch: payload },
        }, { acceptFailure: true })
        : await sidepanelRuntimeClient.request({ type: 'CREATE_AUTOMATION', payload });

      if ('ok' in response) {
        banner.show('error', response.error);
        return;
      }
      if (response.lastError) {
        banner.show('error', response.lastError.message);
        return;
      }
      banner.show('success', editing ? t('common.saveChanges') : t('sidepanel.automationPage.created'));
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (error) {
      banner.show('error', getRuntimeErrorMessage(error));
    }
  };

  const runNow = async (id: string) => {
    setRunningIds((prev) => new Set(prev).add(id));
    banner.clear();
    try {
      const run: AutomationRun | { ok: false; error: string } | null = await sidepanelRuntimeClient.request(
        { type: 'RUN_AUTOMATION_NOW', payload: { id } },
        { acceptFailure: true },
      );
      if (run && 'error' in run && typeof run.error === 'string') {
        banner.show('error', run.error);
      } else if (run && 'status' in run && (run.status === 'failed' || run.status === 'timeout')) {
        banner.show('error', run.error?.message ?? t('sidepanel.automationPage.runFailed'));
      }
    } catch (error) {
      banner.show('error', getRuntimeErrorMessage(error));
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await load();
    }
  };

  const toggleStatus = async (automation: Automation) => {
    try {
      await sidepanelRuntimeClient.request({
        type: 'SET_AUTOMATION_STATUS',
        payload: { id: automation.id, status: automation.status === 'active' ? 'paused' : 'active' },
      });
      await load();
    } catch (error) {
      banner.show('error', getRuntimeErrorMessage(error));
    }
  };

  const remove = async (automation: Automation) => {
    const ok = await confirm({
      title: t('sidepanel.automationPage.deleteConfirm', { name: automation.name }),
      message: t('sidepanel.automationPage.deleteConfirm', { name: automation.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await sidepanelRuntimeClient.request({
        type: 'DELETE_AUTOMATION',
        payload: { id: automation.id },
      });
      await load();
    } catch (error) {
      banner.show('error', getRuntimeErrorMessage(error));
    }
  };

  const openSession = async (url: string | null) => {
    if (!url) return;
    await chrome.tabs.create({ url, active: true });
  };

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.automationPage.title')}
        description={t('sidepanel.automationPage.description')}
        meta={t('sidepanel.automationPage.summary', { total: automations.length, active: activeCount })}
        actions={(
        <button
          onClick={startCreate}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('sidepanel.automationPage.create')}
        </button>
        )}
      />

      {banner.node}
      {loadError && <StatusMessage tone="error">{loadError}</StatusMessage>}
      {confirmNode}

      {showForm && (
        <div className="animate-slide-down">
          <AutomationForm
            form={form}
            editing={editing}
            onChange={setForm}
            onSave={save}
            onCancel={() => { setShowForm(false); setEditing(null); banner.clear(); }}
          />
        </div>
      )}

      {loading && !hasConfirmedSnapshot ? (
        <SkeletonList rows={3} />
      ) : !hasConfirmedSnapshot ? null : automations.length === 0 && !showForm ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">{t('sidepanel.automationPage.empty')}</div>
          <div className="ds-empty-state-description">{t('sidepanel.automationPage.emptyHelp')}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              automation={automation}
              runs={runs[automation.id] ?? []}
              running={runningIds.has(automation.id)}
              onRun={() => runNow(automation.id)}
              onToggleStatus={() => toggleStatus(automation)}
              onEdit={() => startEdit(automation)}
              onDelete={() => remove(automation)}
              onOpenSession={() => openSession(automation.deepseek.sessionUrl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationForm({
  form,
  editing,
  onChange,
  onSave,
  onCancel,
}: {
  form: FormState;
  editing: Automation | null;
  onChange: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange({ ...form, [key]: value });
  };
  const isScheduled = form.scheduleKind !== 'manual';

  return (
    <div className="ds-form rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.name')}</span>
          <input
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
            placeholder={t('sidepanel.automationPage.form.namePlaceholder')}
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.model')}</span>
          <select
            value={form.modelType}
            onChange={(e) => update('modelType', e.target.value)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="">{t('sidepanel.automationPage.form.defaultModel')}</option>
            <option value="expert">Expert</option>
            <option value="vision">Vision</option>
          </select>
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>Prompt</span>
        <textarea
          value={form.prompt}
          onChange={(e) => update('prompt', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg min-h-28 resize-y"
          placeholder={t('sidepanel.automationPage.form.promptPlaceholder')}
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.trigger')}</span>
          <select
            value={form.scheduleKind}
            onChange={(e) => update('scheduleKind', e.target.value as AutomationScheduleKind)}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          >
            <option value="manual">{t('sidepanel.automationPage.form.manual')}</option>
            <option value="cron">Cron</option>
            <option value="rrule">RRULE</option>
          </select>
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.expression')}</span>
          <input
            value={isScheduled ? form.expression : ''}
            onChange={(e) => update('expression', e.target.value)}
            disabled={!isScheduled}
            className="ds-input w-full px-3 py-2 text-xs rounded-lg disabled:opacity-50"
            placeholder={form.scheduleKind === 'rrule' ? 'FREQ=HOURLY;INTERVAL=1' : '0 9 * * *'}
          />
        </label>
      </div>

      <label className="space-y-1 block">
        <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>{t('sidepanel.automationPage.form.timezone')}</span>
        <input
          value={form.timezone}
          onChange={(e) => update('timezone', e.target.value)}
          className="ds-input w-full px-3 py-2 text-xs rounded-lg"
          placeholder="Asia/Shanghai"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <ToggleRow
          title={t('sidepanel.automationPage.form.search')}
          enabled={form.searchEnabled}
          onToggle={(next) => update('searchEnabled', next)}
        />
        <ToggleRow
          title={t('sidepanel.automationPage.form.thinking')}
          enabled={form.thinkingEnabled}
          onToggle={(next) => update('thinkingEnabled', next)}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="ds-btn-cancel px-3 py-1.5 text-xs rounded-lg">
          {t('common.cancel')}
        </button>
        <button onClick={onSave} className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg">
          {editing ? t('common.save') : t('sidepanel.automationPage.form.create')}
        </button>
      </div>
    </div>
  );
}

function AutomationCard({
  automation,
  runs,
  running,
  onRun,
  onToggleStatus,
  onEdit,
  onDelete,
  onOpenSession,
}: {
  automation: Automation;
  runs: AutomationRun[];
  running: boolean;
  onRun: () => void;
  onToggleStatus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: () => void;
}) {
  const { t, locale } = useI18n();
  const latestRun = runs[0];
  const statusColor = automation.status === 'active' ? 'var(--ds-success)' : 'var(--ds-text-tertiary)';
  const statusBg = automation.status === 'active' ? 'var(--ds-success-bg)' : 'var(--ds-surface)';

  return (
    <div className="ds-card rounded-xl p-3 space-y-2 animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-[13px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>
              {automation.name}
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style={{ color: statusColor, background: statusBg }}>
              {automation.status === 'active' ? t('sidepanel.automationPage.status.active') : t('sidepanel.automationPage.status.paused')}
            </span>
          </div>
          <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>
            {automation.prompt}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <IconButton title={automation.status === 'active' ? t('sidepanel.automationPage.status.paused') : t('sidepanel.automationPage.status.active')} path={automation.status === 'active' ? 'M10 9v6m4-6v6' : 'M5 3l14 9-14 9V3z'} onClick={onToggleStatus} />
          <IconButton title={t('common.edit')} path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" onClick={onEdit} />
          <IconButton title={t('common.delete')} path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-9 0h12" onClick={onDelete} danger />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Meta label={t('sidepanel.automationPage.meta.next')} value={formatTime(automation.nextRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <Meta label={t('sidepanel.automationPage.meta.previous')} value={formatTime(automation.lastRunAt, locale, t('sidepanel.automationPage.meta.none'))} />
        <Meta label={t('sidepanel.automationPage.meta.session')} value={automation.deepseek.chatSessionId ? shortId(automation.deepseek.chatSessionId) : t('sidepanel.automationPage.meta.notCreated')} />
        <Meta label={t('sidepanel.automationPage.meta.recent')} value={latestRun ? formatRun(latestRun, t) : t('sidepanel.automationPage.meta.none')} />
      </div>

      {automation.lastError && (
        <div className="rounded-lg px-2.5 py-2 text-[11px]" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)' }}>
          {automation.lastError.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onOpenSession}
          disabled={!automation.deepseek.sessionUrl}
          className="ds-btn-secondary px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
        >
          {t('sidepanel.automationPage.actions.openSession')}
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg disabled:opacity-60"
        >
          {running ? t('sidepanel.automationPage.status.running') : t('sidepanel.automationPage.actions.runNow')}
        </button>
      </div>
    </div>
  );
}

function IconButton({
  title,
  path,
  onClick,
  danger,
}: {
  title: string;
  path: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`ds-action-btn w-7 h-7 rounded-lg flex items-center justify-center ${danger ? 'ds-action-btn-delete' : 'ds-action-btn-edit'}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={path} />
      </svg>
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-2.5 py-2" style={{ background: 'var(--ds-surface)' }}>
      <div style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="truncate mt-0.5" style={{ color: 'var(--ds-text-secondary)' }}>{value}</div>
    </div>
  );
}

function fromAutomation(automation: Automation): FormState {
  return {
    name: automation.name,
    prompt: automation.prompt,
    scheduleKind: automation.schedule.kind,
    expression: automation.schedule.expression ?? '',
    timezone: automation.schedule.timezone || DEFAULT_TIMEZONE,
    modelType: normalizeFormModelType(automation.promptOptions.modelType),
    searchEnabled: automation.promptOptions.searchEnabled,
    thinkingEnabled: automation.promptOptions.thinkingEnabled,
  };
}

function toAutomationInput(form: FormState): AutomationCreateInput {
  const schedule = buildSchedule(form);
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    schedule,
    promptOptions: {
      ...DEFAULT_PROMPT_OPTIONS,
      modelType: form.modelType.trim() || null,
      searchEnabled: form.searchEnabled,
      thinkingEnabled: form.thinkingEnabled,
    },
  };
}

function buildSchedule(form: FormState): AutomationSchedule {
  const enabled = form.scheduleKind !== 'manual';
  return {
    kind: form.scheduleKind,
    expression: enabled ? form.expression.trim() : null,
    timezone: form.timezone.trim() || DEFAULT_TIMEZONE,
    enabled,
    minimumIntervalMinutes: 15,
  };
}

function formatTime(value: number | null, locale: SupportedLocale, emptyText: string): string {
  if (!value) return emptyText;
  return new Date(value).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRun(run: AutomationRun, t: ReturnType<typeof useI18n>['t']): string {
  const label: Record<AutomationRun['status'], string> = {
    queued: t('sidepanel.automationPage.status.queued'),
    running: t('sidepanel.automationPage.status.running'),
    succeeded: t('sidepanel.automationPage.status.succeeded'),
    failed: t('sidepanel.automationPage.status.failed'),
    timeout: t('sidepanel.automationPage.status.timeout'),
    cancelled: t('sidepanel.automationPage.status.cancelled'),
    skipped: t('sidepanel.automationPage.status.skipped'),
  };
  return `${label[run.status]}${run.attempt > 1 ? ` · ${t('sidepanel.automationPage.attempt', { count: run.attempt })}` : ''}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function normalizeFormModelType(modelType: string | null): string {
  if (!modelType || modelType === 'default' || modelType === 'DEFAULT' || modelType === 'chat' || modelType === 'deepseek_chat') {
    return '';
  }
  if (modelType === 'reasoner' || modelType === 'deepseek_reasoner') return 'expert';
  if (modelType === 'expert' || modelType === 'vision') return modelType;
  return '';
}
