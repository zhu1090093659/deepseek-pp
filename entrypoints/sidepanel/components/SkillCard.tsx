import type { Skill } from '../../../core/types';
import { SVG_PATHS } from '../constants';

interface Props {
  skill: Skill;
  onDelete?: () => void;
}

export default function SkillCard({ skill, onDelete }: Props) {
  return (
    <div className="ds-card rounded-xl p-3.5 group">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <code className="ds-trigger text-[12px] font-mono font-semibold px-1.5 py-0.5 rounded">
            {skill.trigger}
          </code>
          <span className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
            {skill.name}
          </span>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="ds-text-btn-delete text-[11px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150"
          >
            删除
          </button>
        )}
      </div>
      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
        {skill.description}
      </p>
      {skill.memoryEnabled && (
        <span className="ds-badge-success inline-flex items-center gap-1 mt-2 text-[10px] px-2 py-0.5 rounded-full font-medium">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.chip} />
          </svg>
          含记忆注入
        </span>
      )}
    </div>
  );
}
