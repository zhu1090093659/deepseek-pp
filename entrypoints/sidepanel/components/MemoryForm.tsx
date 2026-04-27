import { useState } from 'react';
import type { Memory, MemoryType } from '../../../core/types';

interface Props {
  initial?: Memory | null;
  onSave: (mem: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt'>) => void;
  onCancel: () => void;
}

export default function MemoryForm({ initial, onSave, onCancel }: Props) {
  const [type, setType] = useState<MemoryType>(initial?.type ?? 'topic');
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tags, setTags] = useState(initial?.tags?.join(', ') ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    onSave({
      type,
      name: name.trim(),
      content: content.trim(),
      description: name.trim(),
      tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      pinned: initial?.pinned ?? false,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-800 rounded-lg p-3 border border-slate-600 space-y-3">
      <div className="flex gap-2">
        {(['user', 'feedback', 'topic', 'reference'] as MemoryType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`px-2 py-1 text-xs rounded ${
              type === t ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="标题"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
      />

      <textarea
        placeholder="内容"
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
      />

      <input
        type="text"
        placeholder="标签（逗号分隔）"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
      />

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          取消
        </button>
        <button
          type="submit"
          className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          {initial ? '更新' : '保存'}
        </button>
      </div>
    </form>
  );
}
