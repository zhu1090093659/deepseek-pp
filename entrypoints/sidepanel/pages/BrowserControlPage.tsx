import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  BrowserControlSettings,
  BrowserControlState,
  BrowserControlTarget,
} from '../../../core/browser-control/types';
import {
  decodeBrowserControlSettings,
  decodeBrowserControlState,
  decodeBrowserControlTarget,
} from '../../../core/browser-control/codec';
import { DEFAULT_BROWSER_CONTROL_SETTINGS } from '../../../core/browser-control/settings';
import { createRequestGenerationFence } from '../async-state';
import PageIntro from '../components/PageIntro';
import {
  EmptyState,
  Meta,
  SettingsSection,
  Slider,
  ToggleRow,
  useBanner,
} from '../components/settings/primitives';
import { useI18n } from '../i18n';
import { isSidepanelRuntimeEvent } from '../runtime-event-codec';
import { sidepanelRuntimeClient } from '../runtime-client';

type BusyState = 'idle' | 'loading' | 'saving' | 'targeting' | 'detaching';

const BROWSER_CONTROL_UPDATE_EVENTS = ['BROWSER_CONTROL_UPDATED', 'TOOL_DESCRIPTORS_UPDATED'] as const;

export default function BrowserControlPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<BrowserControlSettings>(DEFAULT_BROWSER_CONTROL_SETTINGS);
  const [state, setState] = useState<BrowserControlState | null>(null);
  const [busy, setBusy] = useState<BusyState>('loading');
  const banner = useBanner();
  const loadFence = useRef(createRequestGenerationFence());

  const targets = useMemo(
    () => state?.targets ?? [],
    [state?.targets],
  );

  useEffect(() => {
    void load();

    const handler = (message: unknown) => {
      if (isSidepanelRuntimeEvent(message, BROWSER_CONTROL_UPDATE_EVENTS)) void load();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => {
      loadFence.current.invalidate();
      chrome.runtime.onMessage.removeListener(handler);
    };
  }, []);

  const load = async () => {
    const generation = loadFence.current.begin();
    setBusy((current) => current === 'idle' ? 'loading' : current);
    try {
      const [nextSettings, nextState] = await Promise.all([
        sidepanelRuntimeClient.request(
          { type: 'GET_BROWSER_CONTROL_SETTINGS' },
          { decode: (value) => decodeBrowserControlSettings(value, 'GET_BROWSER_CONTROL_SETTINGS response') },
        ),
        sidepanelRuntimeClient.request(
          { type: 'GET_BROWSER_CONTROL_STATE' },
          { decode: (value) => decodeBrowserControlState(value, 'GET_BROWSER_CONTROL_STATE response') },
        ),
      ]);
      if (!loadFence.current.isCurrent(generation)) return;
      setSettings(nextSettings);
      setState(nextState);
    } catch (error) {
      if (loadFence.current.isCurrent(generation)) {
        banner.show('error', error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (loadFence.current.isCurrent(generation)) setBusy('idle');
    }
  };

  const savePatch = async (patch: Partial<BrowserControlSettings>) => {
    setBusy('saving');
    banner.clear();
    try {
      const next = await sidepanelRuntimeClient.request(
        { type: 'SAVE_BROWSER_CONTROL_SETTINGS', payload: patch },
        { decode: (value) => decodeBrowserControlSettings(value, 'SAVE_BROWSER_CONTROL_SETTINGS response') },
      );
      setSettings(next);
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setBusy('saving');
    banner.clear();
    try {
      const next = await sidepanelRuntimeClient.request(
        { type: 'SET_BROWSER_CONTROL_ENABLED', payload: { enabled } },
        { decode: (value) => decodeBrowserControlSettings(value, 'SET_BROWSER_CONTROL_ENABLED response') },
      );
      setSettings(next);
      banner.show('success', enabled
        ? t('sidepanel.browserControlPage.messages.enabled')
        : t('sidepanel.browserControlPage.messages.disabled'));
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const selectTarget = async (target: BrowserControlTarget) => {
    if (!target.controllable) return;
    setBusy('targeting');
    banner.clear();
    try {
      await sidepanelRuntimeClient.request(
        { type: 'SET_BROWSER_CONTROL_TARGET', payload: { tabId: target.id } },
        {
          decode(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              throw new Error(t('sidepanel.browserControlPage.messages.targetFailed'));
            }
            const response = value as Record<string, unknown>;
            if (response.ok !== true) {
              throw new Error(t('sidepanel.browserControlPage.messages.targetFailed'));
            }
            return decodeBrowserControlTarget(
              response.target,
              'SET_BROWSER_CONTROL_TARGET response.target',
            );
          },
        },
      );
      banner.show('success', t('sidepanel.browserControlPage.messages.targetSelected', { id: target.id }));
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const detach = async () => {
    setBusy('detaching');
    banner.clear();
    try {
      await sidepanelRuntimeClient.request({ type: 'DETACH_BROWSER_CONTROL' });
      banner.show('success', t('sidepanel.browserControlPage.messages.detached'));
      await load();
    } catch (error) {
      banner.show('error', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('idle');
    }
  };

  const supported = state?.supported === true;
  const activeTarget = targets.find((target) => target.id === settings.targetTabId) ?? null;

  return (
    <div className="p-4 space-y-4">
      <PageIntro
        title={t('sidepanel.browserControlPage.title')}
        description={t('sidepanel.browserControlPage.description')}
      />

      <div className="ds-surface-panel rounded-xl p-4 space-y-3">
        <ToggleRow
          title={t('sidepanel.browserControlPage.enableTitle')}
          description={supported
            ? t('sidepanel.browserControlPage.enableDescription')
            : t('sidepanel.browserControlPage.unsupported')}
          enabled={settings.enabled && supported}
          disabled={!supported || busy !== 'idle'}
          onToggle={(next) => setEnabled(next)}
        />

        <div className="grid grid-cols-3 gap-2">
          <Meta label={t('sidepanel.browserControlPage.status.enabled')} value={settings.enabled ? t('common.enabled') : t('common.disabled')} />
          <Meta label={t('sidepanel.browserControlPage.status.attached')} value={state?.attached ? t('common.enabled') : t('common.disabled')} />
          <Meta label={t('sidepanel.browserControlPage.status.target')} value={activeTarget ? String(activeTarget.id) : t('common.none')} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            disabled={busy !== 'idle'}
            className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
          >
            {busy === 'loading' ? t('common.loading') : t('common.refresh')}
          </button>
          <button
            type="button"
            onClick={detach}
            disabled={busy !== 'idle' || !state?.attached}
            className="ds-btn-secondary px-3 py-1.5 text-[11px] rounded-lg disabled:opacity-50"
          >
            {busy === 'detaching' ? t('sidepanel.browserControlPage.detaching') : t('sidepanel.browserControlPage.detach')}
          </button>
        </div>

        {banner.node}
      </div>

      <SettingsSection title={t('sidepanel.browserControlPage.targetsTitle')}>
        <div className="space-y-2">
          {targets.map((target) => (
            <TargetRow
              key={target.id}
              target={target}
              selected={target.id === settings.targetTabId}
              disabled={!settings.enabled || busy !== 'idle'}
              onSelect={() => selectTarget(target)}
            />
          ))}
          {targets.length === 0 && (
            <EmptyState title={t('sidepanel.browserControlPage.noTargets')} />
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t('sidepanel.browserControlPage.snapshotTitle')}>
        <ToggleRow
          title={t('sidepanel.browserControlPage.includeSnapshot')}
          description={t('sidepanel.browserControlPage.includeSnapshotDescription')}
          enabled={settings.includeSnapshotAfterActions}
          disabled={busy !== 'idle'}
          onToggle={(next) => savePatch({ includeSnapshotAfterActions: next })}
        />
        <Slider
          label={t('sidepanel.browserControlPage.maxNodes')}
          value={settings.maxSnapshotNodes}
          min={50}
          max={1500}
          step={50}
          disabled={busy !== 'idle'}
          onChange={(value) => savePatch({ maxSnapshotNodes: value })}
        />
        <Slider
          label={t('sidepanel.browserControlPage.maxBytes')}
          value={settings.maxSnapshotTextBytes}
          min={4000}
          max={80000}
          step={4000}
          disabled={busy !== 'idle'}
          onChange={(value) => savePatch({ maxSnapshotTextBytes: value })}
        />
      </SettingsSection>
    </div>
  );
}

function TargetRow({
  target,
  selected,
  disabled,
  onSelect,
}: {
  target: BrowserControlTarget;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !target.controllable}
      className="ds-surface-panel w-full rounded-xl p-3 text-left disabled:opacity-60"
      style={{
        borderColor: selected ? 'var(--ds-blue)' : 'var(--ds-border)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--ds-text)' }}>
            {target.title || t('sidepanel.browserControlPage.untitled')}
          </div>
          <div className="text-[10px] mt-1 truncate" style={{ color: 'var(--ds-text-tertiary)' }}>
            {target.url || t('sidepanel.browserControlPage.noUrl')}
          </div>
          {target.groupName && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--ds-text-tertiary)' }}>
              {t('sidepanel.browserControlPage.group', { name: target.groupName })}
            </div>
          )}
          {!target.controllable && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--ds-danger)' }}>
              {target.reason}
            </div>
          )}
        </div>
        <span className="text-[10px] shrink-0 px-2 py-1 rounded-md" style={{
          color: selected ? 'var(--ds-blue)' : 'var(--ds-text-tertiary)',
          background: selected ? 'var(--ds-blue-soft)' : 'var(--ds-surface)',
        }}>
          {selected ? t('sidepanel.browserControlPage.selected') : `#${target.id}`}
        </span>
      </div>
    </button>
  );
}
