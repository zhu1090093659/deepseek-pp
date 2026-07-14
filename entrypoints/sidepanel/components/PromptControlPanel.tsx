import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  type ForcedResponseLanguage,
  type PromptInjectionSettings,
  type PromptPresetCadence,
} from '../../../core/prompt/settings';
import { createRequestGenerationFence } from '../async-state';
import { useI18n } from '../i18n';
import { getRuntimeErrorMessage } from '../runtime-response';
import { sidepanelRuntimeClient } from '../runtime-client';

export default function PromptControlPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PromptInjectionSettings>(DEFAULT_PROMPT_INJECTION_SETTINGS);
  const [statusMessage, setStatusMessage] = useState('');
  const requestFence = useRef(createRequestGenerationFence());

  useEffect(() => {
    const generation = requestFence.current.begin();
    sidepanelRuntimeClient.request(
      { type: 'GET_PROMPT_INJECTION_SETTINGS' },
      {
        unavailableMessage: t('sidepanel.promptControls.backendUnavailable'),
        decode: (value) => decodePromptSettings(
          value,
          t('sidepanel.promptControls.backendUnavailable'),
        ),
      },
    )
      .then((loaded) => {
        if (requestFence.current.isCurrent(generation)) setSettings(loaded);
      })
      .catch((error) => {
        if (!requestFence.current.isCurrent(generation)) return;
        setSettings(DEFAULT_PROMPT_INJECTION_SETTINGS);
        setStatusMessage(t('sidepanel.promptControls.loadFailed', { error: getRuntimeErrorMessage(error) }));
      });
    return () => requestFence.current.invalidate();
  }, [t]);

  const save = async (patch: Partial<PromptInjectionSettings>) => {
    const previous = settings;
    const next = normalizePromptInjectionSettings({ ...settings, ...patch });
    setSettings(next);
    setStatusMessage('');
    const generation = requestFence.current.begin();
    try {
      const saved = await sidepanelRuntimeClient.request(
        {
          type: 'SAVE_PROMPT_INJECTION_SETTINGS',
          payload: next,
        },
        {
          unavailableMessage: t('sidepanel.promptControls.backendUnavailable'),
          decode: (value) => decodePromptSettings(
            value,
            t('sidepanel.promptControls.backendUnavailable'),
          ),
        },
      );
      if (requestFence.current.isCurrent(generation)) setSettings(saved);
    } catch (error) {
      if (!requestFence.current.isCurrent(generation)) return;
      setSettings(previous);
      setStatusMessage(t('sidepanel.promptControls.saveFailed', { error: getRuntimeErrorMessage(error) }));
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
        {t('sidepanel.promptControls.title')}
      </h2>
      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <ToggleRow
          title={t('sidepanel.promptControls.memory')}
          description={t('sidepanel.promptControls.memoryDescription')}
          enabled={settings.memoryEnabled}
          onToggle={(enabled) => save({ memoryEnabled: enabled })}
        />
        <ToggleRow
          title={t('sidepanel.promptControls.systemPrompt')}
          description={t('sidepanel.promptControls.systemPromptDescription')}
          enabled={settings.systemPromptEnabled}
          onToggle={(enabled) => save({ systemPromptEnabled: enabled })}
        />

        <label className="block space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.promptControls.presetCadence')}
          </span>
          <select
            value={settings.presetCadence}
            onChange={(event) => save({ presetCadence: event.target.value as PromptPresetCadence })}
            className="w-full px-3 py-2 text-xs rounded-lg border outline-none"
            style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
          >
            <option value="default">{t('sidepanel.promptControls.cadenceDefault')}</option>
            <option value="first_message">{t('sidepanel.promptControls.cadenceFirst')}</option>
            <option value="every_message">{t('sidepanel.promptControls.cadenceEvery')}</option>
            <option value="off">{t('sidepanel.promptControls.cadenceOff')}</option>
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.promptControls.forceLanguage')}
          </span>
          <select
            value={settings.forceResponseLanguage}
            onChange={(event) => save({ forceResponseLanguage: event.target.value as ForcedResponseLanguage })}
            className="w-full px-3 py-2 text-xs rounded-lg border outline-none"
            style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
          >
            <option value="auto">{t('sidepanel.promptControls.languageAuto')}</option>
            <option value="zh-CN">{t('sidepanel.promptControls.languageZh')}</option>
            <option value="en">{t('sidepanel.promptControls.languageEn')}</option>
          </select>
        </label>

        {statusMessage && (
          <div className="text-[11px] rounded-lg px-2 py-1.5" style={{ color: 'var(--ds-text-secondary)', background: 'var(--ds-surface)' }}>
            {statusMessage}
          </div>
        )}
      </div>
    </section>
  );
}

function decodePromptSettings(value: unknown, missingMessage: string): PromptInjectionSettings {
  if (value === null) throw new Error(missingMessage);
  return normalizePromptInjectionSettings(value);
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <div>
        <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>{title}</div>
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
          {description}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200"
        style={{ background: enabled ? 'var(--ds-blue)' : 'var(--ds-border)' }}
      >
        <span
          className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
          style={{ transform: enabled ? 'translateX(18px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}
