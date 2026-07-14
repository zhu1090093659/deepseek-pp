import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { UsageModelSummary, UsageRangeDays, UsageSummary } from '../../../../core/types';
import { createRequestGenerationFence } from '../../async-state';
import { usageController } from '../../controllers/usage-controller';
import { useI18n } from '../../i18n';
import { getRuntimeErrorMessage } from '../../runtime-response';
import { SidepanelRuntimeError } from '../../runtime-client';
import {
  EmptyState,
  SegmentedControl,
  SkeletonList,
  StatusMessage,
  useBanner,
  useConfirm,
} from './primitives';

type RangeKey = '7' | '30';

const MODEL_COLORS = [
  'var(--ds-blue)',
  'var(--ds-success)',
  'var(--ds-warning)',
  'var(--ds-purple)',
  'var(--ds-danger)',
  'var(--ds-info)',
];

export default function UsageSubPage() {
  const { t, locale } = useI18n();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [summaries, setSummaries] = useState<Partial<Record<RangeKey, UsageSummary>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(createRequestGenerationFence());
  const rangeKeyRef = useRef(rangeKey);
  rangeKeyRef.current = rangeKey;
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();

  const summary = summaries[rangeKey] ?? null;
  const rangeOptions = useMemo(() => [
    { key: '7' as const, label: t('sidepanel.settings.usage.last7Days') },
    { key: '30' as const, label: t('sidepanel.settings.usage.last30Days') },
  ], [t]);

  const load = useCallback(async (requestedRangeKey: RangeKey) => {
    const generation = requestGeneration.current.begin();
    const requestedRangeDays = Number(requestedRangeKey) as UsageRangeDays;
    setLoading(true);
    setError(null);
    try {
      const result = await usageController.getSummary(requestedRangeDays);
      if (!requestGeneration.current.isCurrent(generation)) return;
      setSummaries((current) => ({ ...current, [requestedRangeKey]: result }));
    } catch (err) {
      if (!requestGeneration.current.isCurrent(generation)) return;
      setError(
        err instanceof SidepanelRuntimeError && err.kind === 'protocol'
          ? t('sidepanel.settings.usage.loadFailed')
          : getRuntimeErrorMessage(err) || t('sidepanel.settings.usage.loadFailed'),
      );
    } finally {
      if (requestGeneration.current.isCurrent(generation)) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load(rangeKey);
    return () => requestGeneration.current.invalidate();
  }, [load, rangeKey]);

  const clearStats = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.usage.clearStats'),
      message: t('sidepanel.settings.usage.clearConfirm'),
      confirmLabel: t('sidepanel.settings.usage.clearStats'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;

    try {
      await usageController.clear();
      requestGeneration.current.invalidate();
      setSummaries({});
      banner.show('success', t('sidepanel.settings.usage.clearSuccess'));
      await load(rangeKeyRef.current);
    } catch (err) {
      banner.show('error', getRuntimeErrorMessage(err) || t('sidepanel.settings.usage.clearFailed'));
    }
  };

  const hasUsage = Boolean(summary && summary.turnCount > 0);

  return (
    <div className="usage-dashboard space-y-4">
      {confirmNode}
      {banner.node}

      <div className="usage-toolbar">
        <div className="min-w-0">
          <div className="usage-toolbar-label">{t('sidepanel.settings.usage.rangeLabel')}</div>
          <SegmentedControl
            options={rangeOptions}
            value={rangeKey}
            onChange={setRangeKey}
            ariaLabel={t('sidepanel.settings.usage.rangeLabel')}
            size="sm"
          />
        </div>
        {hasUsage && (
          <button
            type="button"
            className="ds-btn-cancel usage-clear-button"
            onClick={clearStats}
          >
            {t('sidepanel.settings.usage.clearStats')}
          </button>
        )}
      </div>

      {error && <StatusMessage tone="error">{error}</StatusMessage>}

      {loading && !summary ? (
        <SkeletonList rows={4} />
      ) : !summary ? null : !hasUsage ? (
        <EmptyState
          title={t('sidepanel.settings.usage.emptyTitle')}
          description={t('sidepanel.settings.usage.emptyDescription')}
        />
      ) : (
        <>
          <UsageMetricGrid summary={summary} locale={locale} />
          <UsageHeatmap summary={summary} locale={locale} />
          <UsageDailyTrend summary={summary} locale={locale} />
          <UsageModelSplit summary={summary} locale={locale} />
        </>
      )}
    </div>
  );
}

function UsageMetricGrid({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  const mostUsedModel = summary.mostUsedModel;
  return (
    <div className="usage-metric-grid">
      <MetricCell
        label={t('sidepanel.settings.usage.totalTokens')}
        value={formatCompactTokens(summary.totalTokens, locale)}
        detail={t('sidepanel.settings.usage.serverSamples', {
          server: summary.serverTokenRecordCount,
          total: summary.turnCount,
        })}
      />
      <MetricCell
        label={t('sidepanel.settings.usage.sessions')}
        value={formatInteger(summary.sessionCount, locale)}
        detail={t('sidepanel.settings.usage.turns', { count: summary.turnCount })}
      />
      <MetricCell
        label={t('sidepanel.settings.usage.messages')}
        value={formatInteger(summary.messageCount, locale)}
        detail={t('sidepanel.settings.usage.activeDays', { count: summary.activeDays })}
      />
      <MetricCell
        label={t('sidepanel.settings.usage.currentStreak')}
        value={formatInteger(summary.currentStreak, locale)}
        detail={t('sidepanel.settings.usage.daysUnit')}
      />
      <MetricCell
        label={t('sidepanel.settings.usage.mostUsedModel')}
        value={mostUsedModel?.modelLabel ?? t('sidepanel.settings.usage.noModel')}
        detail={mostUsedModel
          ? t('sidepanel.settings.usage.share', { percent: formatPercent(mostUsedModel.share, locale) })
          : t('sidepanel.settings.usage.noModel')}
      />
    </div>
  );
}

function MetricCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="usage-metric-cell">
      <div className="usage-metric-label">{label}</div>
      <div className="usage-metric-value">{value}</div>
      <div className="usage-metric-detail">{detail}</div>
    </div>
  );
}

