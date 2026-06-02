import { lazy, Suspense, useEffect, useState } from 'react';
import { getExtensionVersion } from '../../core/version';
import { getChatEnabled } from '../../core/chat/store';
import { setPendingText } from './pending-text';

type Tab = 'chat' | 'memory' | 'skill' | 'preset' | 'automation' | 'mcp' | 'tools' | 'settings';

const MemoryPage = lazy(() => import('./pages/MemoryPage'));
const SkillPage = lazy(() => import('./pages/SkillPage'));
const PresetPage = lazy(() => import('./pages/PresetPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AutomationPage = lazy(() => import('./pages/AutomationPage'));
const McpPage = lazy(() => import('./pages/McpPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'chat', label: '对话', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { key: 'memory', label: '记忆', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
  { key: 'skill', label: 'Skill', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { key: 'preset', label: '预设', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'automation', label: '自动化', icon: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'mcp', label: 'MCP', icon: 'M13.5 10.5h3a3 3 0 110 6h-3m-3-6h-3a3 3 0 100 6h3m-1.5-3h6' },
  { key: 'tools', label: '工具', icon: 'M4.5 12h15m-2.25-9l-3 3 3 3M6.75 21l3-3-3-3' },
  { key: 'settings', label: '设置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const version = getExtensionVersion();
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
      setTab('memory');
    }
  }, [chatEnabled, tab]);

  // 挂载时从 storage 读取待消费文本（处理侧边栏刚打开、message 丢失的情况）
  useEffect(() => {
    chrome.storage.local.get('pendingChatText').then((data) => {
      const text = data.pendingChatText as string | undefined;
      if (text) {
        chrome.storage.local.remove('pendingChatText').catch(() => {});
        setPendingText(text);
        setTab('chat');
      }
    });
  }, []);

  useEffect(() => {
    const handler = (msg: { type: string; text?: string }) => {
      if (msg.type === 'OPEN_CHAT_WITH_TEXT' && typeof msg.text === 'string') {
        chrome.storage.local.remove('pendingChatText').catch(() => {});
        setPendingText(msg.text);
        setTab('chat');
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--ds-bg)' }}>
      <header
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--ds-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="DeepSeek++"
            className="w-7 h-7 rounded-lg object-cover"
          />
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--ds-text)' }}>
            DeepSeek++
          </h1>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}>
          v{version}
        </span>
      </header>

      <nav className="side-tabs" aria-label="侧栏导航">
        {TABS.filter(t => chatEnabled !== false || t.key !== 'chat').map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`side-tab${tab === t.key ? ' side-tab-active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            title={t.label}
          >
            <svg
              className="side-tab-icon"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            <span className="side-tab-label">{t.label}</span>
            {tab === t.key && <span className="side-tab-indicator" />}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="p-4 text-sm" style={{ color: 'var(--ds-text-tertiary)' }}>加载中...</div>}>
          {tab === 'chat' && <ChatPage />}
          {tab === 'memory' && <MemoryPage />}
          {tab === 'skill' && <SkillPage />}
          {tab === 'preset' && <PresetPage />}
          {tab === 'automation' && <AutomationPage />}
          {tab === 'mcp' && <McpPage />}
          {tab === 'tools' && <ToolsPage />}
          {tab === 'settings' && <SettingsPage />}
        </Suspense>
      </main>
    </div>
  );
}
