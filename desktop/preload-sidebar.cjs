'use strict';

// Preload for the sidebar window (loads sidepanel.html – local, trusted).
// Uses contextIsolation:false + sandbox:true. The preload assigns window.chrome
// directly (contextBridge requires contextIsolation:true, which we can't use
// because Electron 33 sandbox pre-populates window.chrome even for local files).

const { ipcRenderer } = require('electron');

let cachedManifest = {};
try { cachedManifest = ipcRenderer.sendSync('dpp-manifest') || {}; } catch { /* main not ready */ }

const runtimeListeners = new Set();
const storageChangedListeners = new Set();

ipcRenderer.on('dpp-runtime-incoming', (_e, message) => {
  for (const fn of runtimeListeners) {
    try { fn(message, { id: 'deepseek-pp-desktop' }, () => {}); } catch {}
  }
});
ipcRenderer.on('dpp-storage-changed', (_e, changes) => {
  for (const fn of storageChangedListeners) {
    try { fn(changes, 'local'); } catch {}
  }
});

const chromeShim = {
  runtime: {
    id: 'deepseek-pp-desktop',
    getURL(p) { return `dppasset://asset/${String(p || '').replace(/^\/+/, '')}`; },
    getManifest() { return cachedManifest; },
    sendMessage(message) { return ipcRenderer.invoke('dpp-runtime-message', message); },
    onMessage: {
      addListener(fn) { runtimeListeners.add(fn); },
      removeListener(fn) { runtimeListeners.delete(fn); },
    },
    onInstalled: { addListener() {}, removeListener() {} },
    lastError: undefined,
  },
  storage: {
    local: {
      get(keys) { return ipcRenderer.invoke('dpp-store-get', keys ?? null); },
      set(values) { return ipcRenderer.invoke('dpp-store-set', values); },
      remove(keys) { return ipcRenderer.invoke('dpp-store-remove', keys); },
    },
    session: {
      get(keys) { return ipcRenderer.invoke('dpp-session-get', keys ?? null); },
      set(values) { return ipcRenderer.invoke('dpp-session-set', values); },
      remove(keys) { return ipcRenderer.invoke('dpp-session-remove', keys); },
    },
    onChanged: {
      addListener(fn) { storageChangedListeners.add(fn); },
      removeListener(fn) { storageChangedListeners.delete(fn); },
    },
  },
  tabs: {
    query: async () => [{ id: 1, active: true, url: 'https://chat.deepseek.com/' }],
    sendMessage: async () => undefined,
  },
};

// contextIsolation:false + sandbox:true for this trusted local window.
// Direct assignment (contextBridge requires contextIsolation:true).
window.__DPP_DESKTOP__ = true;
window.chrome = chromeShim;
window.browser = chromeShim;
