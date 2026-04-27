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
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          可用 Skill
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          自定义
        </button>
      </div>

      {showForm && (
        <div className="animate-slide-down">
          <SkillForm onSave={handleSave} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {builtIn.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
            内置
          </h3>
          {builtIn.map((s) => (
            <SkillCard key={s.name} skill={s} />
          ))}
        </div>
      )}

      {custom.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
            自定义
          </h3>
          {custom.map((s) => (
            <SkillCard key={s.name} skill={s} onDelete={() => handleDelete(s.name)} />
          ))}
        </div>
      )}

      <div className="ds-info-panel rounded-xl p-3.5">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          在 DeepSeek 输入框中输入{' '}
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /skill名 参数
          </code>{' '}
          触发。例如：
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /translate 你好世界
          </code>
        </p>
      </div>
    </div>
  );
}
