import { useEffect, useRef, useState } from 'react';
import type { ScenarioConfig } from '../../../core/types';
import { createRequestGenerationFence } from '../async-state';
import { createScenarioController } from '../controllers/scenario-controller';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage } from '../runtime-response';
import { useBanner } from './settings/primitives';

const scenarioController = createScenarioController();

export default function ScenarioManager() {
  const { t } = useI18n();
  const [scenarios, setScenarios] = useState<ScenarioConfig[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTemplate, setEditTemplate] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTemplate, setNewTemplate] = useState('');
  const banner = useBanner();
  const requestFence = useRef(createRequestGenerationFence());

  useEffect(() => {
    const generation = requestFence.current.begin();
    void scenarioController.getAll()
      .then((next) => {
        if (requestFence.current.isCurrent(generation)) setScenarios(next);
      })
      .catch((error) => {
        if (!requestFence.current.isCurrent(generation)) return;
        banner.show('error', t('sidepanel.scenario.operationFailed', { error: getRuntimeErrorMessage(error) }));
      });
    return () => requestFence.current.invalidate();
  }, []);

  const toggleEnabled = async (scenario: ScenarioConfig) => {
    const next = { ...scenario, enabled: !scenario.enabled };
    await runMutation(
      { operation: 'save', scenario: next },
      (items) => items.some((item) => item.id === next.id && item.enabled === next.enabled),
    );
  };

  const startEdit = (scenario: ScenarioConfig) => {
    setEditingId(scenario.id);
    setEditTemplate(scenario.template);
  };

  const saveTemplate = async (scenario: ScenarioConfig) => {
    const next = { ...scenario, template: editTemplate };
    await runMutation(
      { operation: 'save', scenario: next },
      (items) => items.some((item) => item.id === next.id && item.template === next.template),
      () => {
        setEditingId(null);
      },
    );
  };

  const handleAdd = async () => {
    if (!newLabel.trim() || !newTemplate.trim()) return;
    const label = newLabel.trim();
    const template = newTemplate.trim();
    await runMutation(
      { operation: 'add', label, template },
      (items) => items.some((item) => !item.builtIn && item.label === label && item.template === template),
      () => {
        setNewLabel('');
        setNewTemplate('');
      },
    );
  };

  const handleDelete = async (id: string) => {
    await runMutation(
      { operation: 'delete', id },
      (items) => items.every((item) => item.id !== id),
    );
  };

  const runMutation = async (
    request:
      | { operation: 'save'; scenario: ScenarioConfig }
      | { operation: 'add'; label: string; template: string }
      | { operation: 'delete'; id: string },
    wasCommitted: (items: ScenarioConfig[]) => boolean,
    onCommitted?: () => void,
  ) => {
    const generation = requestFence.current.begin();
    try {
      banner.clear();
      const next = await scenarioController.mutate(request);
      if (!requestFence.current.isCurrent(generation)) return;
      setScenarios(next);
      onCommitted?.();
      return;
    } catch (error) {
      if (!requestFence.current.isCurrent(generation)) return;
      try {
        const next = await scenarioController.getAll();
        if (!requestFence.current.isCurrent(generation)) return;
        setScenarios(next);
        if (wasCommitted(next)) {
          onCommitted?.();
          banner.show('warning', t('sidepanel.scenario.savedButMenuFailed', {
            error: getRuntimeErrorMessage(error),
          }));
          return;
        }
      } catch (reloadError) {
        if (!requestFence.current.isCurrent(generation)) return;
        banner.show('warning', t('sidepanel.scenario.savedButReloadFailed', {
          error: getRuntimeErrorMessage(reloadError),
        }));
        return;
      }
      banner.show('error', t('sidepanel.scenario.operationFailed', {
        error: getRuntimeErrorMessage(error),
      }));
    }
  };

  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <h2 className="ds-settings-section-title">
          {t('sidepanel.scenario.title')}
        </h2>
        <p className="ds-settings-section-description">
          {t('sidepanel.scenario.description')}
        </p>
      </div>
      {banner.node}
      <div className="ds-surface-panel rounded-xl p-4 space-y-1">
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
              <button onClick={() => saveTemplate(s)} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: '#fff' }}>{t('common.save')}</button>
            </div>
          ) : (
            <button onClick={() => startEdit(s)} className="text-xs" style={{ color: 'var(--ds-text-tertiary)' }}>{t('common.edit')}</button>
          )}
        </div>
      ))}

      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--ds-border)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.scenario.customTitle')}</span>
        {scenarios.filter((s) => !s.builtIn).map((s) => (
          <div key={s.id} className="flex items-center gap-2 py-1.5">
            <label className="switch">
              <input type="checkbox" checked={s.enabled} onChange={() => toggleEnabled(s)} />
              <span className="slider" />
            </label>
            <span className="text-sm flex-1" style={{ color: 'var(--ds-text)' }}>{s.label}</span>
            <button onClick={() => handleDelete(s.id)} className="text-xs text-red-400">{t('common.delete')}</button>
          </div>
        ))}
        <div className="flex gap-1 mt-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('sidepanel.scenario.namePlaceholder')}
            className="text-xs px-2 py-1 rounded flex-1"
            style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
          />
          <input
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value)}
            placeholder={t('sidepanel.scenario.templatePlaceholder')}
            className="text-xs px-2 py-1 rounded flex-[2]"
            style={{ background: 'var(--ds-surface)', color: 'var(--ds-text)', border: '1px solid var(--ds-border)' }}
          />
          <button onClick={handleAdd} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--ds-accent)', color: '#fff' }}>{t('common.add')}</button>
        </div>
      </div>
      </div>
    </section>
  );
}
