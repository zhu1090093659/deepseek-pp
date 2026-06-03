import { useEffect, useState } from 'react';
import type { GitHubSkillSource, GitHubSkillUpdatePreview, Skill } from '../../../core/types';
import GitHubSkillImportPanel from '../components/GitHubSkillImportPanel';
import SkillCard from '../components/SkillCard';
import SkillForm from '../components/SkillForm';
import { requestGitHubApiPermission } from '../github-permission';

interface SkillSectionProps {
  title: string;
  skills: Skill[];
  onEdit?: (skill: Skill) => void;
  onDelete?: (name: string) => void;
  onToggleEnabled?: (skill: Skill) => void;
}

type SourceActionStatus = 'checking' | 'updating' | 'success' | 'error';

interface SourceActionState {
  status: SourceActionStatus;
  message: string;
  update?: GitHubSkillUpdatePreview;
}

function SkillSection({ title, skills, onEdit, onDelete, onToggleEnabled }: SkillSectionProps) {
  if (skills.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        {title}
      </h3>
      {skills.map((s) => (
        <SkillCard
          key={s.name}
          skill={s}
          onEdit={onEdit ? () => onEdit(s) : undefined}
          onDelete={onDelete ? () => onDelete(s.name) : undefined}
          onToggleEnabled={onToggleEnabled ? () => onToggleEnabled(s) : undefined}
        />
      ))}
    </div>
  );
}

