import { useState, useEffect } from 'react';
import type { ScenarioConfig } from '../../../core/types';
import {
  getAllScenarios,
  saveScenario,
  deleteScenario,
  addCustomScenario,
} from '../../../core/scenario/store';

export default function ScenarioManager() {
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTemplate, setNewTemplate] = useState('');

  useEffect(() => {
    getAllScenarios().then(setScenarios);
  }, []);

  const refresh = async () => {
    const updated = await getAllScenarios();
    setScenarios(updated);
    chrome.runtime.sendMessage({ type: 'SCENARIOS_UPDATED' }).catch(() => {});
  };

  const toggleEnabled = async (scenario: ScenarioConfig) => {
    await saveScenario({ ...scenario, enabled: !scenario.enabled });
    await refresh();
  };

  const startEdit = (scenario: ScenarioConfig) => {
    setEditingId(scenario.id);
    setEditTemplate(scenario.template);
  };

  const saveTemplate = async (scenario: ScenarioConfig) => {
    await saveScenario({ ...scenario, template: editTemplate });
    setEditingId(null);
    await refresh();
  };

  const handleAdd = async () => {
    if (!newLabel.trim() || !newTemplate.trim()) return;
    await addCustomScenario(newLabel.trim(), newTemplate.trim());
    setNewLabel('');
    setNewTemplate('');
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await deleteScenario(id);
    await refresh();
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--ds-text)' }}>
        右键场景
      </h3>
      <p className="text-xs mb-3" style={{ color: 'var(--ds-text-tertiary)' }}>
        选中文本后右键可发送到侧边栏对话
      </p>

      {scenarios.filter((s) => s.builtIn).map((s) => (
        <div key={s.id} className="flex items-center gap-2 py-1.5">
          <label className="switch">
            <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s)} />
            <span className="slider" />
          </label>
          <span className="text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{s.label}</span>
          {editingId === s.id ? (
            <div className="flex gap-1">
              <input
                value={editTemplate}
                onChange={(e) => setEditTemplate(e.target.value)}
                className="text-xs px-2 py-1 rounded w-48"
                style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
              />
              <button onClick={() => saveTemplate(s)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: '#fff' }}>保存</button>
            </div>
          ) : (
            <button onClick={() => startEdit(s)} className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>编辑</button>
          )}
        </div>
      ))}

      <div className="mt-4 pt-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text-secondary)' }}>自定义场景</span>
        {scenarios.filter((s) => !s.builtIn).map((s) => (
          <div key={s.id} className="flex items-center gap-2 py-1.5">
            <label className="switch">
              <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s)} />
              <span className="slider" />
            </label>
            <span className="text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{s.label}</span>
            <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400">删除</button>
          </div>
        ))}
        <div className="flex gap-1 mt-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="场景名称"
            className="text-xs px-2 py-1 rounded flex-1"
            style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
          />
          <input
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value)}
            placeholder="Prompt 模板（含 {text}）"
            className="text-xs px-2 py-1 rounded flex-[2]"
            style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
          />
          <button onClick={handleAdd} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: '#fff' }}>添加</button>
        </div>
      </div>
    </div>
  );
}
