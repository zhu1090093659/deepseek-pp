import { useMemo, useRef, useState } from 'react';
import type {
  LocalSkillImportResult,
  LocalSkillImportBlock,
  LocalSkillPreview,
  LocalSkillPreviewItem,
} from '../../../core/types';
import { useI18n } from '../i18n';
import { sidepanelRuntimeClient } from '../runtime-client';

type ImportState = 'idle' | 'previewing' | 'ready' | 'importing' | 'success' | 'error';

interface Props {
  onImported: () => Promise<void> | void;
  onCancel: () => void;
}

export default function LocalSkillImportPanel({ onImported, onCancel }: Props) {
  const { t } = useI18n();
  const [rootPath, setRootPath] = useState('');
  const [state, setState] = useState<ImportState>('idle');
  const [preview, setPreview] = useState<LocalSkillPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<LocalSkillImportResult | null>(null);
  const [picking, setPicking] = useState(false);
  const latestPathRef = useRef('');
  const previewRequestIdRef = useRef(0);

  const selectedCount = selectedPaths.size;
  const selectablePaths = useMemo(() => new Set(
    preview?.skills
      .filter((skill) => !skill.importBlock)
      .map((skill) => skill.path) ?? [],
  ), [preview]);
  const allSelected = selectablePaths.size > 0 &&
    [...selectablePaths].every((path) => selectedPaths.has(path));
  const canPreview = rootPath.trim().length > 0 && state !== 'previewing' && state !== 'importing' && !picking;
  const canPick = state !== 'previewing' && state !== 'importing' && !picking;
  const canImport = Boolean(preview) &&
    selectedCount > 0 &&
    [...selectedPaths].every((path) => selectablePaths.has(path)) &&
    state !== 'importing' &&
    state !== 'previewing' &&
    !picking;

  const selectedBytes = useMemo(() => {
    if (!preview) return 0;
    return preview.skills
      .filter((skill) => selectedPaths.has(skill.path))
      .reduce((sum, skill) => sum + skill.bytes, 0);
  }, [preview, selectedPaths]);

  const runPreviewForPath = async (path: string) => {
    const requestedPath = path.trim();
    if (!requestedPath) return;
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    latestPathRef.current = requestedPath;
    setState('previewing');
    setMessage('');
    setResult(null);
    try {
      const response = await sidepanelRuntimeClient.request({
        type: 'PREVIEW_LOCAL_SKILL_SOURCE',
        payload: { rootPath: requestedPath },
      });
      if (requestId !== previewRequestIdRef.current || latestPathRef.current.trim() !== requestedPath) return;
      const nextPreview = response;
      setPreview(nextPreview);
      setSelectedPaths(new Set(
        nextPreview.skills
          .filter((skill) => !skill.importBlock)
          .map((skill) => skill.path),
      ));
      setState('ready');
    } catch (error) {
      if (requestId !== previewRequestIdRef.current || latestPathRef.current.trim() !== requestedPath) return;
      setPreview(null);
      setSelectedPaths(new Set());
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const runPreview = () => runPreviewForPath(rootPath);

  const pickFolder = async () => {
    if (!canPick) return;
    setPicking(true);
    setMessage('');
    setResult(null);
    try {
      const response = await sidepanelRuntimeClient.request({
        type: 'PICK_LOCAL_SKILL_FOLDER',
        payload: {
          ...(rootPath.trim() ? { defaultPath: rootPath.trim() } : {}),
        },
      });
      const pickedPath = typeof response?.path === 'string' ? response.path.trim() : '';
      if (!pickedPath) throw new Error(t('sidepanel.localSkillImport.pickFailed'));
      setRootPath(pickedPath);
      latestPathRef.current = pickedPath;
      await runPreviewForPath(pickedPath);
    } catch (error) {
      setPreview(null);
      setSelectedPaths(new Set());
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPicking(false);
    }
  };

  const runImport = async () => {
    if (!preview || selectedPaths.size === 0) return;
    setState('importing');
    setMessage('');
    try {
      const response = await sidepanelRuntimeClient.request(
        {
          type: 'IMPORT_LOCAL_SKILL_SOURCE',
          payload: {
            rootPath: rootPath.trim(),
            selectedPaths: [...selectedPaths],
            selectedImportNames: Object.fromEntries(
              preview.skills
                .filter((skill) => selectedPaths.has(skill.path))
                .map((skill) => [skill.path, skill.importName]),
            ),
          },
        },
        { acceptFailure: true },
      );
      if (response?.ok === false) {
        const importBlock = readLocalSkillImportBlock(response.importBlock);
        if (importBlock) throw new Error(formatImportBlockMessage(importBlock, t));
        throw new Error(response.error ?? t('sidepanel.localSkillImport.importFailed'));
      }
      const importResult = response;
      setResult(importResult);
      setState('success');
      setMessage(t('sidepanel.localSkillImport.importedMessage', { count: importResult.imported.length }));
      await onImported();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePath = (path: string) => {
    if (!selectablePaths.has(path)) return;
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedPaths(allSelected ? new Set() : new Set(selectablePaths));
  };

  return (
    <section className="ds-form rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.localSkillImport.title')}
          </h3>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.localSkillImport.description')}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="ds-btn-cancel shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-lg"
        >
          {t('common.close')}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t('sidepanel.localSkillImport.pathPlaceholder')}
            value={rootPath}
            onChange={(event) => {
              const nextPath = event.target.value;
              setRootPath(nextPath);
              latestPathRef.current = nextPath;
              previewRequestIdRef.current += 1;
              setPreview(null);
              setSelectedPaths(new Set());
              setResult(null);
              setMessage('');
              if (state !== 'importing') setState('idle');
            }}
            onKeyDown={(event) => event.key === 'Enter' && canPreview && runPreview()}
            className="ds-input min-w-0 flex-1 px-3 py-2 text-xs rounded-lg transition-all duration-150"
          />
          <button
            type="button"
            onClick={pickFolder}
            disabled={!canPick}
            className="ds-btn-secondary shrink-0 px-2.5 py-2 text-[11px] font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
          >
            {picking ? <Spinner /> : <FolderPickerIcon />}
            {t('sidepanel.localSkillImport.pickFolder')}
          </button>
          <button
            type="button"
            onClick={runPreview}
            disabled={!canPreview}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
          >
            {state === 'previewing' && <Spinner />}
            {t('common.preview')}
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          <span className="ds-tag px-2 py-0.5 rounded-full">SKILL.md</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">references</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">templates</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">Shell MCP</span>
        </div>
      </div>

      {preview && (
        <div className="space-y-3">
          <SourceSummary preview={preview} />

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={toggleAll}
              className="ds-btn-secondary px-2.5 py-1.5 text-[11px] font-medium rounded-lg"
            >
              {allSelected ? t('sidepanel.localSkillImport.clearSelection') : t('sidepanel.localSkillImport.selectAll')}
            </button>
            <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.localSkillImport.selectedSummary', {
                selected: selectedCount,
                total: preview.skills.length,
                bytes: formatBytes(selectedBytes),
              })}
            </span>
          </div>

          <div className="space-y-2">
            {preview.skills.map((skill) => (
              <PreviewSkillRow
                key={skill.path}
                skill={skill}
                checked={selectedPaths.has(skill.path)}
                onToggle={() => togglePath(skill.path)}
              />
            ))}
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="ds-btn-cancel px-3.5 py-1.5 text-xs font-medium rounded-lg"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!canImport}
              className="ds-btn-primary px-4 py-1.5 text-xs font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
            >
              {state === 'importing' && <Spinner />}
              {t('sidepanel.localSkillImport.importSelected')}
            </button>
          </div>
        </div>
      )}

      {message && (
        <StatusMessage state={state} message={message} result={result} />
      )}
    </section>
  );
}

