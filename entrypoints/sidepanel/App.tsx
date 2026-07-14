import { lazy, Suspense, useEffect, useState } from 'react';
import type { LocaleMessageKey } from '../../core/i18n';
import { getChatEnabled } from '../../core/chat/store';
import RouteFallback from './components/RouteFallback';
import WhatsNewPanel from './components/WhatsNewPanel';
import {
  startPendingTextConsumer,
  type PendingTextConsumerOperation,
} from './controllers/pending-text-controller';
import { useI18n } from './i18n';
import { setPendingText } from './pending-text';

type Tab = 'chat' | 'library' | 'projects' | 'capabilities' | 'settings';

const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CapabilitiesPage = lazy(() => import('./pages/CapabilitiesPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));

const TABS: { key: Tab; labelKey: LocaleMessageKey; icon: string }[] = [
  { key: 'chat', labelKey: 'app.tabs.chat', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { key: 'library', labelKey: 'app.tabs.library', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18s-3.332.477-4.5 1.253' },
  { key: 'projects', labelKey: 'app.tabs.projects', icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z' },
  { key: 'capabilities', labelKey: 'app.tabs.capabilities', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { key: 'settings', labelKey: 'app.tabs.settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function App() {
  const { t } = useI18n();
  // Floating-chat surface: when the sidepanel is loaded inside the global
  // floating ball's iframe, drop the nav/whats-new chrome and render chat only.
  const isFloatingChat = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('surface') === 'floating-chat';
  const [tab, setTab] = useState<Tab>('chat');
  const [chatEnabled, setChatEnabledState] = useState<boolean | null>(null);

  useEffect(() => {
    getChatEnabled().then(setChatEnabledState);
    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('deepseek_pp_chat_enabled' in changes) {
        setChatEnabledState(changes.deepseek_pp_chat_enabled.newValue === true);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }, []);

  useEffect(() => {
    if (chatEnabled === false && tab === 'chat') {
      setTab('library');
    }
  }, [chatEnabled, tab]);

  useEffect(() => {
    const consumer = startPendingTextConsumer({
      onText(text) {
        setPendingText(text);
        setTab('chat');
      },
      onError: reportPendingTextError,
    });
    return () => consumer.stop();
  }, []);

  return (
    <div className={isFloatingChat ? 'ds-app-shell ds-app-shell-floating-chat' : 'ds-app-shell'}>
      {!isFloatingChat && (
        <nav className="side-tabs" aria-label={t('app.sideNavLabel')}>
          {TABS.filter((tabConfig) =>
            chatEnabled !== false || tabConfig.key !== 'chat'
          ).map((tabConfig) => {
            const label = t(tabConfig.labelKey);
            return (
              <button
                key={tabConfig.key}
                type="button"
                onClick={() => setTab(tabConfig.key)}
                className={`side-tab${tab === tabConfig.key ? ' side-tab-active' : ''}`}
                aria-current={tab === tabConfig.key ? 'page' : undefined}
                title={label}
              >
                <svg
                  className="side-tab-icon"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={tabConfig.icon} />
                </svg>
                <span className="side-tab-label">{label}</span>
                {tab === tabConfig.key && <span className="side-tab-indicator" />}
              </button>
            );
          })}
        </nav>
      )}

      <main className="ds-app-main">
        {!isFloatingChat && <WhatsNewPanel />}
        <Suspense fallback={<RouteFallback />}>
          {(isFloatingChat || tab === 'chat') && <ChatPage />}
          {!isFloatingChat && tab === 'library' && <LibraryPage />}
          {!isFloatingChat && tab === 'projects' && <ProjectsPage />}
          {!isFloatingChat && tab === 'capabilities' && <CapabilitiesPage />}
          {!isFloatingChat && tab === 'settings' && <SettingsPage />}
        </Suspense>
      </main>
    </div>
  );
}

function reportPendingTextError(operation: PendingTextConsumerOperation, error: unknown): void {
  console.error(`[DeepSeek++] Pending chat text ${operation} failed.`, error);
}
