import type { Skill } from '../../../core/types';

interface Props {
  skill: Skill;
  onDelete?: () => void;
}

export default function SkillCard({ skill, onDelete }: Props) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="text-emerald-400 text-sm font-mono">{skill.trigger}</code>
          <span className="text-sm text-white">{skill.name}</span>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-xs text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
          >
            删除
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1">{skill.description}</p>
      {skill.memoryEnabled && (
        <span className="inline-block mt-1.5 text-[10px] text-emerald-500/70 bg-emerald-500/10 px-1.5 py-0.5 rounded">
          含记忆注入
        </span>
      )}
    </div>
  );
}
