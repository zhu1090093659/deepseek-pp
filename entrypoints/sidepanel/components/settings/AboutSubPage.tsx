import { useI18n } from '../../i18n';
import { SettingsSection } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';

export default function AboutSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <SettingsSection
        title={t('sidepanel.settings.aboutSection')}
        description={t('sidepanel.settings.aboutTagline')}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold"
            style={{ background: 'linear-gradient(135deg, var(--ds-blue), var(--ds-logo-gradient-end))' }}
          >
            D+
          </div>
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--ds-text)' }}>
              DeepSeek++ v{state.version}
            </div>
            <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.aboutTagline')}
            </div>
          </div>
        </div>
        <a
          href="https://github.com/zhu1090093659/deepseek-pp"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] mt-1 transition-colors hover:opacity-80"
          style={{ color: 'var(--ds-text-secondary)' }}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub
        </a>
      </SettingsSection>
    </div>
  );
}
