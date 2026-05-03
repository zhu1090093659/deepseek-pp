import { useState } from 'react';
import type { Skill } from '../../../core/types';

interface Props {
  onSave: (skill: Skill) => void;
  onCancel: () => void;
}

export default function SkillForm({ onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);

  const normalizedName = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizedName || !instructions.trim()) return;
    onSave({
      name: normalizedName,
      description: description.trim(),
      instructions: instructions.trim(),
      source: 'custom',
      memoryEnabled,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-form rounded-xl p-4 space-y-3">
      <div>
        <input
          type="text"
          placeholder="名称（如 my-skill）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
        />
        {normalizedName && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
            触发命令：<code className="font-mono" style={{ color: 'var(--ds-blue)' }}>/{normalizedName}</code>
          </p>
        )}
      </div>

      <input
        type="text"
        placeholder="描述（何时使用这个 skill）"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <div>
        <label className="text-[11px] mb-1.5 block font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
          指令（Markdown 格式，告诉 AI 如何执行）
        </label>
        <textarea
          rows={6}
          placeholder="你是一位...&#10;&#10;## 核心原则&#10;- ..."
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          className="ds-input w-full px-3 py-2 text-sm font-mono rounded-lg resize-none transition-all duration-150"
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: 'var(--ds-text-secondary)' }}>
        <input
          type="checkbox"
          checked={memoryEnabled}
          onChange={(e) => setMemoryEnabled(e.target.checked)}
          className="w-4 h-4 rounded"
          style={{ accentColor: 'var(--ds-blue)' }}
        />
        启用记忆注入
      </label>

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
          保存
        </button>
      </div>
    </form>
  );
}
