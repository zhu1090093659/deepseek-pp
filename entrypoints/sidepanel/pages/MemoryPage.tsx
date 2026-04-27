import { useEffect, useState } from 'react';
import type { Memory, MemoryType } from '../../../core/types';
import MemoryCard from '../components/MemoryCard';
import MemoryForm from '../components/MemoryForm';

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

  const types: { key: MemoryType | 'all'; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'user', label: '用户' },
    { key: 'feedback', label: '反馈' },
    { key: 'topic', label: '话题' },
    { key: 'reference', label: '参考' },
  ];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {types.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                filter === t.key
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => { setEditingMemory(null); setShowForm(!showForm); }}
          className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          + 新增
        </button>
      </div>

      {showForm && (
        <MemoryForm
          initial={editingMemory}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingMemory(null); }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-12 text-sm">
          {memories.length === 0 ? '暂无记忆。与 DeepSeek 对话时会自动积累。' : '该分类下暂无记忆。'}
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

      <div className="text-xs text-slate-600 text-center pt-2">
        共 {memories.length} 条记忆
      </div>
    </div>
  );
}
