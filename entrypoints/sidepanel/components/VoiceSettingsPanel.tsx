import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_VOICE_SETTINGS,
  detectVoiceCapabilities,
  normalizeVoiceSettings,
  type VoiceCapabilityState,
  type VoiceSettings,
} from '../../../core/voice/settings';
import { createRequestGenerationFence } from '../async-state';
import { useI18n } from '../i18n';
import { sidepanelRuntimeClient } from '../runtime-client';

export default function VoiceSettingsPanel() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [capabilities, setCapabilities] = useState<VoiceCapabilityState>(detectVoiceCapabilities());
  const loadFence = useRef(createRequestGenerationFence());
  const saveFence = useRef(createRequestGenerationFence());

  useEffect(() => {
    const localCapabilities = detectVoiceCapabilities();
    const generation = loadFence.current.begin();
    Promise.all([
      sidepanelRuntimeClient.request(
        { type: 'GET_VOICE_SETTINGS' },
        { decode: normalizeVoiceSettings },
      ),
      sidepanelRuntimeClient.request(
        { type: 'GET_VOICE_CAPABILITIES' },
        { decode: normalizeVoiceCapabilities },
      ),
    ]).then(([voiceSettings, voiceCapabilities]) => {
      if (!loadFence.current.isCurrent(generation)) return;
      setSettings(voiceSettings);
      setCapabilities({
        speechRecognition: localCapabilities.speechRecognition || voiceCapabilities?.speechRecognition === true,
        speechSynthesis: localCapabilities.speechSynthesis || voiceCapabilities?.speechSynthesis === true,
      });
    }).catch((error) => {
      if (loadFence.current.isCurrent(generation)) {
        console.error('Failed to load voice settings', error);
      }
    });
    return () => {
      loadFence.current.invalidate();
      saveFence.current.invalidate();
    };
  }, []);

  const save = async (patch: Partial<VoiceSettings>) => {
    const next = normalizeVoiceSettings({ ...settings, ...patch });
    setSettings(next);
    loadFence.current.invalidate();
    const generation = saveFence.current.begin();
    try {
      const saved = await sidepanelRuntimeClient.request(
        { type: 'SAVE_VOICE_SETTINGS', payload: next },
        { decode: normalizeVoiceSettings },
      );
      if (saveFence.current.isCurrent(generation)) setSettings(saved);
    } catch (error) {
      if (saveFence.current.isCurrent(generation)) {
        console.error('Failed to save voice settings', error);
      }
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium" style={{ color: 'var(--ds-text)' }}>
        {t('sidepanel.voice.title')}
      </h2>
      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <VoiceToggle
          title={t('sidepanel.voice.input')}
          description={capabilities.speechRecognition
            ? t('sidepanel.voice.inputDescription')
            : t('sidepanel.voice.inputUnsupported')}
          enabled={settings.inputEnabled}
          supported={capabilities.speechRecognition}
          onToggle={(enabled) => save({ inputEnabled: enabled })}
        />
        <VoiceToggle
          title={t('sidepanel.voice.readAloud')}
          description={capabilities.speechSynthesis
            ? t('sidepanel.voice.readAloudDescription')
            : t('sidepanel.voice.readAloudUnsupported')}
          enabled={settings.readAloudEnabled}
          supported={capabilities.speechSynthesis}
          onToggle={(enabled) => save({ readAloudEnabled: enabled })}
        />

        <Slider
          label={t('sidepanel.voice.rate')}
          value={settings.rate}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(rate) => save({ rate })}
        />
        <Slider
          label={t('sidepanel.voice.pitch')}
          value={settings.pitch}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(pitch) => save({ pitch })}
        />
      </div>
    </section>
  );
}

function normalizeVoiceCapabilities(value: unknown): VoiceCapabilityState {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    speechRecognition: record.speechRecognition === true,
    speechSynthesis: record.speechSynthesis === true,
  };
}

function VoiceToggle({
  title,
  description,
  enabled,
  supported,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  supported: boolean;
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
        onClick={() => onToggle(!enabled)}
        disabled={!supported}
        className="relative shrink-0 w-10 h-[22px] rounded-full transition-colors duration-200 disabled:opacity-40"
        style={{ background: enabled && supported ? 'var(--ds-blue)' : 'var(--ds-border)' }}
      >
        <span
          className="ds-switch-thumb absolute top-[3px] left-[3px] w-4 h-4 rounded-full transition-transform duration-200"
          style={{ transform: enabled && supported ? 'translateX(18px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[11px]" style={{ color: 'var(--ds-text-secondary)' }}>
          {label}
        </label>
        <span className="text-[11px] font-mono" style={{ color: 'var(--ds-text-tertiary)' }}>
          {value.toFixed(1)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--ds-blue) ${((value - min) / (max - min)) * 100}%, var(--ds-border) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
    </div>
  );
}
