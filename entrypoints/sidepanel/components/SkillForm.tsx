import { useState } from 'react';
import type { Skill } from '../../../core/types';

interface Props {
  onSave: (skill: Skill) => void;
  onCancel: () => void;
}

export default function SkillForm({ onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('/');
  const [description, setDescription] = useState('');
  const [promptTemplate, setPromptTemplate] = useState('{{content}}');
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !trigger.trim() || !promptTemplate.trim()) return;
    onSave({
      name: name.trim(),
      trigger: trigger.startsWith('/') ? trigger.trim() : `/${trigger.trim()}`,
      description: description.trim(),
      promptTemplate: promptTemplate.trim(),
      memoryEnabled,
      builtIn: false,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="ds-form rounded-xl p-4 space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="ds-input flex-1 px-3 py-2 text-sm rounded-lg transition-all duration-150"
        />
        <input
          type="text"
          placeholder="/trigger"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="w-28 px-3 py-2 text-sm font-mono rounded-lg transition-all duration-150"
          style={{
            background: 'var(--ds-blue-light)',
            border: '1px solid rgba(77, 107, 254, 0.2)',
            color: 'var(--ds-blue)',
          }}
        />
      </div>

      <input
        type="text"
        placeholder="描述"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="ds-input w-full px-3 py-2 text-sm rounded-lg transition-all duration-150"
      />

      <div>
        <label className="text-[11px] mb-1.5 block font-medium" style={{ color: 'var(--ds-text-tertiary)' }}>
          Prompt 模板（用 {'{{content}}'} 表示用户输入）
        </label>
        <textarea
          rows={4}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
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
