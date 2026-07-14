import { SVG_PATHS } from '../../constants';
import { useI18n } from '../../i18n';
import { SegmentedControl, SettingsSection, StatusMessage, TextField, useBanner, useConfirm } from './primitives';
import type { SettingsState } from '../../controllers/useSettingsController';
import type { SyncConfig, SyncCounts, SyncProvider } from '../../../../core/types';

/** A config has enough fields to attempt a sync (per-provider required set). */
function isSyncReady(config: SyncConfig): boolean {
  if (config.provider === 'webdav') return Boolean(config.url);
  return Boolean(config.clientId && config.clientSecret);
}

function isOAuthAuthorized(config: SyncConfig): boolean {
  return (config.provider === 'gdrive' || config.provider === 'onedrive') && Boolean(config.refreshToken);
}

/** Shared fields + authorize button for Google Drive / OneDrive. */
function OAuthConfigFields({ state }: { state: SettingsState }) {
  const { t } = useI18n();
  const config = state.syncConfig;
  if (config.provider !== 'gdrive' && config.provider !== 'onedrive') return null;
  const consoleName = config.provider === 'gdrive'
    ? t('sidepanel.settings.gdriveConsole')
    : t('sidepanel.settings.onedriveConsole');
  const authorized = isOAuthAuthorized(config);
  const redirectUri = state.syncRedirectUri ?? t('sidepanel.settings.redirectUriUnavailable');

  return (
    <>
      <TextField
        label={t('sidepanel.settings.clientId')}
        value={config.clientId}
        disabled={state.syncBusy}
        onChange={(v) => state.updateSyncField('clientId', v)}
      />
      <TextField
        label={t('sidepanel.settings.clientSecret')}
        type="password"
        value={config.clientSecret}
        disabled={state.syncBusy}
        onChange={(v) => state.updateSyncField('clientSecret', v)}
      />

      <div className="space-y-1">
        <div className="text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
          {t('sidepanel.settings.redirectUri')}
        </div>
        <code
          className="block text-[10px] break-all px-2 py-1.5 rounded"
          style={{
            background: 'var(--ds-bg-tertiary)',
            color: state.syncRedirectUri ? 'var(--ds-text-secondary)' : 'var(--ds-danger)',
          }}
        >
          {redirectUri}
        </code>
        <div className="text-[10px]" style={{ color: 'var(--ds-text-tertiary)' }}>
          {t('sidepanel.settings.redirectUriHint')}
        </div>
      </div>

      <div className="text-[10px] leading-relaxed" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.settings.oauthSetupHint', { link: consoleName })}
      </div>

      <button
        onClick={() => state.handleAuthorizeSync(
          state.captureSyncTarget(),
          {
            success: t('sidepanel.settings.authorizeSuccess'),
            failed: t('sidepanel.settings.operationFailed'),
            configChanged: t('sidepanel.settings.syncConfigChanged'),
            committedWarning: t('sidepanel.settings.syncRemoteCommittedWarning'),
          },
        )}
        disabled={state.syncBusy || !isSyncReady(config) || !state.syncRedirectUri}
        className="ds-btn-secondary w-full py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
      >
        {state.syncStatus === 'testing' ? (
          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 12-4 2 2 0 014 0zM5 19a4 4 0 014-4h6a4 4 0 014 4M12 11v8m-3-3l3 3 3-3" />
          </svg>
        )}
        {authorized ? t('sidepanel.settings.reauthorize') : t('sidepanel.settings.authorize')}
      </button>

      {authorized && (
        <div className="text-[11px] text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
          ✓ {t('sidepanel.settings.authorized')}
        </div>
      )}
    </>
  );
}

