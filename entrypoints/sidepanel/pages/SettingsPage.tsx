import { useEffect, useState } from 'react';
import type { Memory } from '../../../core/types';

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
    <div className="p-4 space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">数据管理</h2>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">记忆总数</span>
            <span className="text-white">{memoryCount}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="flex-1 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            导出记忆
          </button>
          <button
            onClick={handleImport}
            className="flex-1 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
          >
            导入记忆
          </button>
        </div>

        <button
          onClick={handleClearAll}
          className="w-full py-2 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors border border-red-900/30"
        >
          清除所有记忆
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-300">关于</h2>
        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700 text-xs text-slate-400 space-y-1">
          <div>DeepSeek++ v{version}</div>
          <div>为 DeepSeek 提供 Agentic 记忆与 Skill 能力</div>
        </div>
      </section>
    </div>
  );
}
