import { useEffect, useState } from 'react';
import type { Skill } from '../../../core/types';
import SkillCard from '../components/SkillCard';
import SkillForm from '../components/SkillForm';

function SkillSection({ title, skills, onDelete }: { title: string; skills: Skill[]; onDelete?: (name: string) => void }) {
  if (skills.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wider" style={{ color: 'var(--ds-text-tertiary)' }}>
        {title}
      </h3>
      {skills.map((s) => (
        <SkillCard key={s.name} skill={s} onDelete={onDelete ? () => onDelete(s.name) : undefined} />
      ))}
    </div>
  );
}

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

  const builtin = skills.filter((s) => s.source === 'builtin');
  const custom = skills.filter((s) => s.source === 'custom');

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

      <SkillSection title="内置" skills={builtin} />
      <SkillSection title="自定义" skills={custom} onDelete={handleDelete} />

      <div className="ds-info-panel rounded-xl p-3.5">
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
          在 DeepSeek 输入框中输入{' '}
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /skill名 参数
          </code>{' '}
          触发。例如：
          <code className="ds-code font-mono text-[11px] px-1.5 py-0.5 rounded">
            /frontend-design 做一个登录页
          </code>
        </p>
      </div>
    </div>
  );
}
