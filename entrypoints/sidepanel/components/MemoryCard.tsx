import type { Memory } from '../../../core/types';
import { MEMORY_TYPE_MAP, SVG_PATHS } from '../constants';

interface Props {
  memory: Memory;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
}

export default function MemoryCard({ memory, onDelete, onEdit, onTogglePin }: Props) {
  const typeInfo = MEMORY_TYPE_MAP[memory.type] ?? MEMORY_TYPE_MAP.topic;
  const age = formatAge(memory.createdAt);

  return (
    <div className="ds-card rounded-xl p-3.5 group animate-fade-in">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="px-1.5 py-0.5 text-[10px] rounded-md font-medium shrink-0"
            style={{
              background: typeInfo.bg,
              color: typeInfo.color,
              border: `1px solid ${typeInfo.border}`,
            }}
          >
            {typeInfo.label}
          </span>
          <span className="text-[13px] font-medium truncate" style={{ color: 'var(--ds-text)' }}>
            {memory.name}
          </span>
          {memory.pinned && (
            <span className="text-[10px] shrink-0" style={{ color: 'var(--ds-warning)' }}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d={SVG_PATHS.star} />
              </svg>
            </span>
          )}
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onTogglePin} className="ds-action-btn ds-action-btn-pin p-1.5 rounded-md" title="置顶">
            <svg className="w-3.5 h-3.5" fill={memory.pinned ? 'currentColor' : 'none'} viewBox="0 0 20 20" stroke="currentColor" strokeWidth={memory.pinned ? 0 : 1.5}>
              <path d={SVG_PATHS.star} />
            </svg>
          </button>
          <button onClick={onEdit} className="ds-action-btn ds-action-btn-edit p-1.5 rounded-md" title="编辑">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.edit} />
            </svg>
          </button>
          <button onClick={onDelete} className="ds-action-btn ds-action-btn-delete p-1.5 rounded-md" title="删除">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.trash} />
            </svg>
          </button>
        </div>
      </div>

      <p className="text-xs mt-2 line-clamp-3 leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
        {memory.content}
      </p>

      <div className="flex items-center justify-between mt-2.5">
        <div className="flex gap-1 flex-wrap">
          {memory.tags.map((tag) => (
            <span key={tag} className="ds-tag text-[10px] px-1.5 py-0.5 rounded-md">
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {age}
        </span>
      </div>
    </div>
  );
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