export default function SkillPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSources, setSkillSources] = useState<GitHubSkillSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [sourceActions, setSourceActions] = useState<Record<string, SourceActionState>>({});

  const load = async () => {
    const [list, sources]: [Skill[], GitHubSkillSource[]] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_SKILL_LIBRARY' }),
      chrome.runtime.sendMessage({ type: 'GET_GITHUB_SKILL_SOURCES' }),
    ]);
    setSkills(list ?? []);
    setSkillSources(sources ?? []);
  };

  useEffect(() => { load(); }, []);

  const closeForm = () => {
    setShowForm(false);
    setEditingSkill(null);
  };

  const handleCreate = () => {
    setShowImport(false);
    setEditingSkill(null);
    setShowForm((current) => (editingSkill ? true : !current));
  };

  const handleImport = () => {
    closeForm();
    setShowImport((current) => !current);
  };

  const handleEdit = (skill: Skill) => {
    setShowImport(false);
    setEditingSkill(skill);
    setShowForm(true);
  };

  const handleDelete = async (name: string) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_SKILL', payload: { name } });
    if (editingSkill?.name === name) closeForm();
    await load();
  };

  const handleToggleEnabled = async (skill: Skill) => {
    await chrome.runtime.sendMessage({
      type: 'SET_SKILL_ENABLED',
      payload: { name: skill.name, enabled: skill.enabled === false },
    });
    await load();
  };

  const handleSave = async (skill: Skill) => {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SKILL',
      payload: editingSkill ? { skill, previousName: editingSkill.name } : skill,
    });
    closeForm();
    await load();
  };

  const handleCheckSource = async (source: GitHubSkillSource) => {
    setSourceActions((current) => ({
      ...current,
      [source.id]: { status: 'checking', message: '检查中...' },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error('需要 GitHub API 访问权限才能检查更新');
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_GITHUB_SKILL_SOURCE_UPDATES',
        payload: { sourceId: source.id },
      });
      if (response?.ok === false) throw new Error(response.error ?? '检查更新失败');
      const update = response as GitHubSkillUpdatePreview;
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: formatUpdateMessage(update),
          update,
        },
      }));
      await load();
    } catch (error) {
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const handleUpdateSource = async (source: GitHubSkillSource) => {
    setSourceActions((current) => ({
      ...current,
      [source.id]: { status: 'updating', message: '同步中...' },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error('需要 GitHub API 访问权限才能同步更新');
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_GITHUB_SKILL_SOURCE',
        payload: { sourceId: source.id },
      });
      if (response?.ok === false) throw new Error(response.error ?? '同步失败');
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: `已同步 ${(response?.imported as Skill[] | undefined)?.length ?? source.skillPaths.length} 个 Skill`,
        },
      }));
      await load();
    } catch (error) {
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const handleDeleteSource = async (source: GitHubSkillSource) => {
    if (!confirm(`确定移除 ${source.repository} 导入的 ${source.importedSkillNames.length} 个 Skill 吗？`)) return;
    await chrome.runtime.sendMessage({
      type: 'DELETE_GITHUB_SKILL_SOURCE',
      payload: { sourceId: source.id },
    });
    setSourceActions((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
    await load();
  };

  const builtin = skills.filter((s) => s.source === 'builtin');
  const official = skills.filter((s) => s.source === 'official');
  const remote = skills.filter((s) => s.source === 'remote');
  const custom = skills.filter((s) => s.source === 'custom');

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          可用 Skill
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="ds-btn-secondary px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
            GitHub
          </button>
          <button
            onClick={handleCreate}
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            自定义
          </button>
        </div>
      </div>

      {showImport && (
        <div className="animate-slide-down">
          <GitHubSkillImportPanel onImported={load} onCancel={() => setShowImport(false)} />
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <SkillForm initialSkill={editingSkill} onSave={handleSave} onCancel={closeForm} />
        </div>
      )}

      {skillSources.length > 0 && (
        <GitHubSourceSection
          sources={skillSources}
          actions={sourceActions}
          onCheck={handleCheckSource}
          onUpdate={handleUpdateSource}
          onDelete={handleDeleteSource}
        />
      )}

      <SkillSection
        title="GitHub 导入"
        skills={remote}
        onDelete={handleDelete}
        onToggleEnabled={handleToggleEnabled}
      />
      <SkillSection title="内置" skills={builtin} />
      <SkillSection title="官方" skills={official} />
      <SkillSection
        title="自定义"
        skills={custom}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleEnabled={handleToggleEnabled}
      />

      <div className="ds-info-panel rounded-xl p-3.5">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          在 DeepSeek 输入框中输入{' '}
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /skill名 参数
          </code>{' '}
          触发。例如：
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /frontend-design 做一个登录页
          </code>
        </p>
      </div>
    </div>
  );
}

function GitHubSourceSection({ sources, actions, onCheck, onUpdate, onDelete }: {
  sources: GitHubSkillSource[];
  actions: Record<string, SourceActionState>;
  onCheck: (source: GitHubSkillSource) => void;
  onUpdate: (source: GitHubSkillSource) => void;
  onDelete: (source: GitHubSkillSource) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        GitHub 源
      </h3>
      {sources.map((source) => (
        <GitHubSourceCard
          key={source.id}
          source={source}
          action={actions[source.id]}
          onCheck={() => onCheck(source)}
          onUpdate={() => onUpdate(source)}
          onDelete={() => onDelete(source)}
        />
      ))}
    </section>
  );
}

function GitHubSourceCard({ source, action, onCheck, onUpdate, onDelete }: {
  source: GitHubSkillSource;
  action?: SourceActionState;
  onCheck: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}) {
  const busy = action?.status === 'checking' || action?.status === 'updating';
  return (
    <div className="ds-surface-panel rounded-xl p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
            {source.repository}
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {source.rootPath || 'repo root'} · {source.ref} · {shortSha(source.commitSha)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onCheck}
            disabled={busy}
            className="ds-btn-secondary px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            检查
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy}
            className="ds-btn-secondary px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            同步
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="ds-text-btn-delete px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            移除
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
        <span className="ds-tag px-1.5 py-0.5 rounded-full">{source.importedSkillNames.length} 个 Skill</span>
        <span className="ds-tag px-1.5 py-0.5 rounded-full">{source.licenseSpdxId ?? source.licenseName ?? 'Unknown license'}</span>
        {source.packageVersion && <span className="ds-tag px-1.5 py-0.5 rounded-full">v{source.packageVersion}</span>}
        <span className="ds-tag px-1.5 py-0.5 rounded-full">同步 {formatTime(source.updatedAt)}</span>
        {source.lastCheckedAt && <span className="ds-tag px-1.5 py-0.5 rounded-full">检查 {formatTime(source.lastCheckedAt)}</span>}
      </div>

      {action && (
        <div
          className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{
            color: action.status === 'error' ? 'var(--ds-danger)' : action.update?.hasUpdates ? 'var(--ds-warning)' : 'var(--ds-success)',
            background: action.status === 'error' ? 'var(--ds-danger-bg)' : action.update?.hasUpdates ? 'var(--ds-warning-bg)' : 'var(--ds-success-bg)',
          }}
        >
          {busy && <span className="inline-block w-3 h-3 mr-1.5 border-2 border-current border-t-transparent rounded-full animate-spin align-[-2px]" />}
          {action.message}
        </div>
      )}
    </div>
  );
}

function formatUpdateMessage(update: GitHubSkillUpdatePreview): string {
  if (!update.hasUpdates) return '上游没有发现更新';
  const parts: string[] = [];
  if (update.changedPaths.length > 0) parts.push(`${update.changedPaths.length} 个已导入 Skill 可能有更新`);
  if (update.newPaths.length > 0) parts.push(`${update.newPaths.length} 个新增 Skill`);
  if (update.missingPaths.length > 0) parts.push(`${update.missingPaths.length} 个已导入 Skill 在上游消失`);
  return parts.join('，') || '发现上游更新';
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