function SourceSummary({ preview }: { preview: LocalSkillPreview }) {
  const { t } = useI18n();
  const { source } = preview;
  const omittedCount = preview.skills.reduce((sum, skill) => sum + skill.omittedFiles.length, 0);
  const unavailableOmittedCount = preview.skills
    .filter((skill) => skill.importBlock)
    .reduce((sum, skill) => sum + skill.omittedFiles.length, 0);
  const sourceWarningSet = new Set(preview.warnings);
  const warnings = [
    ...preview.warnings,
    ...preview.skills.flatMap((skill) => skill.warnings
      .filter((warning) => !sourceWarningSet.has(warning) && !isGenericOmissionWarning(warning))
      .map((warning) => `${skill.importName}: ${warning}`)),
  ].filter((warning) => !isGenericOmissionWarning(warning));

  return (
    <div className="ds-surface-panel rounded-xl p-3 space-y-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
          {source.displayName}
        </div>
        <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
          {source.rootPath}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Meta label={t('sidepanel.localSkillImport.meta.skill')} value={String(preview.skills.length)} />
        <Meta label={t('sidepanel.localSkillImport.meta.mode')} value={t('sidepanel.localSkillImport.referencedMode')} />
      </div>
      {omittedCount > 0 && (
        <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--ds-info)', background: 'var(--ds-info-bg)' }}>
          {t(
            unavailableOmittedCount > 0
              ? 'sidepanel.localSkillImport.omittedUnavailableExplanation'
              : 'sidepanel.localSkillImport.omittedExplanation',
            { count: omittedCount },
          )}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--ds-warning)', background: 'var(--ds-warning-bg)' }}>
          {warnings.slice(0, 4).map((warning) => (
            <div key={warning}>• {warning}</div>
          ))}
          {warnings.length > 4 && <div>• {t('sidepanel.localSkillImport.warningOverflow', { count: warnings.length - 4 })}</div>}
        </div>
      )}
    </div>
  );
}

