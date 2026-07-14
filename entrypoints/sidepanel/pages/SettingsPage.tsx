import { useState } from 'react';
import type { LocaleMessageKey } from '../../../core/i18n';
import { useI18n } from '../i18n';
import PageIntro from '../components/PageIntro';
import AboutSubPage from '../components/settings/AboutSubPage';
import ApiSubPage from '../components/settings/ApiSubPage';
import AppearanceSubPage from '../components/settings/AppearanceSubPage';
import DataSubPage from '../components/settings/DataSubPage';
import GeneralSubPage from '../components/settings/GeneralSubPage';
import PromptSubPage from '../components/settings/PromptSubPage';
import UsageSubPage from '../components/settings/UsageSubPage';
import VoiceSubPage from '../components/settings/VoiceSubPage';
import { SkeletonList, SubTabs } from '../components/settings/primitives';
import { useSettingsController } from '../controllers/useSettingsController';

type SubTab = 'general' | 'api' | 'prompt' | 'voice' | 'appearance' | 'usage' | 'data' | 'about';

const SUB_TABS: { key: SubTab; labelKey: LocaleMessageKey }[] = [
  { key: 'general', labelKey: 'sidepanel.settings.tabs.general' },
  { key: 'api', labelKey: 'sidepanel.settings.tabs.api' },
  { key: 'prompt', labelKey: 'sidepanel.settings.tabs.prompt' },
  { key: 'voice', labelKey: 'sidepanel.settings.tabs.voice' },
  { key: 'appearance', labelKey: 'sidepanel.settings.tabs.appearance' },
  { key: 'usage', labelKey: 'sidepanel.settings.tabs.usage' },
  { key: 'data', labelKey: 'sidepanel.settings.tabs.data' },
  { key: 'about', labelKey: 'sidepanel.settings.tabs.about' },
];

const SUB_DESCRIPTION_KEY: Record<SubTab, LocaleMessageKey> = {
  general: 'sidepanel.settings.generalDescription',
  api: 'sidepanel.settings.apiDescription',
  prompt: 'sidepanel.settings.promptDescription',
  voice: 'sidepanel.settings.voiceDescription',
  appearance: 'sidepanel.settings.appearanceDescription',
  usage: 'sidepanel.settings.usageDescription',
  data: 'sidepanel.settings.dataDescription',
  about: 'sidepanel.settings.aboutTagline',
};

export default function SettingsPage() {
  const { t } = useI18n();
  const [sub, setSub] = useState<SubTab>('general');
  const state = useSettingsController();

  return (
    <div className="ds-settings-shell">
      <div className="px-4 pt-4 pb-2">
        <PageIntro
          title={t('sidepanel.settings.title')}
          description={t(SUB_DESCRIPTION_KEY[sub])}
          meta={state.version ? `v${state.version}` : undefined}
        />
      </div>

      <SubTabs
        tabs={SUB_TABS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        value={sub}
        onChange={setSub}
        ariaLabel={t('sidepanel.settings.navLabel')}
      />

      <div className="ds-settings-content">
        {state.loading ? (
          <SkeletonList rows={3} />
        ) : (
          <>
            {sub === 'general' && <GeneralSubPage state={state} />}
            {sub === 'api' && <ApiSubPage state={state} />}
            {sub === 'prompt' && <PromptSubPage />}
            {sub === 'voice' && <VoiceSubPage />}
            {sub === 'appearance' && <AppearanceSubPage state={state} />}
            {sub === 'usage' && <UsageSubPage />}
            {sub === 'data' && <DataSubPage state={state} />}
            {sub === 'about' && <AboutSubPage state={state} />}
          </>
        )}
      </div>
    </div>
  );
}
