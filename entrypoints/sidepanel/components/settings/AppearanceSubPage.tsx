import type { PetPosition } from '../../../../core/types';
import { SVG_PATHS } from '../../constants';
import { useI18n } from '../../i18n';
import { SettingsSection, Slider, StatusMessage, ToggleRow } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';

export default function AppearanceSubPage({ state }: { state: SettingsState }) {
  const { t } = useI18n();

  const petPositionItems: Array<{ key: PetPosition; label: string }> = [
    { key: 'bottom-right', label: t('sidepanel.settings.positionBottomRight') },
    { key: 'bottom-left', label: t('sidepanel.settings.positionBottomLeft') },
  ];
  if (state.petPosition === 'custom') {
    petPositionItems.push({ key: 'custom', label: t('sidepanel.settings.positionCustom') });
  }
  const petPositionGridClass = `grid gap-2 ${state.petPosition === 'custom' ? 'grid-cols-3' : 'grid-cols-2'}`;

  return (
    <div className="space-y-5">
      <SettingsSection
        title={t('sidepanel.settings.backgroundSection')}
        description={t('sidepanel.settings.customBackgroundDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.customBackground')}
          description={t('sidepanel.settings.customBackgroundDescription')}
          enabled={state.bgEnabled}
          disabled={!state.bgPreview}
          onToggle={state.handleBgToggle}
        />

        <div className="flex gap-2">
          <input
            ref={state.fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={state.handleFileSelect}
          />
          <button
            onClick={() => state.fileInputRef.current?.click()}
            className="ds-btn-secondary flex-1 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
            {t('sidepanel.settings.uploadImage')}
          </button>
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            placeholder={t('sidepanel.settings.imageUrlPlaceholder')}
            value={state.bgUrl}
            onChange={(e) => state.setBgUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && state.handleUrlConfirm()}
            className="w-full px-3 py-2 text-xs rounded-lg border outline-none transition-colors focus:border-[var(--ds-blue)]"
            style={{ background: 'var(--ds-bg)', borderColor: 'var(--ds-border)', color: 'var(--ds-text)' }}
          />
          <button
            onClick={state.handleUrlConfirm}
            disabled={!state.bgUrl.trim()}
            className="ds-btn-secondary shrink-0 px-3 py-2 text-[11px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
          >
            {t('common.confirm')}
          </button>
        </div>

        {state.bgPreview && (
          <div
            className="relative rounded-lg overflow-hidden border"
            style={{ borderColor: 'var(--ds-border)', height: '120px' }}
          >
            <img
              src={state.bgPreview}
              alt={t('sidepanel.settings.backgroundPreviewAlt')}
              className="w-full h-full object-cover"
              onError={() => { state.setBgUrl(''); }}
            />
            <div
              className="absolute inset-0 flex items-center justify-center text-[10px]"
              style={{
                background: `rgba(var(--ds-bg-rgb), ${(1 - state.bgOpacity).toFixed(3)})`,
                backdropFilter: `blur(${((1 - state.bgOpacity) * 8).toFixed(1)}px)`,
                WebkitBackdropFilter: `blur(${((1 - state.bgOpacity) * 8).toFixed(1)}px)`,
                color: 'var(--ds-text-secondary)',
                pointerEvents: 'none',
              }}
            >
              {t('sidepanel.settings.backgroundPreviewOverlay')}
            </div>
          </div>
        )}

        <Slider
          label={t('sidepanel.settings.backgroundOpacity')}
          value={state.bgOpacity}
          min={0.05}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={state.handleOpacityChange}
        />

        {state.bgPreview && (
          <button
            onClick={state.handleClearBg}
            className="ds-btn-danger w-full py-2 text-[11px] font-medium rounded-lg transition-all duration-150"
          >
            {t('sidepanel.settings.clearBackground')}
          </button>
        )}
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.floatingPetSection')}
        description={t('sidepanel.settings.petWhaleDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.petWhale')}
          description={t('sidepanel.settings.petWhaleDescription')}
          enabled={state.petEnabled}
          onToggle={state.handlePetToggle}
        />

        <div className={petPositionGridClass}>
          {petPositionItems.map((item) => {
            const active = state.petPosition === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  if (item.key !== 'custom') void state.handlePetPositionChange(item.key as Exclude<PetPosition, 'custom'>);
                }}
                className={[
                  'py-2 text-[11px] font-medium rounded-lg border transition-all duration-150',
                  item.key === 'custom' ? 'cursor-default' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  background: active ? 'var(--ds-blue-light)' : 'var(--ds-bg)',
                  color: active ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
                  borderColor: active ? 'var(--ds-selected-border)' : 'var(--ds-border)',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <Slider
          label={t('sidepanel.settings.size')}
          value={state.petSize}
          min={84}
          max={220}
          step={4}
          format={(v) => `${v}px`}
          onChange={state.handlePetSizeChange}
        />

        <Slider
          label={t('sidepanel.settings.opacity')}
          value={state.petOpacity}
          min={0.45}
          max={1}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={state.handlePetOpacityChange}
        />

        <ToggleRow
          title={t('sidepanel.settings.petMotion')}
          description={t('sidepanel.settings.petMotionDescription')}
          enabled={state.petMotion}
          onToggle={state.handlePetMotionToggle}
        />
      </SettingsSection>

      <SettingsSection
        title={t('sidepanel.settings.floatingChatSection')}
        description={t('sidepanel.settings.floatingChatDescription')}
      >
        <ToggleRow
          title={t('sidepanel.settings.floatingChat')}
          description={t('sidepanel.settings.floatingChatDescription')}
          enabled={state.floatingChatEnabled}
          disabled={state.floatingChatRuntimeState?.kind === 'invalidated'}
          onToggle={state.handleFloatingChatToggle}
        />
        {state.floatingChatRuntimeState?.kind === 'missing-permission' && (
          <StatusMessage tone="warning">
            {t('sidepanel.settings.floatingChatPermissionMissing')}
          </StatusMessage>
        )}
        {state.floatingChatRuntimeState?.kind === 'invalidated' && (
          <StatusMessage tone="error">
            {t('sidepanel.settings.floatingChatContextInvalidated')}
          </StatusMessage>
        )}
        {state.floatingChatMessage && (
          <StatusMessage tone="error">{state.floatingChatMessage}</StatusMessage>
        )}
      </SettingsSection>
    </div>
  );
}
