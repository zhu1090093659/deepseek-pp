import { useState } from 'react';
import MemoryPage from './pages/MemoryPage';
import SkillPage from './pages/SkillPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'memory' | 'skill' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('memory');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'memory', label: '记忆' },
    { key: 'skill', label: 'Skill' },
    { key: 'settings', label: '设置' },
  ];

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <h1 className="text-lg font-bold text-white">DeepSeek++</h1>
        <span className="text-xs text-slate-500">v0.1.0</span>
      </header>

      <nav className="flex border-b border-slate-700">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        {tab === 'memory' && <MemoryPage />}
        {tab === 'skill' && <SkillPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
