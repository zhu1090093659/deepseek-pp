import { useState } from 'react';
import type { Memory, MemoryType } from '../../../core/types';
import { MEMORY_TYPE_CONFIG } from '../constants';

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
    <form onSubmit={handleSubmit} className="ds-form rounded-xl p-4 space-y-3">
      <div className="flex gap-1.5">
        {MEMORY_TYPE_CONFIG.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className="px-2.5 py-1 text-[11px] rounded-md font-medium transition-all duration-150"
            style={{
              background: type === t.key ? t.bg : 'var(--ds-surface)',
              color: type === t.key ? t.color : 'var(--ds-text-tertiary)',
              border: `1px solid ${type === t.key ? t.color + '33' : 'var(--ds-border)'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="标题"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <textarea
        placeholder="内容"
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg resize-none transition-all duration-150"
      />

      <input
        type="text"
        placeholder="标签（逗号分隔）"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <div className="flex gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="ds-btn-cancel px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all duration-150"
        >
          取消
        </button>
        <button
          type="submit"
          className="ds-btn-primary px-4 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150"
        >
          {initial ? '更新' : '保存'}
        </button>
      </div>
    </form>
  );
}
