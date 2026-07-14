import { useEffect, useRef, useState } from 'react';
import type { LocaleMessageKey, MessageParams, SupportedLocale } from '../../../core/i18n';
import type { GitHubSkillSource, GitHubSkillUpdatePreview, Skill, SkillImportSource } from '../../../core/types';
import { decodeSkillLibrary, decodeSkillSourceCollection } from '../../../core/skill/codec';
import GitHubSkillImportPanel from '../components/GitHubSkillImportPanel';
import LocalSkillImportPanel from '../components/LocalSkillImportPanel';
import PageIntro from '../components/PageIntro';
import SkillCard from '../components/SkillCard';
import SkillForm from '../components/SkillForm';
import { SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { requestGitHubApiPermission } from '../github-permission';
import { useI18n } from '../i18n';
import { createRequestGenerationFence } from '../async-state';
import { getRuntimeErrorMessage } from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';

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

interface ThirdPartySkillGroup {
  id: string;
  title: string;
  subtitle: string;
  badgeKey: LocaleMessageKey;
  url?: string;
  skills: Skill[];
}

function SkillSection({ title, skills, onEdit, onDelete, onToggleEnabled }: SkillSectionProps) {
  if (skills.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        {title}
      </h3>
      {skills.map((s, index) => (
        <SkillCard
          key={`${s.source}:${s.name}:${index}`}
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
  const { t, locale } = useI18n();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillSources, setSkillSources] = useState<SkillImportSource[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [importMode, setImportMode] = useState<'github' | 'local' | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [sourceActions, setSourceActions] = useState<Record<string, SourceActionState>>({});
  const [expandedThirdPartyGroups, setExpandedThirdPartyGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadFence = useRef(createRequestGenerationFence());
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const showOperationError = (error: unknown) => {
    banner.show('error', t('sidepanel.skillPage.operationFailed', {
      error: getRuntimeErrorMessage(error),
    }));
  };

  const load = async () => {
    const generation = loadFence.current.begin();
    try {
      const [list, sources] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_SKILL_LIBRARY' },
          {
            unavailableMessage: t('sidepanel.skillPage.backendUnavailable'),
            decode: (value) => decodeSkillLibrary(value, 'skillLibraryResponse'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_SKILL_SOURCES' },
          {
            unavailableMessage: t('sidepanel.skillPage.backendUnavailable'),
            decode: (value) => decodeSkillSourceCollection(value, 'skillSourceResponse'),
          },
        ),
      ]);
      if (!loadFence.current.isCurrent(generation)) return;
      setSkills(list);
      setSkillSources(sources);
      setLoadFailed(false);
    } catch (error) {
      if (!loadFence.current.isCurrent(generation)) return;
      setLoadFailed(true);
      showOperationError(error);
    } finally {
      if (loadFence.current.isCurrent(generation)) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => loadFence.current.invalidate();
  }, [locale]);

  const closeForm = () => {
    setShowForm(false);
    setEditingSkill(null);
  };

  const handleCreate = () => {
    setImportMode(null);
    setEditingSkill(null);
    setShowForm((current) => (editingSkill ? true : !current));
  };

  const handleImport = (mode: 'github' | 'local') => {
    closeForm();
    setImportMode((current) => (current === mode ? null : mode));
  };

  const handleEdit = (skill: Skill) => {
    setImportMode(null);
    setEditingSkill(skill);
    setShowForm(true);
  };

  const handleDelete = async (name: string) => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        { type: 'DELETE_SKILL', payload: { name } },
        { unavailableMessage: t('sidepanel.skillPage.backendUnavailable') },
      );
      if (editingSkill?.name === name) closeForm();
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleToggleEnabled = async (skill: Skill) => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        {
          type: 'SET_SKILL_ENABLED',
          payload: { name: skill.name, enabled: skill.enabled === false },
        },
        { unavailableMessage: t('sidepanel.skillPage.backendUnavailable') },
      );
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleToggleGroupEnabled = async (group: ThirdPartySkillGroup) => {
    const shouldEnable = group.skills.some((skill) => skill.enabled === false);
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        {
          type: 'SET_SKILLS_ENABLED',
          payload: {
            updates: group.skills.map((skill) => ({ name: skill.name, enabled: shouldEnable })),
          },
        },
        { unavailableMessage: t('sidepanel.skillPage.backendUnavailable') },
      );
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleToggleThirdPartyGroup = (groupId: string) => {
    setExpandedThirdPartyGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const handleSave = async (skill: Skill) => {
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        {
          type: 'SAVE_SKILL',
          payload: editingSkill ? { skill, previousName: editingSkill.name } : skill,
        },
        { unavailableMessage: t('sidepanel.skillPage.backendUnavailable') },
      );
      closeForm();
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const handleCheckSource = async (source: GitHubSkillSource) => {
    setSourceActions((current) => ({
      ...current,
      [source.id]: { status: 'checking', message: t('sidepanel.skillPage.checking') },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error(t('sidepanel.skillPage.checkPermissionError'));
      const update = await sidepanelRuntimeClient.request({
          type: 'CHECK_GITHUB_SKILL_SOURCE_UPDATES',
          payload: { sourceId: source.id },
        }, { unavailableMessage: t('sidepanel.skillPage.checkFailed') });
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: formatUpdateMessage(update, t),
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
      [source.id]: { status: 'updating', message: t('sidepanel.skillPage.syncing') },
    }));
    try {
      const granted = await requestGitHubApiPermission();
      if (!granted) throw new Error(t('sidepanel.skillPage.syncPermissionError'));
      const response = await sidepanelRuntimeClient.request({
          type: 'UPDATE_GITHUB_SKILL_SOURCE',
          payload: { sourceId: source.id },
        }, { unavailableMessage: t('sidepanel.skillPage.syncFailed') });
      setSourceActions((current) => ({
        ...current,
        [source.id]: {
          status: 'success',
          message: t('sidepanel.skillPage.syncedSkills', {
            count: response.imported.length,
          }),
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
    const message = t('sidepanel.skillPage.deleteSourceConfirm', {
      repository: source.repository,
      count: source.importedSkillNames.length,
    });
    const ok = await confirm({
      title: message,
      message,
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      banner.clear();
      await sidepanelRuntimeClient.request(
        {
          type: 'DELETE_GITHUB_SKILL_SOURCE',
          payload: { sourceId: source.id },
        },
        { unavailableMessage: t('sidepanel.skillPage.backendUnavailable') },
      );
      setSourceActions((current) => {
        const next = { ...current };
        delete next[source.id];
        return next;
      });
      await load();
    } catch (error) {
      showOperationError(error);
    }
  };

  const builtin = skills.filter((s) => s.source === 'builtin');
  const githubSources = skillSources.filter((source): source is GitHubSkillSource => source.provider === 'github');
  const thirdPartyGroups = createThirdPartySkillGroups(
    skills.filter((s) => isThirdPartySkillSource(s.source)),
    skillSources,
    t,
  );
  const custom = skills.filter((s) => s.source === 'custom');
  const enabledCount = skills.filter((s) => s.enabled !== false).length;

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.skillPage.title')}
        description={t('sidepanel.skillPage.description')}
        meta={t('sidepanel.skillPage.summary', { total: skills.length, enabled: enabledCount })}
        actions={(
          <>
            <button
              onClick={() => handleImport('github')}
              className="ds-btn-secondary px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
              </svg>
              GitHub
            </button>
            <button
              onClick={() => handleImport('local')}
              className="ds-btn-secondary px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5h6l2 2h10v8.5a2 2 0 01-2 2H5a2 2 0 01-2-2V7.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12v5m0 0l-2-2m2 2l2-2" />
              </svg>
              {t('sidepanel.skillPage.importLocal')}
            </button>
            <button
              onClick={handleCreate}
              className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {t('sidepanel.skillPage.createCustom')}
            </button>
          </>
        )}
      />

      {confirmNode}
      {banner.node}

      {importMode === 'github' && (
        <div className="animate-slide-down">
          <GitHubSkillImportPanel onImported={load} onCancel={() => setImportMode(null)} />
        </div>
      )}

      {importMode === 'local' && (
        <div className="animate-slide-down">
          <LocalSkillImportPanel onImported={load} onCancel={() => setImportMode(null)} />
        </div>
      )}

      {showForm && (
        <div className="animate-slide-down">
          <SkillForm initialSkill={editingSkill} onSave={handleSave} onCancel={closeForm} />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : loadFailed && skills.length === 0 && skillSources.length === 0 ? null : (
        <>
      {githubSources.length > 0 && (
        <GitHubSourceSection
          sources={githubSources}
          actions={sourceActions}
          onCheck={handleCheckSource}
          onUpdate={handleUpdateSource}
          onDelete={handleDeleteSource}
        />
      )}

      <SkillSection title={t('sidepanel.skillPage.sectionBuiltin')} skills={builtin} />
      <ThirdPartySkillSection
        groups={thirdPartyGroups}
        expandedGroups={expandedThirdPartyGroups}
        onToggleGroup={handleToggleThirdPartyGroup}
        onToggleGroupEnabled={handleToggleGroupEnabled}
        onDelete={handleDelete}
        onToggleEnabled={handleToggleEnabled}
      />
      <SkillSection
        title={t('sidepanel.skillPage.sectionCustom')}
        skills={custom}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggleEnabled={handleToggleEnabled}
      />

      <div className="ds-info-panel rounded-xl p-3.5">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.skillPage.usagePrefix')}{' '}
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            {t('sidepanel.skillPage.usageTrigger')}
          </code>{' '}
          {t('sidepanel.skillPage.usageSuffix')}
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            {t('sidepanel.skillPage.usageExample')}
          </code>
        </p>
      </div>
        </>
      )}
    </div>
  );
}

function ThirdPartySkillSection({ groups, expandedGroups, onToggleGroup, onToggleGroupEnabled, onDelete, onToggleEnabled }: {
  groups: ThirdPartySkillGroup[];
  expandedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  onToggleGroupEnabled: (group: ThirdPartySkillGroup) => void;
  onDelete: (name: string) => void;
  onToggleEnabled: (skill: Skill) => void;
}) {
  const { t } = useI18n();
  if (groups.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.skillPage.sectionThirdParty')}
      </h3>
      {groups.map((group) => {
        const expanded = expandedGroups[group.id] === true;
        const enabledCount = group.skills.filter((skill) => skill.enabled !== false).length;
        const shouldDisableAll = enabledCount === group.skills.length;
        const toggleAllLabel = shouldDisableAll
          ? t('sidepanel.skillPage.disableSourceSkills')
          : t('sidepanel.skillPage.enableSourceSkills');

        return (
          <div key={group.id} className="ds-surface-panel rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 p-3">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                aria-label={expanded
                  ? t('sidepanel.skillPage.collapseSource', { source: group.title })
                  : t('sidepanel.skillPage.expandSource', { source: group.title })}
                onClick={() => onToggleGroup(group.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleGroup(group.id);
                  }
                }}
                className="min-w-0 flex-1 flex items-center gap-2 text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ds-blue)] cursor-pointer"
              >
                <svg
                  className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  style={{ color: 'var(--ds-text-tertiary)' }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 min-w-0">
                    {group.url ? (
                      <a
                        href={group.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs font-semibold truncate hover:underline"
                        style={{ color: 'var(--ds-blue)' }}
                      >
                        {group.title}
                      </a>
                    ) : (
                      <span className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
                        {group.title}
                      </span>
                    )}
                    <span className="ds-badge-warning inline-flex text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      {t(group.badgeKey)}
                    </span>
                  </span>
                  <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
                    {group.subtitle} · {t('sidepanel.skillPage.enabledSkillCount', {
                      enabled: enabledCount,
                      total: group.skills.length,
                    })}
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onToggleGroupEnabled(group)}
                className="ds-btn-secondary px-2 py-1 text-[11px] font-medium rounded-md shrink-0"
              >
                {toggleAllLabel}
              </button>
            </div>
            {expanded && (
              <div
                className="space-y-2 p-3 pt-2 animate-slide-down"
                style={{ borderTop: '1px solid var(--ds-border)' }}
              >
                {group.skills.map((skill, index) => (
                  <SkillCard
                    key={`${group.id}:${skill.name}:${index}`}
                    skill={skill}
                    onDelete={skill.source === 'remote' ? () => onDelete(skill.name) : undefined}
                    onToggleEnabled={() => onToggleEnabled(skill)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function GitHubSourceSection({ sources, actions, onCheck, onUpdate, onDelete }: {
  sources: GitHubSkillSource[];
  actions: Record<string, SourceActionState>;
  onCheck: (source: GitHubSkillSource) => void;
  onUpdate: (source: GitHubSkillSource) => void;
  onDelete: (source: GitHubSkillSource) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.skillPage.githubSourceTitle')}
      </h3>
      {sources.map((source, index) => (
        <GitHubSourceCard
          key={`${source.id}:${index}`}
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
  const { t, locale } = useI18n();
  const busy = action?.status === 'checking' || action?.status === 'updating';
  return (
    <div className="ds-surface-panel rounded-xl p-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>
            {source.repository}
          </div>
          <div className="text-[11px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {source.rootPath || t('sidepanel.skillPage.repoRoot')} · {source.ref} · {shortSha(source.commitSha)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onCheck}
            disabled={busy}
            className="ds-btn-secondary px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            {t('sidepanel.skillPage.check')}
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy}
            className="ds-btn-secondary px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            {t('sidepanel.skillPage.sync')}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="ds-text-btn-delete px-2 py-1 text-[11px] font-medium rounded-md disabled:opacity-40"
          >
            {t('sidepanel.skillPage.remove')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
        <span className="ds-tag px-1.5 py-0.5 rounded-full">{t('sidepanel.skillPage.skillCount', { count: source.importedSkillNames.length })}</span>
        <span className="ds-tag px-1.5 py-0.5 rounded-full">{source.licenseSpdxId ?? source.licenseName ?? t('sidepanel.skillPage.unknownLicense')}</span>
        {source.packageVersion && <span className="ds-tag px-1.5 py-0.5 rounded-full">v{source.packageVersion}</span>}
        <span className="ds-tag px-1.5 py-0.5 rounded-full">{t('sidepanel.skillPage.syncedAt', { time: formatTime(source.updatedAt, locale) })}</span>
        {source.lastCheckedAt && <span className="ds-tag px-1.5 py-0.5 rounded-full">{t('sidepanel.skillPage.checkedAt', { time: formatTime(source.lastCheckedAt, locale) })}</span>}
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

function createThirdPartySkillGroups(
  skills: Skill[],
  sources: SkillImportSource[],
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): ThirdPartySkillGroup[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const groups = new Map<string, ThirdPartySkillGroup>();

  for (const skill of skills) {
    const descriptor = getThirdPartyGroupDescriptor(skill, sourceById, t);
    const group = groups.get(descriptor.id);
    if (group) {
      group.skills.push(skill);
    } else {
      groups.set(descriptor.id, {
        ...descriptor,
        skills: [skill],
      });
    }
  }

  return [...groups.values()];
}

function getThirdPartyGroupDescriptor(
  skill: Skill,
  sourceById: Map<string, SkillImportSource>,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): Omit<ThirdPartySkillGroup, 'skills'> {
  if (skill.source === 'remote') {
    const source = skill.remote?.sourceId ? sourceById.get(skill.remote.sourceId) : undefined;
    if (skill.remote?.provider === 'local') {
      const localSource = source?.provider === 'local' ? source : undefined;
      const title = localSource?.displayName ?? skill.remote.localDisplayName ?? t('sidepanel.skill.sources.local');
      const localPath = localSource?.rootPath ?? skill.remote.localRootPath ?? skill.remote.localDirectory;
      return {
        id: `local:${localSource?.id ?? skill.remote.sourceId ?? title}`,
        title,
        subtitle: localPath ?? t('sidepanel.skillPage.localReferencedSource'),
        badgeKey: 'sidepanel.skill.sources.local',
      };
    }

    const githubSource = source?.provider === 'github' ? source : undefined;
    const title = githubSource?.repository ?? skill.remote?.repository ?? 'GitHub';
    const rootPath = githubSource?.rootPath ?? '';
    const ref = githubSource?.ref ?? skill.remote?.ref;
    return {
      id: `github:${githubSource?.id ?? skill.remote?.sourceId ?? title}`,
      title,
      subtitle: [
        rootPath || t('sidepanel.skillPage.repoRoot'),
        ref,
      ].filter(Boolean).join(' · '),
      badgeKey: 'sidepanel.skill.sources.remote',
    };
  }

  const provider = skill.metadata?.provider ?? t('sidepanel.skillPage.unknownThirdPartySource');
  return {
    id: `bundled:${provider}`,
    title: provider,
    subtitle: t('sidepanel.skillPage.bundledThirdPartySource'),
    badgeKey: 'sidepanel.skill.sources.thirdParty',
    ...(skill.metadata?.homepage ? { url: skill.metadata.homepage } : {}),
  };
}

function isThirdPartySkillSource(source: Skill['source']): boolean {
  return source === 'third-party' || source === 'official' || source === 'remote';
}

function formatUpdateMessage(
  update: GitHubSkillUpdatePreview,
  t: (key: LocaleMessageKey, params?: MessageParams) => string,
): string {
  if (!update.hasUpdates) return t('sidepanel.skillPage.noUpdates');
  const parts: string[] = [];
  if (update.changedPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.changedUpdates', { count: update.changedPaths.length }));
  }
  if (update.newPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.newSkills', { count: update.newPaths.length }));
  }
  if (update.missingPaths.length > 0) {
    parts.push(t('sidepanel.skillPage.missingSkills', { count: update.missingPaths.length }));
  }
  return parts.join('，') || t('sidepanel.skillPage.updatesFound');
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatTime(timestamp: number, locale: SupportedLocale): string {
  return new Date(timestamp).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