function UsageHeatmap({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  return (
    <section className="usage-panel">
      <div className="usage-panel-heading">
        <h2>{t('sidepanel.settings.usage.heatmapTitle')}</h2>
        <div className="usage-legend" aria-hidden="true">
          <span>{t('sidepanel.settings.usage.less')}</span>
          {[0, 1, 2, 3, 4, 5].map((level) => (
            <span key={level} className="usage-heat-cell usage-legend-cell" data-level={level} />
          ))}
          <span>{t('sidepanel.settings.usage.more')}</span>
        </div>
      </div>
      <div className="usage-heatmap-grid" role="list" aria-label={t('sidepanel.settings.usage.heatmapTitle')}>
        {summary.heatmap.map((cell) => (
          <span
            key={cell.day}
            role="listitem"
            className="usage-heat-cell"
            data-level={cell.level}
            title={`${formatDate(cell.timestamp, locale)} · ${formatInteger(cell.tokens, locale)} tokens`}
          />
        ))}
      </div>
    </section>
  );
}

function UsageDailyTrend({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  const maxTokens = Math.max(1, ...summary.days.map((day) => day.tokens));
  const labelStep = summary.rangeDays === 30 ? 6 : 1;

  return (
    <section className="usage-panel">
      <div className="usage-panel-heading">
        <h2>{t('sidepanel.settings.usage.dailyTrendTitle')}</h2>
      </div>
      <div
        className="usage-bars"
        aria-label={t('sidepanel.settings.usage.dailyTrendTitle')}
        style={{ '--usage-day-count': summary.rangeDays } as CSSProperties}
      >
        {summary.days.map((day, dayIndex) => {
          const height = day.tokens > 0 ? Math.max(5, (day.tokens / maxTokens) * 100) : 0;
          return (
            <div
              key={day.day}
              className="usage-bar-column"
              title={`${formatDate(day.timestamp, locale)} · ${formatInteger(day.tokens, locale)} tokens`}
            >
              <div className="usage-bar-track">
                <div className="usage-bar-stack" style={{ height: `${height}%` }}>
                  {day.models.map((model) => (
                    <span
                      key={model.modelKey}
                      className="usage-bar-segment"
                      style={{
                        '--usage-model-color': getModelColor(model.modelKey, summary.modelUsage),
                        flexGrow: Math.max(model.tokens, 1),
                      } as CSSProperties}
                    />
                  ))}
                </div>
              </div>
              <span className="usage-bar-label">
                {dayIndex % labelStep === 0 || dayIndex === summary.days.length - 1
                  ? formatShortDate(day.timestamp, locale)
                  : ''}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UsageModelSplit({ summary, locale }: { summary: UsageSummary; locale: string }) {
  const { t } = useI18n();
  const donutStyle = {
    background: buildDonutGradient(summary.modelUsage),
  };

  return (
    <section className="usage-panel">
      <div className="usage-panel-heading">
        <h2>{t('sidepanel.settings.usage.modelUsageTitle')}</h2>
      </div>
      <div className="usage-model-layout">
        <div className="usage-donut" style={donutStyle}>
          <div className="usage-donut-hole">
            <strong>{formatCompactTokens(summary.totalTokens, locale)}</strong>
            <span>tokens</span>
          </div>
        </div>
        <div className="usage-model-list">
          {summary.modelUsage.map((model) => (
            <div key={model.modelKey} className="usage-model-row">
              <span
                className="usage-model-dot"
                style={{ background: getModelColor(model.modelKey, summary.modelUsage) }}
              />
              <div className="min-w-0 flex-1">
                <div className="usage-model-name">{model.modelLabel}</div>
                <div className="usage-model-tokens">{formatCompactTokens(model.totalTokens, locale)} tokens</div>
              </div>
              <div className="usage-model-share">{formatPercent(model.share, locale)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function getModelColor(modelKey: string, models: readonly UsageModelSummary[]): string {
  const index = Math.max(0, models.findIndex((model) => model.modelKey === modelKey));
  return MODEL_COLORS[index % MODEL_COLORS.length];
}

function buildDonutGradient(models: readonly UsageModelSummary[]): string {
  if (models.length === 0) return 'var(--ds-border)';
  let cursor = 0;
  const stops = models.map((model, index) => {
    const start = cursor;
    cursor += model.share * 100;
    const end = Math.max(cursor, start + 0.6);
    return `${MODEL_COLORS[index % MODEL_COLORS.length]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Number.isFinite(value) ? Math.round(value) : 0);
}

function formatCompactTokens(value: number, locale: string): string {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  return new Intl.NumberFormat(locale, {
    notation: safeValue >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(safeValue);
}

function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function formatShortDate(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(timestamp));
}
