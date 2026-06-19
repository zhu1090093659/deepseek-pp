'use strict';

// Preload for the sidebar window (loads sidepanel.html – local, trusted).
// Because the sidebar loads a local file (not a remote page), window.chrome is
// NOT pre-populated by Electron, so contextBridge.exposeInMainWorld('chrome', …)
// works without key conflicts.

const { ipcRenderer, contextBridge } = require('electron');

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

// Sidebar loads a local file → window.chrome is not pre-populated → safe to
// expose as 'chrome' directly via contextBridge (no key conflict).
contextBridge.exposeInMainWorld('__DPP_DESKTOP__', true);
contextBridge.exposeInMainWorld('chrome', chromeShim);
contextBridge.exposeInMainWorld('browser', chromeShim);