export default function DataSubPage({ state }: { state: SettingsState }) {
  const { t, locale } = useI18n();
  const { confirm, node: confirmNode } = useConfirm();
  const banner = useBanner();

  const formatTime = (ts: number | null) => {
    if (!ts) return t('sidepanel.settings.neverSynced');
    return new Date(ts).toLocaleString(locale, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatSyncCounts = (counts?: SyncCounts) => {
    if (!counts) return '';
    return t('sidepanel.settings.syncCounts', {
      memories: counts.memories,
      skills: counts.skills,
      presets: counts.presets,
      projects: counts.projects,
      projectConversations: counts.projectConversations,
      savedItems: counts.savedItems,
    });
  };

  const onTest = () =>
    state.handleTestSync(state.captureSyncTarget(), {
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      configChanged: t('sidepanel.settings.syncConfigChanged'),
      success: t('sidepanel.settings.connectionSuccess'),
      failed: t('sidepanel.settings.connectionFailed'),
      committedWarning: t('sidepanel.settings.syncRemoteCommittedWarning'),
    });

  const onUpload = async () => {
    const target = state.captureSyncTarget();
    const ok = await confirm({
      title: t('sidepanel.settings.uploadLocal'),
      message: t('sidepanel.settings.uploadConfirm'),
      confirmLabel: t('sidepanel.settings.uploadLocal'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.handleUploadSync(target, {
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      configChanged: t('sidepanel.settings.syncConfigChanged'),
      failed: t('sidepanel.settings.uploadFailed'),
      committedWarning: t('sidepanel.settings.syncRemoteCommittedWarning'),
      success: (counts) => t('sidepanel.settings.uploadSuccess', { counts: formatSyncCounts(counts) }),
    });
  };

  const onDownload = async () => {
    const target = state.captureSyncTarget();
    const ok = await confirm({
      title: t('sidepanel.settings.downloadRemote'),
      message: t('sidepanel.settings.downloadConfirm'),
      confirmLabel: t('sidepanel.settings.downloadRemote'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    state.handleDownloadSync(target, {
      permissionDenied: t('sidepanel.settings.webDavPermissionDenied'),
      operationFailed: t('sidepanel.settings.operationFailed'),
      configChanged: t('sidepanel.settings.syncConfigChanged'),
      failed: t('sidepanel.settings.downloadFailed'),
      committedWarning: t('sidepanel.settings.syncRemoteCommittedWarning'),
      success: (counts) => t('sidepanel.settings.downloadSuccess', { counts: formatSyncCounts(counts) }),
    });
  };

  const onClearAll = async () => {
    const ok = await confirm({
      title: t('sidepanel.settings.clearAllMemories'),
      message: t('sidepanel.settings.clearAllConfirm'),
      confirmLabel: t('sidepanel.settings.clearAllMemories'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await state.handleClearAllMemories();
  };

  return (
    <div className="space-y-5">
      {confirmNode}
      {banner.node}

      <SettingsSection
        title={t('sidepanel.settings.cloudSyncSection')}
        description={t('sidepanel.settings.dataDescription')}
      >
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium" style={{ color: 'var(--ds-text-secondary)' }}>
            {t('sidepanel.settings.syncProvider')}
          </div>
          <SegmentedControl
            ariaLabel={t('sidepanel.settings.syncProvider')}
            value={state.syncConfig.provider}
            disabled={state.syncBusy}
            onChange={(p) => state.switchSyncProvider(p as SyncProvider)}
            options={[
              { key: 'webdav', label: t('sidepanel.settings.providerWebdav') },
              { key: 'gdrive', label: t('sidepanel.settings.providerGdrive') },
              { key: 'onedrive', label: t('sidepanel.settings.providerOnedrive') },
            ]}
          />
        </div>

        {state.syncConfig.provider === 'webdav' && (
          <>
            <TextField
              label={t('sidepanel.settings.webDavUrl')}
              type="url"
              value={state.syncConfig.url}
              placeholder="https://dav.example.com/dav/"
              disabled={state.syncBusy}
              onChange={(v) => state.updateSyncField('url', v)}
            />
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label={t('sidepanel.settings.username')}
                value={state.syncConfig.username}
                disabled={state.syncBusy}
                onChange={(v) => state.updateSyncField('username', v)}
              />
              <TextField
                label={t('sidepanel.settings.password')}
                type="password"
                value={state.syncConfig.password}
                disabled={state.syncBusy}
                onChange={(v) => state.updateSyncField('password', v)}
              />
            </div>
            <TextField
              label={t('sidepanel.settings.remotePath')}
              value={state.syncConfig.remotePath}
              disabled={state.syncBusy}
              onChange={(v) => state.updateSyncField('remotePath', v)}
            />
          </>
        )}

        {(state.syncConfig.provider === 'gdrive' || state.syncConfig.provider === 'onedrive') && (
          <OAuthConfigFields state={state} />
        )}
      </SettingsSection>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onTest}
          disabled={!isSyncReady(state.syncConfig) || state.syncBusy}
          className="ds-btn-secondary col-span-2 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {state.syncStatus === 'testing' ? (
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
          {t('sidepanel.settings.testConnection')}
        </button>
        <button
          onClick={onUpload}
          disabled={!isSyncReady(state.syncConfig) || state.syncBusy}
          className="ds-btn-secondary py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={
            isSyncReady(state.syncConfig) && !state.syncBusy
              ? { background: 'var(--ds-blue)', color: 'var(--ds-text-on-primary)', borderColor: 'var(--ds-blue)' }
              : undefined
          }
        >
          {state.syncStatus === 'uploading' ? (
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
          )}
          {t('sidepanel.settings.uploadLocal')}
        </button>
        <button
          onClick={onDownload}
          disabled={!isSyncReady(state.syncConfig) || state.syncBusy}
          className="ds-btn-secondary py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-40"
        >
          {state.syncStatus === 'downloading' ? (
            <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
            </svg>
          )}
          {t('sidepanel.settings.downloadRemote')}
        </button>
      </div>

      {state.syncMessage && (
        <StatusMessage tone={
          state.syncStatus === 'error'
            ? 'error'
            : state.syncStatus === 'warning'
              ? 'warning'
              : 'success'
        }>
          {state.syncMessage}
        </StatusMessage>
      )}

      <div className="text-[11px] text-center" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.settings.lastSync', { time: formatTime(state.syncConfig.lastSyncAt) })}
      </div>

      <SettingsSection
        title={t('sidepanel.settings.dataSection')}
        description={t('sidepanel.settings.dataDescription')}
      >
        <div className="flex justify-between items-center text-sm">
          <span style={{ color: 'var(--ds-text-secondary)' }}>{t('sidepanel.settings.memoryTotal')}</span>
          <span className="text-lg font-semibold" style={{ color: 'var(--ds-blue)' }}>
            {state.memoryCount}
          </span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={state.handleExport}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.download} />
            </svg>
            {t('sidepanel.settings.exportMemories')}
          </button>
          <button
            onClick={() => state.handleImport(
              {
                arrayError: t('sidepanel.settings.importMemoryArrayError'),
                jsonError: t('sidepanel.settings.jsonFormatError'),
              },
              (result) => {
                if (result.ok) {
                  banner.show('success', t('sidepanel.settings.importSuccess', { count: result.imported ?? 0 }));
                } else {
                  banner.show('error', result.error ?? t('sidepanel.settings.jsonFormatError'));
                }
              },
            )}
            className="ds-btn-secondary flex-1 py-2.5 text-xs font-medium rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={SVG_PATHS.upload} />
            </svg>
            {t('sidepanel.settings.importMemories')}
          </button>
        </div>

        <button
          onClick={onClearAll}
          className="ds-btn-danger w-full py-2.5 text-xs font-medium rounded-lg transition-all duration-150"
        >
          {t('sidepanel.settings.clearAllMemories')}
        </button>
      </SettingsSection>
    </div>
  );
}
