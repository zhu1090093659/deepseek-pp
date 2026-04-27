import { useState } from 'react';
import MemoryPage from './pages/MemoryPage';
import SkillPage from './pages/SkillPage';
import PresetPage from './pages/PresetPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'memory' | 'skill' | 'preset' | 'settings';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'memory', label: '记忆', icon: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
  { key: 'skill', label: 'Skill', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  { key: 'preset', label: '预设', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'settings', label: '设置', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('memory');

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--ds-bg)' }}>
      <header
        className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--ds-border)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, var(--ds-blue), #7C8FFF)' }}
          >
            D+
          </div>
          <h1 className="text-[15px] font-semibold" style={{ color: 'var(--ds-text)' }}>
            DeepSeek++
          </h1>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ color: 'var(--ds-text-tertiary)', background: 'var(--ds-surface)' }}>
          v0.1.0
        </span>
      </header>

      <nav
        className="flex px-3 gap-0.5 pt-1"
        style={{ borderBottom: '1px solid var(--ds-border)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="relative flex items-center justify-center gap-1.5 flex-1 py-2.5 text-[13px] font-medium transition-colors"
            style={{
              color: tab === t.key ? 'var(--ds-blue)' : 'var(--ds-text-secondary)',
            }}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
            </svg>
            {t.label}
            {tab === t.key && (
              <span
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full"
                style={{
                  width: '32px',
                  background: 'var(--ds-blue)',
                }}
              />
            )}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {tab === 'memory' && <MemoryPage />}
        {tab === 'skill' && <SkillPage />}
        {tab === 'preset' && <PresetPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
