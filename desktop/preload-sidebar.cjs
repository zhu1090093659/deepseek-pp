'use strict';

// Preload for the sidebar window (loads sidepanel.html – local, trusted).
// Uses contextIsolation:true + sandbox:false. The chrome shim is exposed to
// the main world via contextBridge (the ONLY thing the page can see from the
// preload). The preload world is fully isolated from sidepanel.html's JS.

const { ipcRenderer, contextBridge, webFrame } = require('electron');

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

// contextIsolation:true — expose chrome shim as 'browser' via contextBridge.
// NOTE: exposeInMainWorld('chrome', ...) silently fails because Electron 33
// pre-populates window.chrome with an empty non-configurable stub. 'browser'
// works fine. For code that uses chrome.*, we alias chrome=browser in the
// main world via webFrame.executeJavaScript.
try { contextBridge.exposeInMainWorld('browser', chromeShim); } catch {}
try { contextBridge.exposeInMainWorld('__DPP_DESKTOP__', true); } catch {}

// Main-world injection: make window.chrome point to the contextBridge-exposed
// window.browser proxy. This runs synchronously in the preload, before
// sidepanel.html's own scripts execute.
webFrame.executeJavaScript(`(() => {
  try {
    window.chrome = window.browser;
    console.log('[DPP] chrome shim aliased to browser in sidebar main world');
  } catch(e) {
    console.warn('[DPP] chrome alias failed:', e.message);
  }
})()`);
