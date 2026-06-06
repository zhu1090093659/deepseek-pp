import { useEffect, useMemo, useState } from 'react';
import type {
  ConversationExportArtifact,
  ConversationExportFormat,
  ConversationExportMode,
  ConversationExportProgress,
  ConversationExportResult,
} from '../../../core/export/types';
import { SVG_PATHS } from '../constants';

type ExportResponse = ConversationExportResult | { ok: false; exportId?: string; error: string };
type SummaryTone = 'success' | 'warning';

const DEFAULT_FORMATS: ConversationExportFormat[] = ['json', 'markdown'];

export default function ExportPage() {
  const [mode, setMode] = useState<ConversationExportMode>('sanitized');
  const [formats, setFormats] = useState<ConversationExportFormat[]>(DEFAULT_FORMATS);
  const [includeAttachmentMetadata, setIncludeAttachmentMetadata] = useState(true);
  const [runningExportId, setRunningExportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ConversationExportProgress | null>(null);
  const [message, setMessage] = useState('');
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [lastSummary, setLastSummary] = useState('');
  const [lastSummaryTone, setLastSummaryTone] = useState<SummaryTone>('success');

  const canStart = formats.length > 0 && runningExportId === null;
  const progressPercent = useMemo(() => {
    if (!progress || progress.total <= 0) return 0;
    return Math.min(100, Math.round((progress.current / progress.total) * 100));
  }, [progress]);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }).then((response) => {
      setHasToken(response?.hasToken === true);
    }).catch(() => setHasToken(false));
  }, []);

  useEffect(() => {
    const handler = (msg: { type?: string; progress?: ConversationExportProgress }) => {
      if (msg.type !== 'DEEPSEEK_EXPORT_PROGRESS' || !msg.progress) return;
      if (runningExportId && msg.progress.exportId !== runningExportId) return;
      setProgress(msg.progress);
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [runningExportId]);

  const toggleFormat = (format: ConversationExportFormat) => {
    setFormats((current) => {
      if (current.includes(format)) return current.filter((item) => item !== format);
      return [...current, format];
    });
  };

  const startExport = async () => {
    if (!canStart) return;
    const exportId = crypto.randomUUID();
    setRunningExportId(exportId);
    setProgress({
      exportId,
      phase: 'starting',
      status: 'running',
      current: 0,
      total: 1,
      message: '准备导出',
    });
    setMessage('');
    setLastSummary('');
    setLastSummaryTone('success');

    try {
      const response: ExportResponse = await chrome.runtime.sendMessage({
        type: 'EXPORT_DEEPSEEK_CONVERSATIONS',
        payload: {
          exportId,
          request: {
            mode,
            formats,
            includeAttachmentMetadata,
            includeFileBodies: false,
          },
        },
      });

      if (!response?.ok) {
        setMessage(response?.error ?? '导出失败');
        return;
      }

      for (const artifact of response.artifacts) downloadArtifact(artifact);
      const failedCount = response.summary.failedSessionCount;
      setLastSummaryTone(failedCount > 0 ? 'warning' : 'success');
      setLastSummary(
        failedCount > 0
          ? `已导出 ${response.summary.sessionCount} 个会话、${response.summary.messageCount} 条消息、${response.summary.attachmentCount} 个附件引用；${failedCount} 个会话读取失败，请检查导出文件中的 Export Warnings。`
          : `已导出 ${response.summary.sessionCount} 个会话、${response.summary.messageCount} 条消息、${response.summary.attachmentCount} 个附件引用。`,
      );
    } finally {
      setRunningExportId(null);
    }
  };

  const cancelExport = async () => {
    if (!runningExportId) return;
    await chrome.runtime.sendMessage({
      type: 'CANCEL_DEEPSEEK_EXPORT',
      payload: { exportId: runningExportId },
    });
    setRunningExportId(null);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            DeepSeek 记录导出
          </h2>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
            {hasToken === null ? '检测认证中' : hasToken ? '认证信息已就绪' : '未检测到认证信息'}
          </div>
        </div>
        <button
          type="button"
          disabled={!canStart}
          onClick={startExport}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Icon path={SVG_PATHS.download} />
          导出
        </button>
      </div>

      {message && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--ds-danger)', background: 'var(--ds-danger-bg)', border: '1px solid var(--ds-danger-border)' }}>
          {message}
        </div>
      )}

      {lastSummary && !runningExportId && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            color: `var(--ds-${lastSummaryTone})`,
            background: `var(--ds-${lastSummaryTone}-bg)`,
            border: `1px solid var(--ds-${lastSummaryTone}-border)`,
          }}
        >
          {lastSummary}
        </div>
      )}

      <section className="ds-card rounded-lg p-3 space-y-3">
        <div>
          <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--ds-text-secondary)' }}>模式</div>
          <div className="grid grid-cols-2 gap-2">
            <SegmentButton active={mode === 'sanitized'} onClick={() => setMode('sanitized')} label="可读" detail="隐藏内部提示" />
            <SegmentButton active={mode === 'raw'} onClick={() => setMode('raw')} label="官方原始" detail="保留 raw payload" />
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium mb-2" style={{ color: 'var(--ds-text-secondary)' }}>格式</div>
          <div className="grid grid-cols-3 gap-2">
            <CheckButton checked={formats.includes('json')} onClick={() => toggleFormat('json')} label="JSON" />
            <CheckButton checked={formats.includes('markdown')} onClick={() => toggleFormat('markdown')} label="Markdown" />
            <CheckButton checked={formats.includes('html')} onClick={() => toggleFormat('html')} label="HTML/PDF" />
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--ds-surface)' }}>
          <span className="text-xs" style={{ color: 'var(--ds-text)' }}>附件元数据</span>
          <input
            type="checkbox"
            checked={includeAttachmentMetadata}
            onChange={(event) => setIncludeAttachmentMetadata(event.target.checked)}
          />
        </label>

        <div className="rounded-lg px-3 py-2 text-[11px]" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}>
          文件正文导出未启用；当前导出文件名、大小、状态和引用关系。
        </div>
      </section>

      {progress && (
        <section className="ds-surface-panel rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs" style={{ color: 'var(--ds-text)' }}>{progress.message}</div>
            {runningExportId && (
              <button
                type="button"
                onClick={cancelExport}
                className="ds-btn-cancel px-2 py-1 text-[11px] rounded-md"
              >
                取消
              </button>
            )}
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--ds-border)' }}>
            <div
              className="h-full rounded-full transition-all duration-150"
              style={{ width: `${progressPercent}%`, background: 'var(--ds-blue)' }}
            />
          </div>
          <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
            {progress.current}/{progress.total}
          </div>
        </section>
      )}
    </div>
  );
}

function SegmentButton(props: { active: boolean; onClick: () => void; label: string; detail: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg px-3 py-2 text-left border transition-colors"
      style={{
        borderColor: props.active ? 'var(--ds-blue)' : 'var(--ds-border)',
        background: props.active ? 'var(--ds-blue-light)' : 'var(--ds-surface)',
      }}
    >
      <div className="text-xs font-medium" style={{ color: props.active ? 'var(--ds-blue)' : 'var(--ds-text)' }}>{props.label}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>{props.detail}</div>
    </button>
  );
}

function CheckButton(props: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg px-2 py-2 text-xs border transition-colors"
      style={{
        borderColor: props.checked ? 'var(--ds-blue)' : 'var(--ds-border)',
        background: props.checked ? 'var(--ds-blue-light)' : 'var(--ds-surface)',
        color: props.checked ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
      }}
    >
      {props.label}
    </button>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

function downloadArtifact(artifact: ConversationExportArtifact) {
  const blob = new Blob([artifact.content], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
