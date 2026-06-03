import { useMemo, useRef, useState } from 'react';
import type {
  GitHubSkillImportResult,
  GitHubSkillPreview,
  GitHubSkillPreviewItem,
} from '../../../core/types';
import { requestGitHubApiPermission } from '../github-permission';

type ImportState = 'idle' | 'previewing' | 'ready' | 'importing' | 'success' | 'error';

interface Props {
  onImported: () => Promise<void> | void;
  onCancel: () => void;
}

export default function GitHubSkillImportPanel({ onImported, onCancel }: Props) {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<ImportState>('idle');
  const [preview, setPreview] = useState<GitHubSkillPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<GitHubSkillImportResult | null>(null);
  const latestUrlRef = useRef('');
  const previewRequestIdRef = useRef(0);

  const selectedCount = selectedPaths.size;
  const allSelected = preview ? preview.skills.length > 0 && selectedCount === preview.skills.length : false;
  const canPreview = url.trim().length > 0 && state !== 'previewing' && state !== 'importing';
  const canImport = Boolean(preview) && selectedCount > 0 && state !== 'importing' && state !== 'previewing';

  const selectedBytes = useMemo(() => {
    if (!preview) return 0;
    return preview.skills
      .filter((skill) => selectedPaths.has(skill.path))
      .reduce((sum, skill) => sum + skill.bytes, 0);
  }, [preview, selectedPaths]);

  const runPreview = async () => {
    const requestedUrl = url.trim();
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setState('previewing');
    setMessage('');
    setResult(null);
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error('需要 GitHub API 访问权限才能读取仓库 Skill');
      const response = await chrome.runtime.sendMessage({
        type: 'PREVIEW_GITHUB_SKILL_SOURCE',
        payload: { url: requestedUrl },
      });
      if (response?.ok === false) throw new Error(response.error ?? '预览失败');
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      const nextPreview = response as GitHubSkillPreview;
      setPreview(nextPreview);
      setSelectedPaths(new Set(nextPreview.skills.map((skill) => skill.path)));
      setState('ready');
    } catch (error) {
      if (requestId !== previewRequestIdRef.current || latestUrlRef.current.trim() !== requestedUrl) return;
      setPreview(null);
      setSelectedPaths(new Set());
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const runImport = async () => {
    if (!preview || selectedPaths.size === 0) return;
    setState('importing');
    setMessage('');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_GITHUB_SKILL_SOURCE',
        payload: {
          url: url.trim(),
          selectedPaths: [...selectedPaths],
        },
      });
      if (response?.ok === false) throw new Error(response.error ?? '导入失败');
      const importResult = response as GitHubSkillImportResult;
      setResult(importResult);
      setState('success');
      setMessage(`已导入 ${importResult.imported.length} 个 Skill`);
      await onImported();
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePath = (path: string) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedPaths(allSelected ? new Set() : new Set(preview.skills.map((skill) => skill.path)));
  };

  return (
    <section className="ds-form rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            从 GitHub 导入 Skill
          </h3>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
            支持仓库、目录或单个 SKILL.md 链接。导入前会预览内容，不会覆盖本地自定义 Skill。
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="ds-btn-cancel shrink-0 px-2.5 py-1.5 text-[11px] font-medium rounded-lg"
        >
          关闭
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            placeholder="https://github.com/owner/repo 或 .../SKILL.md"
            value={url}
            onChange={(event) => {
              const nextUrl = event.target.value;
              setUrl(nextUrl);
              latestUrlRef.current = nextUrl;
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
            onClick={runPreview}
            disabled={!canPreview}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
          >
            {state === 'previewing' && <Spinner />}
            预览
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          <span className="ds-tag px-2 py-0.5 rounded-full">repo</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">tree</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">blob/SKILL.md</span>
          <span className="ds-tag px-2 py-0.5 rounded-full">raw.githubusercontent.com</span>
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
              {allSelected ? '取消全选' : '全选'}
            </button>
            <span className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
              已选 {selectedCount} / {preview.skills.length} · {formatBytes(selectedBytes)}
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
              取消
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!canImport}
              className="ds-btn-primary px-4 py-1.5 text-xs font-medium rounded-lg disabled:opacity-40 flex items-center gap-1.5"
            >
              {state === 'importing' && <Spinner />}
              导入选中 Skill
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

function SourceSummary({ preview }: { preview: GitHubSkillPreview }) {
  const { source } = preview;
  const warnings = [
    ...preview.warnings,
    ...preview.skills.flatMap((skill) => skill.warnings.map((warning) => `${skill.importName}: ${warning}`)),
  ];

  return (
    <div className="ds-surface-panel rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
            {source.repository}
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {source.rootPath || 'repo root'} · {source.ref} · {shortSha(source.commitSha)}
          </div>
        </div>
        <a
          href={source.repoUrl}
          target="_blank"
          rel="noreferrer"
          className="ds-btn-secondary shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          title="打开仓库"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H18m0 0v4.5M18 6l-7.5 7.5M6 6h3m-3 0v12h12v-3" />
          </svg>
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Meta label="License" value={source.licenseSpdxId ?? source.licenseName ?? 'Unknown'} />
        <Meta label="Version" value={source.packageVersion ?? '-'} />
        <Meta label="Skill" value={String(preview.skills.length)} />
        <Meta label="Default" value={source.defaultBranch} />
      </div>
      {warnings.length > 0 && (
        <div className="rounded-lg px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--ds-warning)', background: 'var(--ds-warning-bg)' }}>
          {warnings.slice(0, 4).map((warning) => (
            <div key={warning}>• {warning}</div>
          ))}
          {warnings.length > 4 && <div>• 还有 {warnings.length - 4} 条 warning</div>}
        </div>
      )}
    </div>
  );
}

function PreviewSkillRow({ skill, checked, onToggle }: {
  skill: GitHubSkillPreviewItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="ds-card rounded-xl p-3 block cursor-pointer">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
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
                已改名
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
            <span className="ds-tag px-1.5 py-0.5 rounded-full">资源 {skill.includedFiles.length}</span>
            {skill.omittedFiles.length > 0 && (
              <span className="ds-tag px-1.5 py-0.5 rounded-full">省略 {skill.omittedFiles.length}</span>
            )}
          </div>
        </div>
      </div>
    </label>
  );
}

function StatusMessage({ state, message, result }: {
  state: ImportState;
  message: string;
  result: GitHubSkillImportResult | null;
}) {
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
        <div>有 {result.renamed} 个 Skill 因命名冲突自动加后缀。</div>
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

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