function PreviewSkillRow({ skill, checked, onToggle }: {
  skill: LocalSkillPreviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const blocked = Boolean(skill.importBlock);
  const blockInstructions = skill.importBlock
    ? getImportBlockInstructions(skill.importBlock, t)
    : '';

  return (
    <label className={`ds-card rounded-xl p-3 block ${blocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={blocked}
          onChange={onToggle}
          className="mt-1 w-4 h-4"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <code className="ds-trigger text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded truncate">
              /{skill.importName}
            </code>
            {skill.nameChanged && (
              <span className="ds-badge-warning inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                {t('sidepanel.localSkillImport.renamedBadge')}
              </span>
            )}
            {skill.version && (
              <span className="ds-badge-info inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                v{skill.version}
              </span>
            )}
          </div>
          <p className="text-xs mt-1.5 leading-relaxed line-clamp-2" style={{ color: 'var(--ds-text-secondary)' }}>
            {skill.description}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
            <span className="ds-tag px-1.5 py-0.5 rounded-full">{skill.path}</span>
            <span className="ds-tag px-1.5 py-0.5 rounded-full">{formatBytes(skill.bodyBytes)}</span>
            <span className="ds-tag px-1.5 py-0.5 rounded-full">{t('sidepanel.localSkillImport.resourceCount', { count: skill.includedFiles.length })}</span>
            {skill.scriptFiles.length > 0 && (
              <span className="ds-tag px-1.5 py-0.5 rounded-full">{t('sidepanel.localSkillImport.scriptCount', { count: skill.scriptFiles.length })}</span>
            )}
            {skill.omittedFiles.length > 0 && (
              <span
                className="ds-tag px-1.5 py-0.5 rounded-full"
                title={t(
                  blocked
                    ? 'sidepanel.localSkillImport.omittedUnavailableExplanation'
                    : 'sidepanel.localSkillImport.omittedExplanation',
                  { count: skill.omittedFiles.length },
                )}
              >
                {t(
                  blocked
                    ? 'sidepanel.localSkillImport.notBundledCount'
                    : 'sidepanel.localSkillImport.omittedCount',
                  { count: skill.omittedFiles.length },
                )}
              </span>
            )}
          </div>
          {skill.importBlock && (
            <div className="mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed" style={{ color: 'var(--ds-warning)', background: 'var(--ds-warning-bg)' }}>
              <div className="font-medium">{t('sidepanel.localSkillImport.readerUnavailable')}</div>
              <div className="mt-0.5">{blockInstructions}</div>
              {skill.importBlock.detail && (
                <div className="mt-0.5 opacity-80">
                  {t('sidepanel.localSkillImport.readerTechnicalDetail', { detail: skill.importBlock.detail })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </label>
  );
}

function getImportBlockInstructions(
  block: LocalSkillImportBlock,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (block.code) {
    case 'shell_host_update_required':
      return t('sidepanel.localSkillImport.readerActions.updateHost');
    case 'shell_reader_unavailable':
      return t('sidepanel.localSkillImport.readerActions.enableReader');
    case 'shell_discovery_failed':
      return t('sidepanel.localSkillImport.readerActions.checkConnection');
  }
}

function formatImportBlockMessage(
  block: LocalSkillImportBlock,
  t: ReturnType<typeof useI18n>['t'],
): string {
  return [
    t('sidepanel.localSkillImport.readerUnavailable'),
    getImportBlockInstructions(block, t),
    block.detail
      ? t('sidepanel.localSkillImport.readerTechnicalDetail', { detail: block.detail })
      : '',
  ].filter(Boolean).join(' ');
}

function readLocalSkillImportBlock(value: unknown): LocalSkillImportBlock | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { code?: unknown; detail?: unknown };
  if (
    candidate.code !== 'shell_host_update_required' &&
    candidate.code !== 'shell_reader_unavailable' &&
    candidate.code !== 'shell_discovery_failed'
  ) return null;
  return {
    code: candidate.code,
    ...(typeof candidate.detail === 'string' && candidate.detail
      ? { detail: candidate.detail }
      : {}),
  };
}

function isGenericOmissionWarning(warning: string): boolean {
  return /^\d+ local supporting file\(s\) were omitted\.$/.test(warning.trim());
}

function StatusMessage({ state, message, result }: {
  state: ImportState;
  message: string;
  result: LocalSkillImportResult | null;
}) {
  const { t } = useI18n();
  const success = state === 'success';
  return (
    <div
      className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
      style={{
        color: success ? 'var(--ds-success)' : 'var(--ds-danger)',
        background: success ? 'var(--ds-success-bg)' : 'var(--ds-danger-bg)',
      }}
    >
      <div>{message}</div>
      {result && result.renamed > 0 && (
        <div>{t('sidepanel.localSkillImport.renamedNotice', { count: result.renamed })}</div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg px-2 py-1.5" style={{ background: 'var(--ds-bg)' }}>
      <div className="text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>{label}</div>
      <div className="text-[11px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>{value}</div>
    </div>
  );
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />;
}

function FolderPickerIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5V17a2.5 2.5 0 0 0 2.5 2.5h13A2.5 2.5 0 0 0 21 17V9.5A2.5 2.5 0 0 0 18.5 7H12l-2-2.5H5.5A2.5 2.5 0 0 0 3 7.5Z" />
      <path d="M8 13h8" />
    </svg>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
