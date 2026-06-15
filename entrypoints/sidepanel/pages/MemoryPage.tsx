import { useEffect, useState } from 'react';
import type { Memory, MemoryType, NewMemory } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import PageIntro from '../components/PageIntro';
import { MEMORY_TYPE_CONFIG } from '../constants';
import { useI18n } from '../i18n';

export default function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);

  const load = async () => {
    const list: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    setMemories((list ?? []).filter((memory) => memory.scope !== 'project'));
  };

  useEffect(() => {
    void load();

    const handleStateUpdate = (message: { type?: string; memories?: Memory[] }) => {
      if (message.type === 'STATE_UPDATED' && Array.isArray(message.memories)) {
        setMemories(message.memories.filter((memory) => memory.scope !== 'project'));
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
    await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
    load();
  };

  const handleSave = async (mem: NewMemory) => {
    if (editingMemory?.id) {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_MEMORY',
        payload: { ...editingMemory, ...mem, updatedAt: Date.now() },
      });
    } else {
      await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: mem });
    }
    setShowForm(false);
    setEditingMemory(null);
    load();
  };

  const handleEdit = (mem: Memory) => {
    setEditingMemory(mem);
    setShowForm(true);
  };

  const handleTogglePin = async (mem: Memory) => {
    await chrome.runtime.sendMessage({
      type: 'UPDATE_MEMORY',
      payload: { ...mem, pinned: !mem.pinned },
    });
    load();
  };

  return (
    <div className="p-4 space-y-3">
      <PageIntro
        title={t('sidepanel.memoryPage.title')}
        description={t('sidepanel.memoryPage.description')}
        meta={t('sidepanel.memoryPage.count', { count: memories.length })}
      />

      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {filterTypes.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className="px-2.5 py-1 text-xs rounded-full transition-all duration-150"
              style={{
                background: filter === t.key ? 'var(--ds-blue-light)' : 'var(--ds-surface)',
                color: filter === t.key ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                fontWeight: filter === t.key ? 500 : 400,
                border: `1px solid ${filter === t.key ? 'var(--ds-selected-border)' : 'var(--ds-border)'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
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

      {showForm && (
        <div className="animate-slide-down">
          <MemoryForm
            initial={editingMemory}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingMemory(null); }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
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
