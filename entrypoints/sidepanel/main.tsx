import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { createRequestGenerationFence } from './async-state';
import { I18nProvider } from './i18n';
import { decodeThemeUpdatedEvent } from './runtime-event-codec';
import { sidepanelRuntimeClient } from './runtime-client';
import './style.css';

type DeepSeekTheme = 'light' | 'dark';

applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);

function applyTheme(theme: DeepSeekTheme | null | undefined) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    return;
  }
  root.removeAttribute('data-theme');
  root.style.removeProperty('color-scheme');
}

function applyStoredTheme() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

  const requestFence = createRequestGenerationFence();
  const generation = requestFence.begin();
  sidepanelRuntimeClient.request({ type: 'GET_DEEPSEEK_THEME' })
    .then((theme) => {
      if (requestFence.isCurrent(generation)) applyTheme(theme);
    })
    .catch((error) => {
      if (!requestFence.isCurrent(generation)) return;
      console.error('Failed to load DeepSeek theme', error);
      applyTheme(null);
    });

  chrome.runtime.onMessage.addListener((message: unknown) => {
    const theme = decodeThemeUpdatedEvent(message);
    if (theme === null) return;
    requestFence.begin();
    applyTheme(theme);
  });
}
