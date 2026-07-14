import { useEffect, useState } from 'react';
import { decodePersistedMemoryRecord } from '../../../core/memory/codec';
import type { Memory, MemoryType, NewMemory } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { SegmentedControl, SkeletonList, useBanner, useConfirm } from '../components/settings/primitives';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage, unwrapRuntimeResponse } from '../runtime-response';

export default function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const banner = useBanner();
  const { confirm, node: confirmNode } = useConfirm();

  const load = async () => {
    try {
      const response = unwrapRuntimeResponse<unknown>(
        await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }),
        t('sidepanel.memoryPage.backendUnavailable'),
      );
      if (!Array.isArray(response)) throw new Error(t('sidepanel.memoryPage.backendUnavailable'));
      const list = response.map((memory, index) => (
        decodePersistedMemoryRecord(memory, `memoryResponse[${index}]`)
      ));
      setMemories(list.filter((memory) => memory.scope !== 'project'));
      setLoadFailed(false);
    } catch (error) {
      setLoadFailed(true);
      banner.show('error', t('sidepanel.memoryPage.operationFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();

    const handleStateUpdate = (message: { type?: string; memories?: unknown }) => {
      if (message.type === 'STATE_UPDATED') {
        try {
          if (!Array.isArray(message.memories)) {
            throw new Error(t('sidepanel.memoryPage.backendUnavailable'));
          }
          const next = message.memories.map((memory, index) => (
            decodePersistedMemoryRecord(memory, `memoryUpdate[${index}]`)
          ));
          setMemories(next.filter((memory) => memory.scope !== 'project'));
          setLoadFailed(false);
        } catch (error) {
          setLoadFailed(true);
          banner.show('error', t('sidepanel.memoryPage.operationFailed', {
            error: getRuntimeErrorMessage(error),
          }));
        }
      }
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) void load();
    };

    chrome.runtime.onMessage.addListener(handleStateUpdate);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);

    return () => {
      chrome.runtime.onMessage.removeListener(handleStateUpdate);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
    };
  }, []);

  const filtered = filter === 'all' ? memories : memories.filter((m) => m.type === filter);
  const filterTypes = [
    { key: 'all' as const, label: t('common.all') },
    ...MEMORY_TYPE_CONFIG.map((typeConfig) => ({
      key: typeConfig.key,
      label: t(typeConfig.labelKey),
    })),
  ];

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: t('sidepanel.memoryPage.deleteConfirm'),
      message: t('sidepanel.memoryPage.deleteConfirm'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      banner.clear();
      unwrapRuntimeResponse(
        await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } }),
        t('sidepanel.memoryPage.backendUnavailable'),
      );
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.memoryPage.operationFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  const handleSave = async (mem: NewMemory) => {
    try {
      banner.clear();
      const response = editingMemory?.id
        ? await chrome.runtime.sendMessage({
          type: 'UPDATE_MEMORY',
          payload: { ...editingMemory, ...mem, updatedAt: Date.now() },
        })
        : await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: mem });
      unwrapRuntimeResponse(response, t('sidepanel.memoryPage.backendUnavailable'));
      setShowForm(false);
      setEditingMemory(null);
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.memoryPage.operationFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  const handleEdit = (mem: Memory) => {
    setEditingMemory(mem);
    setShowForm(true);
  };

  const handleTogglePin = async (mem: Memory) => {
    try {
      banner.clear();
      unwrapRuntimeResponse(
        await chrome.runtime.sendMessage({
          type: 'UPDATE_MEMORY',
          payload: { ...mem, pinned: !mem.pinned },
        }),
        t('sidepanel.memoryPage.backendUnavailable'),
      );
      await load();
    } catch (error) {
      banner.show('error', t('sidepanel.memoryPage.operationFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
      />

      <div className="flex items-center justify-between gap-2">
        <SegmentedControl
          options={filterTypes}
          value={filter}
          onChange={(key) => setFilter(key)}
          ariaLabel={t('sidepanel.memoryPage.title')}
          size="sm"
        />
        <button
          onClick={() => { setEditingMemory(null); setShowForm(!showForm); }}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('common.add')}
        </button>
      </div>

      {confirmNode}
      {banner.node}

      {showForm && (
        <div className="animate-slide-down">
          <MemoryForm
            initial={editingMemory}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingMemory(null); }}
          />
        </div>
      )}

      {loading ? (
        <SkeletonList rows={3} />
      ) : !loadFailed && filtered.length === 0 ? (
        <div className="ds-empty-state">
          <div className="ds-empty-state-icon">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
            </svg>
          </div>
          <div className="ds-empty-state-title">
            {memories.length === 0 ? t('sidepanel.memoryPage.emptyAll') : t('sidepanel.memoryPage.emptyFiltered')}
          </div>
          {memories.length === 0 && (
            <div className="ds-empty-state-description">
              {t('sidepanel.memoryPage.emptyHelp')}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              onDelete={() => handleDelete(m.id!)}
              onEdit={() => handleEdit(m)}
              onTogglePin={() => handleTogglePin(m)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
