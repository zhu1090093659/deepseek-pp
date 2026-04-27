import { useEffect, useState } from 'react';
import type { Memory } from '../../../core/types';
import { SVG_PATHS } from '../constants';

export default function SettingsPage() {
  const [memoryCount, setMemoryCount] = useState(0);
  const [version, setVersion] = useState('');

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_MEMORIES' }).then((list: Memory[]) => {
      setMemoryCount(list?.length ?? 0);
    });
    chrome.runtime.sendMessage({ type: 'GET_CONFIG' }).then((cfg: { version: string }) => {
      setVersion(cfg?.version ?? '');
    });
  }, []);

  const handleExport = async () => {
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deepseek-pp-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const memories: Memory[] = JSON.parse(text);
        for (const mem of memories) {
          const { id, createdAt, updatedAt, accessCount, lastAccessedAt, ...rest } = mem;
          await chrome.runtime.sendMessage({ type: 'SAVE_MEMORY', payload: rest });
        }
        setMemoryCount((c) => c + memories.length);
      } catch {
        alert('JSON 格式错误');
      }
    };
    input.click();
  };

  const handleClearAll = async () => {
    if (!confirm('确定要清除所有记忆吗？此操作不可撤销。')) return;
    const memories: Memory[] = await chrome.runtime.sendMessage({ type: 'GET_MEMORIES' });
    for (const mem of memories) {
      await chrome.runtime.sendMessage({ type: 'DELETE_MEMORY', payload: { id: mem.id } });
    }
    setMemoryCount(0);
  };

  return (
    <div className="p-4 space-y-5">
      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          数据管理
        </h2>

        <div className="ds-surface-panel rounded-xl p-4">
          <div className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--ds-text-secondary)' }}>记忆总数</span>
            <span className="text-lg font-semibold" style={{ color: 'var(--ds-blue)' }}>
              {memoryCount}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
            </svg>
            导出记忆
          </button>
          <button
            onClick={handleImport}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
            导入记忆
          </button>
        </div>

        <button
          onClick={handleClearAll}
          className="ds-btn-danger w-full py-2.5 text-xs font-medium rounded-lg transition-all duration-150"
        >
          清除所有记忆
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          关于
        </h2>
        <div className="ds-surface-panel rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold"
              style={{ background: 'linear-gradient(135deg, var(--ds-blue), #7C8FFF)' }}
            >
              D+
            </div>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>
                DeepSeek++ v{version}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
                Agentic 记忆与 Skill 系统
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
