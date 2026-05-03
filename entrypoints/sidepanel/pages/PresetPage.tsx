import { useEffect, useRef, useState } from 'react';
import type { SystemPromptPreset } from '../../../core/types';
import PresetCard from '../components/PresetCard';
import PresetForm from '../components/PresetForm';

export default function PresetPage() {
  const [presets, setPresets] = useState<SystemPromptPreset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SystemPromptPreset | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [list, active] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GET_PRESETS' }),
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_PRESET' }),
    ]);
    setPresets(list ?? []);
    setActiveId((active as SystemPromptPreset | null)?.id ?? null);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (preset: SystemPromptPreset) => {
    await chrome.runtime.sendMessage({ type: 'SAVE_PRESET', payload: preset });
    setShowForm(false);
    setEditing(undefined);
    load();
  };

  const handleImportFiles = async (files: FileList) => {
    const entries = await Promise.all(
      Array.from(files, async (file) => ({
        name: file.name.replace(/\.(txt|md)$/i, '').trim(),
        content: (await file.text()).trim(),
      })),
    );
    for (const { name, content } of entries) {
      if (!content) continue;
      const now = Date.now();
      await chrome.runtime.sendMessage({
        type: 'SAVE_PRESET',
        payload: {
          id: crypto.randomUUID(),
          name,
          content,
          createdAt: now,
          updatedAt: now,
        } satisfies SystemPromptPreset,
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    load();
  };

  const handleDelete = async (id: string) => {
    await chrome.runtime.sendMessage({ type: 'DELETE_PRESET', payload: { id } });
    load();
  };

  const handleActivate = async (id: string) => {
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PRESET', payload: { id } });
    setActiveId(id);
    load();
  };

  const handleDeactivate = async () => {
    await chrome.runtime.sendMessage({ type: 'SET_ACTIVE_PRESET', payload: { id: null } });
    setActiveId(null);
    load();
  };

  const handleEdit = (preset: SystemPromptPreset) => {
    setEditing(preset);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditing(undefined);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
          系统提示词预设
        </h2>
        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && handleImportFiles(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="ds-btn-cancel px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            导入
          </button>
          <button
            onClick={() => { setEditing(undefined); setShowForm(!showForm); }}
            className="ds-btn-primary px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-all duration-150 flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            新建
          </button>
        </div>
      </div>

      {showForm && (
        <div className="animate-slide-down">
          <PresetForm initial={editing} onSave={handleSave} onCancel={handleCancel} />
        </div>
      )}

      <div className="space-y-2">
        {presets.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            isActive={p.id === activeId}
            onActivate={() => handleActivate(p.id)}
            onDeactivate={handleDeactivate}
            onEdit={() => handleEdit(p)}
            onDelete={() => handleDelete(p.id)}
          />
        ))}
      </div>

      {presets.length === 0 && !showForm && (
        <div className="ds-info-panel rounded-xl p-3.5">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
            创建系统提示词预设后，选中即可在每次新对话的第一条消息前自动注入，无需手动触发。
          </p>
        </div>
      )}

      {presets.length > 0 && (
        <div className="ds-info-panel rounded-xl p-3.5">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--ds-text-secondary)' }}>
            启用一个预设后，每次新对话的首条消息会自动注入该提示词。同一时间只能激活一个预设。
          </p>
        </div>
      )}
    </div>
  );
}
