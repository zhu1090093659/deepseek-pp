import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CurrentDeepSeekConversation,
  Memory,
  NewMemory,
  ProjectContext,
  ProjectContextState,
  ProjectConversation,
} from '../../../core/types';
import {
  decodeCurrentDeepSeekConversation,
  decodeProjectContext,
  decodeProjectContextState,
} from '../../../core/project/codec';
import { PROJECT_CONTEXT_SCHEMA_VERSION } from '../../../core/project/types';
import { createRequestGenerationFence } from '../async-state';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { SkeletonList, StatusBadge, useBanner, useConfirm } from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { decodeMemoryList } from '../controllers/library-controller';
import { isSidepanelRuntimeEvent } from '../runtime-event-codec';
import { getRuntimeErrorMessage } from '../runtime-response';
import {
  sidepanelRuntimeClient,
  type AnyTypedRuntimeCommandRequest,
} from '../runtime-client';

const EMPTY_PROJECT_STATE: ProjectContextState = {
  schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
  projects: [],
  conversations: [],
  pendingProjectId: null,
};

const PROJECT_UPDATE_EVENTS = ['PROJECT_CONTEXT_UPDATED', 'STATE_UPDATED'] as const;

type ProjectMutationRequest = Extract<
  AnyTypedRuntimeCommandRequest,
  { type:
    | 'UPDATE_PROJECT_CONTEXT'
    | 'DELETE_PROJECT_CONTEXT'
    | 'ADD_CONVERSATION_TO_PROJECT'
    | 'REMOVE_CONVERSATION_FROM_PROJECT'
    | 'SET_PENDING_PROJECT_CONTEXT'
    | 'SAVE_MEMORY'
    | 'UPDATE_MEMORY'
    | 'DELETE_MEMORY' }
>;

