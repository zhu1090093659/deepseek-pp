import type { MemoryType } from '../../core/types';

export const MEMORY_TYPE_CONFIG: {
  key: MemoryType;
  label: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  { key: 'user', label: '用户', color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE' },
  { key: 'feedback', label: '反馈', color: '#F59E0B', bg: '#FFFBEB', border: '#FDE68A' },
  { key: 'topic', label: '话题', color: '#8B5CF6', bg: '#F5F3FF', border: '#DDD6FE' },
  { key: 'reference', label: '参考', color: '#10B981', bg: '#ECFDF5', border: '#A7F3D0' },
];

export const MEMORY_TYPE_MAP = Object.fromEntries(
  MEMORY_TYPE_CONFIG.map((t) => [t.key, t]),
) as Record<MemoryType, (typeof MEMORY_TYPE_CONFIG)[number]>;

export const SVG_PATHS = {
  star: 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z',
  plus: 'M12 4v16m8-8H4',
  edit: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
  trash: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
  download: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
  upload: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12',
  chip: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z',
} as const;
