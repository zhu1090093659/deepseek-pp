import { useEffect, useState } from 'react';
import type { Skill } from '../../../core/types';
import SkillCard from '../components/SkillCard';
import SkillForm from '../components/SkillForm';

export default function SkillPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    const list: Skill[] = await chrome.runtime.sendMessage({ type: 'GET_SKILLS' });
    setSkills(list ?? []);
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (name: string) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_SKILL', payload: { name } });
    load();
  };

  const handleSave = async (skill: Skill) => {
    await chrome.runtime.sendMessage({ type: 'SAVE_SKILL', payload: skill });
    setShowForm(false);
    load();
  };

  const builtIn = skills.filter((s) => s.builtIn);
  const custom = skills.filter((s) => !s.builtIn);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-300">可用 Skill</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          + 自定义
        </button>
      </div>

      {showForm && (
        <SkillForm onSave={handleSave} onCancel={() => setShowForm(false)} />
      )}

      {builtIn.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs text-slate-500 uppercase tracking-wider">内置</h3>
          {builtIn.map((s) => (
            <SkillCard key={s.name} skill={s} />
          ))}
        </div>
      )}

      {custom.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs text-slate-500 uppercase tracking-wider">自定义</h3>
          {custom.map((s) => (
            <SkillCard key={s.name} skill={s} onDelete={() => handleDelete(s.name)} />
          ))}
        </div>
      )}

      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
        <p className="text-xs text-slate-400">
          在 DeepSeek 输入框中输入 <code className="text-emerald-400">/skill名 参数</code> 触发。
          例如：<code className="text-emerald-400">/translate 你好世界</code>
        </p>
      </div>
    </div>
  );
}