export default function ProjectsPage() {
  const { t } = useI18n();
  const [state, setState] = useState<ProjectContextState>(EMPTY_PROJECT_STATE);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [editing, setEditing] = useState<ProjectContext | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [currentConversation, setCurrentConversation] = useState<CurrentDeepSeekConversation | null>(null);
  const loadFence = useRef(createRequestGenerationFence());
  const conversationFence = useRef(createRequestGenerationFence());
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  useEffect(() => {
    void loadAll().catch(showProjectError);
    void refreshCurrentConversation();
    const handler = (message: unknown) => {
      if (isSidepanelRuntimeEvent(message, PROJECT_UPDATE_EVENTS)) {
        void loadAll().catch(showProjectError);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    window.addEventListener('focus', refreshCurrentConversation);
    return () => {
      loadFence.current.invalidate();
      conversationFence.current.invalidate();
      chrome.runtime.onMessage.removeListener(handler);
      window.removeEventListener('focus', refreshCurrentConversation);
    };
  }, []);

  const selectedProject = useMemo(
    () => state.projects.find((project) => project.id === selectedProjectId) ?? state.projects[0] ?? null,
    [selectedProjectId, state.projects],
  );
  const projectConversations = useMemo(
    () => selectedProject
      ? state.conversations
        .filter((conversation) => conversation.projectId === selectedProject.id)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      : [],
    [selectedProject, state.conversations],
  );
  const projectMemories = useMemo(
    () => selectedProject
      ? memories.filter((memory) => memory.scope === 'project' && memory.projectId === selectedProject.id)
      : [],
    [memories, selectedProject],
  );
  const currentConversationProject = currentConversation
    ? state.conversations.find((item) => item.conversationId === currentConversation.conversationId)
    : null;

  useEffect(() => {
    if (!selectedProject) {
      setEditing(null);
      return;
    }
    setSelectedProjectId(selectedProject.id);
    setEditing(selectedProject);
    setEditName(selectedProject.name);
    setEditDescription(selectedProject.description);
    setEditInstructions(selectedProject.instructions);
  }, [selectedProject]);

  async function loadAll() {
    const generation = loadFence.current.begin();
    try {
      const [next, nextMemories] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_PROJECT_CONTEXT_STATE' },
          {
            unavailableMessage: t('sidepanel.projectsPage.backendUnavailable'),
            decode: (value) => decodeProjectContextState(value, 'projectContextResponse'),
          },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_MEMORIES' },
          {
            unavailableMessage: t('sidepanel.projectsPage.backendUnavailable'),
            decode: (value) => decodeMemoryList(value, 'memoryResponse'),
          },
        ),
      ]);
      if (!loadFence.current.isCurrent(generation)) return;
      applyState(next);
      setMemories(nextMemories);
      setLoadFailed(false);
    } catch (error) {
      if (!loadFence.current.isCurrent(generation)) return;
      setLoadFailed(true);
      throw error;
    } finally {
      if (loadFence.current.isCurrent(generation)) setLoading(false);
    }
  }

  function applyState(next: ProjectContextState) {
    setState(next);
    setSelectedProjectId((current) => {
      if (current && next.projects.some((project) => project.id === current)) return current;
      return next.projects[0]?.id ?? null;
    });
  }

  async function refreshCurrentConversation() {
    const generation = conversationFence.current.begin();
    try {
      const conversation = await sidepanelRuntimeClient.request(
        { type: 'GET_CURRENT_DEEPSEEK_CONVERSATION' },
        { acceptFailure: true, decode: decodeCurrentConversationResponse },
      );
      if (conversationFence.current.isCurrent(generation)) {
        setCurrentConversation(conversation);
      }
    } catch (error) {
      if (!conversationFence.current.isCurrent(generation)) return;
      showProjectError(error);
    }
  }

  async function createProject() {
    if (!name.trim()) return;
    try {
      banner.clear();
      const project = await sidepanelRuntimeClient.request(
        { type: 'CREATE_PROJECT_CONTEXT', payload: { name, instructions } },
        {
          unavailableMessage: t('sidepanel.projectsPage.backendUnavailable'),
          decode(value) {
            if (value === null) throw new Error(t('sidepanel.projectsPage.backendUnavailable'));
            return decodeProjectContext(value, 'CREATE_PROJECT_CONTEXT response');
          },
        },
      );
      setName('');
      setInstructions('');
      setSelectedProjectId(project.id);
      banner.show('success', t('sidepanel.projectsPage.projectCreated', { name: project.name }));
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function saveProject() {
    if (!editing || !editName.trim()) return;
    try {
      banner.clear();
      await runProjectMutation({
        type: 'UPDATE_PROJECT_CONTEXT',
        payload: {
          projectId: editing.id,
          patch: {
            name: editName,
            description: editDescription,
            instructions: editInstructions,
          },
        },
      });
      banner.show('success', t('common.saveChanges'));
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function deleteProject(project: ProjectContext) {
    const ok = await confirm({
      title: t('sidepanel.projectsPage.deleteConfirm', { name: project.name }),
      message: t('sidepanel.projectsPage.deleteConfirm', { name: project.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      await runProjectMutation({
        type: 'DELETE_PROJECT_CONTEXT',
        payload: { projectId: project.id },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function addCurrentConversation() {
    if (!selectedProject || !currentConversation) return;
    try {
      await runProjectMutation({
        type: 'ADD_CONVERSATION_TO_PROJECT',
        payload: {
          projectId: selectedProject.id,
          conversation: currentConversation,
        },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function removeConversation(conversation: ProjectConversation) {
    try {
      await runProjectMutation({
        type: 'REMOVE_CONVERSATION_FROM_PROJECT',
        payload: { conversationId: conversation.conversationId },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function setPending(projectId: string | null) {
    try {
      await runProjectMutation({
        type: 'SET_PENDING_PROJECT_CONTEXT',
        payload: { projectId },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function saveProjectMemory(memory: NewMemory) {
    if (!selectedProject) return;
    try {
      if (editingMemory?.id) {
        await runProjectMutation({
          type: 'UPDATE_MEMORY',
          payload: {
            ...editingMemory,
            ...memory,
            scope: 'project',
            projectId: selectedProject.id,
            updatedAt: Date.now(),
          },
        });
      } else {
        await runProjectMutation({
          type: 'SAVE_MEMORY',
          payload: {
            ...memory,
            scope: 'project',
            projectId: selectedProject.id,
          },
        });
      }
      setShowMemoryForm(false);
      setEditingMemory(null);
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function deleteMemory(id: number) {
    try {
      await runProjectMutation({ type: 'DELETE_MEMORY', payload: { id } });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  async function toggleMemoryPin(memory: Memory) {
    try {
      await runProjectMutation({
        type: 'UPDATE_MEMORY',
        payload: { ...memory, pinned: !memory.pinned },
      });
      await loadAll();
    } catch (error) {
      showProjectError(error);
    }
  }

  function showProjectError(error: unknown) {
    banner.show('error', t('sidepanel.projectsPage.operationFailed', { error: getRuntimeErrorMessage(error) }));
  }

  async function runProjectMutation(message: ProjectMutationRequest): Promise<void> {
    await sidepanelRuntimeClient.request(message, {
      unavailableMessage: t('sidepanel.projectsPage.backendUnavailable'),
    });
  }

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.projectsPage.title')}
        description={t('sidepanel.projectsPage.description')}
        meta={t('sidepanel.projectsPage.summary', {
          projects: state.projects.length,
          conversations: state.conversations.length,
        })}
      />

      <section className="ds-surface-panel rounded-xl p-4 space-y-3">
        <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>
          {t('sidepanel.projectsPage.createTitle')}
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('sidepanel.projectsPage.namePlaceholder')}
          className="w-full px-3 py-2 text-xs rounded-lg border outline-none"
          style={inputStyle}
        />
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t('sidepanel.projectsPage.instructionsPlaceholder')}
          className="w-full px-3 py-2 text-xs rounded-lg border outline-none min-h-[72px]"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={createProject}
          disabled={!name.trim()}
          className="ds-btn-primary px-3 py-2 text-xs rounded-lg disabled:opacity-40"
        >
          {t('sidepanel.projectsPage.createProject')}
        </button>
      </section>

      {banner.node}
      {confirmNode}

      {loading ? (
        <SkeletonList rows={3} />
      ) : loadFailed && state.projects.length === 0 ? null : state.projects.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <FolderIcon />
          </div>
          <div className="ds-empty-state-title">{t('sidepanel.projectsPage.empty')}</div>
          <div className="ds-empty-state-description">{t('sidepanel.projectsPage.emptyHelp')}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <section className="space-y-2">
            {state.projects.map((project) => {
              const count = state.conversations.filter((conversation) => conversation.projectId === project.id).length;
              const selected = project.id === selectedProject?.id;
              const pending = project.id === state.pendingProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                  className="w-full ds-surface-panel p-3 rounded-xl flex items-center gap-3 text-left transition-all duration-150"
                  style={{
                    borderColor: selected ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                    background: selected ? 'var(--ds-blue-light)' : 'var(--ds-surface-panel)',
                  }}
                >
                  <span className="shrink-0" style={{ color: selected ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)' }}>
                    <FolderIcon />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>{project.name}</span>
                    <span className="block text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                      {t('sidepanel.projectsPage.conversationCount', { count })}
                    </span>
                  </span>
                  {pending && (
                    <StatusBadge
                      configured
                      configuredLabel={t('sidepanel.projectsPage.pendingBadge')}
                      notConfiguredLabel={t('sidepanel.projectsPage.pendingBadge')}
                    />
                  )}
                </button>
              );
            })}
          </section>

          {selectedProject && editing && (
            <section className="ds-surface-panel rounded-xl p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: 'var(--ds-text)' }}>{selectedProject.name}</div>
                  <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                    {t('sidepanel.projectsPage.detailMeta', {
                      conversations: projectConversations.length,
                      memories: projectMemories.length,
                    })}
                  </div>
                </div>
                <button type="button" onClick={() => deleteProject(selectedProject)} className="ds-btn-danger px-2 py-1 text-[11px] rounded-md">
                  {t('sidepanel.projectsPage.deleteProject')}
                </button>
              </div>

              <div className="space-y-2">
                <input
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  placeholder={t('sidepanel.projectsPage.namePlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border outline-none"
                  style={inputStyle}
                />
                <input
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  placeholder={t('sidepanel.projectsPage.descriptionPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border outline-none"
                  style={inputStyle}
                />
                <textarea
                  value={editInstructions}
                  onChange={(event) => setEditInstructions(event.target.value)}
                  placeholder={t('sidepanel.projectsPage.instructionsPlaceholder')}
                  className="w-full px-3 py-2 text-xs rounded-lg border outline-none min-h-[96px]"
                  style={inputStyle}
                />
                <button type="button" onClick={saveProject} disabled={!editName.trim()} className="ds-btn-primary px-3 py-2 text-xs rounded-lg disabled:opacity-40">
                  {t('common.saveChanges')}
                </button>
              </div>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.projectsPage.currentConversation')}</div>
                  <button type="button" onClick={refreshCurrentConversation} className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md">
                    {t('common.refresh')}
                  </button>
                </div>
                <div className="rounded-lg border px-3 py-2 space-y-2" style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-bg)' }}>
                  <div className="text-[11px] truncate" style={{ color: 'var(--ds-text-secondary)' }}>
                    {currentConversation
                      ? currentConversation.title
                      : t('sidepanel.projectsPage.noCurrentConversation')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={addCurrentConversation}
                      disabled={!currentConversation}
                      className="ds-btn-primary px-3 py-1.5 text-[11px] rounded-md disabled:opacity-40"
                    >
                      {currentConversationProject
                        ? t('sidepanel.projectsPage.moveCurrentConversation')
                        : t('sidepanel.projectsPage.addCurrentConversation')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPending(state.pendingProjectId === selectedProject.id ? null : selectedProject.id)}
                      className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-md"
                    >
                      {state.pendingProjectId === selectedProject.id
                        ? t('sidepanel.projectsPage.cancelNextConversation')
                        : t('sidepanel.projectsPage.useNextConversation')}
                    </button>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.projectsPage.conversationsTitle')}</div>
                {projectConversations.length === 0 ? (
                  <div className="text-[11px] rounded-lg px-3 py-2" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-bg)' }}>
                    {t('sidepanel.projectsPage.emptyConversations')}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {projectConversations.map((conversation) => (
                      <div key={conversation.conversationId} className="flex items-center gap-2 rounded-lg border px-2.5 py-2" style={{ borderColor: 'var(--ds-border)', background: 'var(--ds-bg)' }}>
                        <a href={conversation.url || '#'} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-[11px] truncate" style={{ color: 'var(--ds-text)' }}>
                          {conversation.title}
                        </a>
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--ds-text-tertiary)' }}>
                          {formatAge(conversation.lastSeenAt, t)}
                        </span>
                        <button type="button" onClick={() => removeConversation(conversation)} className="ds-btn-secondary px-2 py-1 text-[10px] rounded-md">
                          {t('common.remove')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold" style={{ color: 'var(--ds-text)' }}>{t('sidepanel.projectsPage.memoriesTitle')}</div>
                  <button
                    type="button"
                    onClick={() => { setEditingMemory(null); setShowMemoryForm(!showMemoryForm); }}
                    className="ds-btn-secondary px-2 py-1 text-[11px] rounded-md"
                  >
                    {t('common.add')}
                  </button>
                </div>
                {showMemoryForm && (
                  <MemoryForm
                    initial={editingMemory}
                    onSave={saveProjectMemory}
                    onCancel={() => { setShowMemoryForm(false); setEditingMemory(null); }}
                  />
                )}
                {projectMemories.length === 0 ? (
                  <div className="text-[11px] rounded-lg px-3 py-2" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-bg)' }}>
                    {t('sidepanel.projectsPage.emptyMemories')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {projectMemories.map((memory) => (
                      <MemoryCard
                        key={memory.id}
                        memory={memory}
                        onDelete={() => deleteMemory(memory.id!)}
                        onEdit={() => { setEditingMemory(memory); setShowMemoryForm(true); }}
                        onTogglePin={() => toggleMemoryPin(memory)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  background: 'var(--ds-bg)',
  borderColor: 'var(--ds-border)',
  color: 'var(--ds-text)',
};

function FolderIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function decodeCurrentConversationResponse(value: unknown): CurrentDeepSeekConversation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid GET_CURRENT_DEEPSEEK_CONVERSATION response.');
  }
  const response = value as Record<string, unknown>;
  if (response.ok === false) return null;
  if (response.ok !== true) {
    throw new Error('Invalid GET_CURRENT_DEEPSEEK_CONVERSATION response.');
  }
  return decodeCurrentDeepSeekConversation(
    response.conversation,
    'GET_CURRENT_DEEPSEEK_CONVERSATION response.conversation',
  );
}

function formatAge(timestamp: number, t: ReturnType<typeof useI18n>['t']): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return t('sidepanel.memory.age.justNow');
  if (mins < 60) return t('sidepanel.memory.age.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sidepanel.memory.age.hoursAgo', { count: hours });
  return t('sidepanel.memory.age.daysAgo', { count: Math.floor(hours / 24) });
}
