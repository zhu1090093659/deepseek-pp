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
    <form onSubmit={handleSubmit} className="bg-slate-800 rounded-lg p-3 border border-slate-600 space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
        />
        <input
          type="text"
          placeholder="/trigger"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="w-28 px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-emerald-400 font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
        />
      </div>

      <input
        type="text"
        placeholder="描述"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
      />

      <div>
        <label className="text-[10px] text-slate-500 mb-1 block">
          Prompt 模板（用 {'{{content}}'} 表示用户输入）
        </label>
        <textarea
          rows={4}
          value={promptTemplate}
          onChange={(e) => setPromptTemplate(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 resize-none"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
        <input
          type="checkbox"
          checked={memoryEnabled}
          onChange={(e) => setMemoryEnabled(e.target.checked)}
          className="accent-emerald-500"
        />
        启用记忆注入
      </label>

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
          保存
        </button>
      </div>
    </form>
  );
}
