import { useI18n } from '../../i18n';
import { SettingsSection, StatusBadge, StatusMessage, TextField, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';

export default function ApiSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      <SettingsSection
        title="DeepSeek API Key"
        description={t('sidepanel.settings.apiKeyDescription')}
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
              DeepSeek API Key
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.settings.apiKeyDescription')}
            </div>
          </div>
          <StatusBadge
            configured={state.apiKeyConfigured}
            configuredLabel={t('sidepanel.settings.configured')}
            notConfiguredLabel={t('sidepanel.settings.notConfigured')}
          />
        </div>

        <TextField
          type="password"
          value={state.apiKeyInput}
          placeholder={state.apiKeyConfigured ? t('sidepanel.settings.apiKeyReplacePlaceholder') : 'sk-...'}
          onChange={state.setApiKeyInput}
          onKeyDown={(e) => e.key === 'Enter' && state.handleSaveApiKey({
            apiKeyRequired: t('sidepanel.settings.apiKeyRequired'),
            saveFailed: t('sidepanel.settings.saveFailed'),
            apiKeySaved: t('sidepanel.settings.apiKeySaved'),
          })}
          trailing={
            <button
              onClick={() => state.handleSaveApiKey({
                apiKeyRequired: t('sidepanel.settings.apiKeyRequired'),
                saveFailed: t('sidepanel.settings.saveFailed'),
                apiKeySaved: t('sidepanel.settings.apiKeySaved'),
              })}
              disabled={!state.apiKeyInput.trim() || state.apiKeyStatus === 'saving'}
              className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
            >
              {state.apiKeyStatus === 'saving' ? t('sidepanel.settings.saving') : t('common.save')}
            </button>
          }
        />

        {state.apiKeyConfigured && (
          <button
            onClick={() => state.handleClearApiKey(
              t('sidepanel.settings.clearFailed'),
              t('sidepanel.settings.apiKeyCleared'),
            )}
            disabled={state.apiKeyStatus === 'clearing'}
            className="ds-btn-secondary w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {state.apiKeyStatus === 'clearing' ? t('sidepanel.settings.clearing') : t('sidepanel.settings.clearApiKey')}
          </button>
        )}

        {state.apiKeyMessage && (
          <StatusMessage tone={state.apiKeyStatus === 'error' ? 'error' : 'success'}>
            {state.apiKeyMessage}
          </StatusMessage>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.multimodalApi')}
        description={t('sidepanel.settings.multimodalApiDescription')}
      >
        <div className="flex justify-between items-start gap-3">
          <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
            {t('sidepanel.settings.multimodalApiDescription')}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <StatusBadge
              configured={state.multimodalConfigured.openaiConfigured}
              configuredLabel={`OpenAI ${t('sidepanel.settings.configured')}`}
              notConfiguredLabel={`OpenAI ${t('sidepanel.settings.notConfigured')}`}
            />
            <StatusBadge
              configured={state.multimodalConfigured.geminiConfigured}
              configuredLabel={`Gemini ${t('sidepanel.settings.configured')}`}
              notConfiguredLabel={`Gemini ${t('sidepanel.settings.notConfigured')}`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 pt-2 border-t" style={{ borderColor: 'var(--ds-border)' }}>
          <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--ds-text-tertiary)' }}>
            API Keys
          </div>
          <TextField
            label="OpenAI API Key"
            type="password"
            value={state.openaiApiKeyInput}
            placeholder={state.multimodalConfigured.openaiConfigured ? t('sidepanel.settings.openaiKeyReplacePlaceholder') : 'sk-...'}
            onChange={state.setOpenaiApiKeyInput}
          />
          <TextField
            label="Gemini API Key"
            type="password"
            value={state.geminiApiKeyInput}
            placeholder={state.multimodalConfigured.geminiConfigured ? t('sidepanel.settings.geminiKeyReplacePlaceholder') : 'AIza...'}
            onChange={state.setGeminiApiKeyInput}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TextField
            label={t('sidepanel.settings.openaiImageModel')}
            value={state.openaiImageModel}
            placeholder="gpt-4.1-mini"
            onChange={state.setOpenaiImageModel}
          />
          <TextField
            label={t('sidepanel.settings.geminiVideoModel')}
            value={state.geminiVideoModel}
            placeholder="gemini-2.5-flash"
            onChange={state.setGeminiVideoModel}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TextField
            label={t('sidepanel.settings.openaiBaseUrl')}
            type="url"
            value={state.openaiBaseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={state.setOpenaiBaseUrl}
          />
          <TextField
            label={t('sidepanel.settings.geminiBaseUrl')}
            type="url"
            value={state.geminiBaseUrl}
            placeholder="https://generativelanguage.googleapis.com"
            onChange={state.setGeminiBaseUrl}
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => state.handleSaveMultimodal({
              baseUrlInvalid: t('sidepanel.settings.multimodalBaseUrlInvalid'),
              saveFailed: t('sidepanel.settings.saveFailed'),
              saved: t('sidepanel.settings.multimodalSaved'),
            })}
            disabled={state.multimodalStatus === 'saving'}
            className="ds-btn-secondary flex-1 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {state.multimodalStatus === 'saving' ? t('sidepanel.settings.saving') : t('common.save')}
          </button>
          {(state.multimodalConfigured.openaiConfigured || state.multimodalConfigured.geminiConfigured) && (
            <button
              onClick={() => state.handleClearMultimodal({
                clearFailed: t('sidepanel.settings.clearFailed'),
                cleared: t('sidepanel.settings.multimodalCleared'),
              })}
              disabled={state.multimodalStatus === 'clearing'}
              className="ds-btn-secondary px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
            >
              {state.multimodalStatus === 'clearing' ? t('sidepanel.settings.clearing') : t('sidepanel.settings.clearMultimodalApi')}
            </button>
          )}
        </div>

        {state.multimodalMessage && (
          <StatusMessage tone={state.multimodalStatus === 'error' ? 'error' : 'success'}>
            {state.multimodalMessage}
          </StatusMessage>
        )}
      </SettingsSection>
    </div>
  );
}
