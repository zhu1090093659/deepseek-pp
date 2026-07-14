import { useEffect, useRef, useState } from 'react';
import { dismissWhatsNew, getWhatsNewState, WHATS_NEW_ITEMS, type WhatsNewState } from '../../../core/whats-new';
import { decodeRuntimeAckResponse } from '../../../core/messaging/bootstrap-client';
import { useI18n } from '../i18n';
import { sidepanelRuntimeClient } from '../runtime-client';

export default function WhatsNewPanel() {
  const { t } = useI18n();
  const [state, setState] = useState<WhatsNewState | null>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getWhatsNewState()
      .then(setState)
      .catch((error) => {
        console.error('Failed to load whats-new state', error);
        setState(null);
      });
  }, []);

  // Auto-focus the dismiss button + allow Escape to close, matching the
  // shared ConfirmDialog behavior so the panel is keyboard-operable.
  useEffect(() => {
    if (!state?.visible) return;
    dismissRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setState((current) => current ? { ...current, visible: false, pendingUpdate: false } : current);
        void dismissWhatsNew()
          .then(() => sidepanelRuntimeClient.request(
            { type: 'WHATS_NEW_DISMISSED' },
            { decode: decodeRuntimeAckResponse },
          ))
          .catch((error) => console.error('Failed to dismiss whats-new panel', error));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state?.visible]);

  if (!state?.visible) return null;

  const handleDismiss = () => {
    setState((current) => current ? { ...current, visible: false, pendingUpdate: false } : current);
    dismissWhatsNew()
      .then(() => sidepanelRuntimeClient.request(
        { type: 'WHATS_NEW_DISMISSED' },
        { decode: decodeRuntimeAckResponse },
      ))
      .catch((error) => {
        console.error('Failed to dismiss whats-new panel', error);
      });
  };

  return (
    <section
      className="ds-whats-new-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="ds-whats-new-title"
    >
      <div className="ds-whats-new-panel">
        <div className="ds-whats-new-header">
          <div>
            <div className="ds-whats-new-kicker">
              {t('sidepanel.whatsNew.versionBadge', { version: state.version })}
            </div>
            <h2 id="ds-whats-new-title" className="ds-whats-new-title">
              {t('sidepanel.whatsNew.title')}
            </h2>
            <p className="ds-whats-new-subtitle">
              {t('sidepanel.whatsNew.subtitle')}
            </p>
          </div>
        </div>
        <ul className="ds-whats-new-list">
          {WHATS_NEW_ITEMS.map((item) => (
            <li key={item.id} className="ds-whats-new-item">
              <span className="ds-whats-new-marker" aria-hidden="true" />
              <span>{t(item.titleKey)}</span>
            </li>
          ))}
        </ul>
        <button
          ref={dismissRef}
          type="button"
          className="ds-whats-new-dismiss"
          onClick={handleDismiss}
        >
          {t('sidepanel.whatsNew.dismiss')}
        </button>
      </div>
    </section>
  );
}
