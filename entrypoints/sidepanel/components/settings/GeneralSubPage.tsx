import type { LocalePreference } from '../../../../core/i18n';
import type { ModelType } from '../../../../core/types';
import { useI18n } from '../../i18n';
import { SettingsSection, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';

export default function GeneralSubPage({ state }: { state: SettingsState }) {
  const { t, locale, preference: localePreference, setPreference: setLocalePreference } = useI18n();

  const currentLanguageLabel =
    locale === 'en'
      ? t('sidepanel.settings.languageEnglish')
      : t('sidepanel.settings.languageChinese');
  const languageOptions: Array<{ value: LocalePreference; label: string }> = [
    { value: 'auto', label: t('sidepanel.settings.languageAuto') },
    { value: 'zh-CN', label: t('sidepanel.settings.languageChinese') },
    { value: 'en', label: t('sidepanel.settings.languageEnglish') },
  ];
  const modelOptions: Array<{ value: ModelType; label: string }> = [
    { value: null, label: t('sidepanel.settings.modelDefault') },
    { value: 'expert', label: t('sidepanel.settings.modelExpert') },
    { value: 'vision', label: t('sidepanel.settings.modelVision') },
  ];

  return (
    <div className="space-y-5">
      <SettingsSection
        title={t('sidepanel.settings.interfaceSection')}
        description={t('sidepanel.settings.interfaceLanguageDescription')}
      >
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.settings.interfaceLanguage')}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.languageCurrent', { language: currentLanguageLabel })}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('sidepanel.settings.interfaceLanguage')}>
          {languageOptions.map((option) => {
            const active = localePreference === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void setLocalePreference(option.value)}
                className="min-w-0 px-2 py-2.5 text-[11px] leading-tight font-medium rounded-lg border transition-all duration-150"
                style={{
                  background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                  color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                  borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.modelSection')}
        description={t('sidepanel.settings.modelModeDescription')}
      >
        <div>
          <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
            {t('sidepanel.settings.modelMode')}
          </div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.modelModeDescription')}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('sidepanel.settings.modelMode')}>
          {modelOptions.map((option) => {
            const active = state.modelType === option.value;
            return (
              <button
                key={option.value ?? 'default'}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void state.handleModelTypeChange(option.value)}
                className="min-w-0 px-2 py-2.5 text-[11px] leading-tight font-medium rounded-lg border transition-all duration-150"
                style={{
                  background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                  color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                  borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="pt-3 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <ToggleRow
            title={t('sidepanel.settings.sidepanelChat')}
            description={t('sidepanel.settings.sidepanelChatDescription')}
            enabled={state.chatEnabled}
            onToggle={state.handleChatToggle}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
