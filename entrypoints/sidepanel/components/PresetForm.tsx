import { useState } from 'react';
import type { SystemPromptPreset } from '../../../core/types';

interface Props {
  initial?: SystemPromptPreset;
  onSave: (preset: SystemPromptPreset) => void;
  onCancel: () => void;
}

export default function PresetForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;
    const now = Date.now();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      content: content.trim(),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-form rounded-xl p-4 space-y-3">
      <input
        type="text"
        placeholder="预设名称（如：代码助手、翻译专家）"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <div>
        <label className="text-[11px] mb-1.5 block font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
          系统提示词内容
        </label>
        <textarea
          rows={8}
          placeholder={"你是一位专业的...\\n\\n## 核心原则\\n- ..."}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="ds-input w-full px-3 py-2 text-sm font-mono rounded-lg resize-none transition-all duration-150"
        />
      </div>

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
