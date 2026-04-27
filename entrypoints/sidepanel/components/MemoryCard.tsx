import type { Memory } from '../../../core/types';

interface Props {
  memory: Memory;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  user: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  feedback: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  topic: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  reference: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const TYPE_LABELS: Record<string, string> = {
  user: '用户',
  feedback: '反馈',
  topic: '话题',
  reference: '参考',
};

export default function MemoryCard({ memory, onDelete, onEdit, onTogglePin }: Props) {
  const color = TYPE_COLORS[memory.type] ?? TYPE_COLORS.topic;
  const age = formatAge(memory.createdAt);

  return (
    <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-1.5 py-0.5 text-[10px] rounded border ${color}`}>
            {TYPE_LABELS[memory.type] ?? memory.type}
          </span>
          <span className="text-sm font-medium text-white truncate">{memory.name}</span>
          {memory.pinned && <span className="text-[10px] text-amber-400">📌</span>}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={onTogglePin} className="p-1 text-xs text-slate-400 hover:text-amber-400" title="置顶">
            {memory.pinned ? '📌' : '📍'}
          </button>
          <button onClick={onEdit} className="p-1 text-xs text-slate-400 hover:text-blue-400" title="编辑">
            ✏️
          </button>
          <button onClick={onDelete} className="p-1 text-xs text-slate-400 hover:text-red-400" title="删除">
            🗑️
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-1.5 line-clamp-3">{memory.content}</p>
      <div className="flex items-center justify-between mt-2">
        <div className="flex gap-1 flex-wrap">
          {memory.tags.map((tag) => (
            <span key={tag} className="text-[10px] text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
        <span className="text-[10px] text-slate-600">{age}</span>
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
