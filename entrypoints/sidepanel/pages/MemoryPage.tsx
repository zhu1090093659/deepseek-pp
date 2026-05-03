import { useEffect, useState } from 'react';
import type { Memory, MemoryType } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';
import { MEMORY_TYPE_CONFIG } from '../constants';

const FILTER_TYPES: { key: MemoryType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  ...MEMORY_TYPE_CONFIG.map((t) => ({ key: t.key, label: t.label })),
];

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [filter, setFilter] = useState<MemoryType | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);

  const load = async () => {
    const list: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    setMemories(list ?? []);
  };

  useEffect(() => { load(); }, []);

  const filtered = filter === 'all' ? memories : memories.filter((m) => m.type === filter);

  const handleDelete = async (id: number) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id } });
    load();
  };

  const handleSave = async (mem: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'>) => {
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
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {FILTER_TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className="px-2.5 py-1 text-xs rounded-full transition-all duration-150"
              style={{
                background: filter === t.key ? 'var(--ds-blue-light)' : 'var(--ds-surface)',
                color: filter === t.key ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                fontWeight: filter === t.key ? 500 : 400,
                border: `1px solid ${filter === t.key ? 'rgba(77,107,254,0.2)' : 'var(--ds-border)'}`,
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
          新增
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
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl" style={{ background: 'var(--ds-surface)' }}>
            🧠
          </div>
          <p className="text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>
            {memories.length === 0 ? '暂无记忆，对话时会自动积累' : '该分类下暂无记忆'}
          </p>
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

      <div className="text-[11px] text-center pt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
        共 {memories.length} 条记忆
      </div>
    </div>
  );
}
