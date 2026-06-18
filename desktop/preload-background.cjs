'use strict';

// chrome.* polyfill for the hidden background window that runs background.js.
// Phase 1 supports the surfaces the memory/skill/prompt-injection flow needs.
// Phase 2 wires the gated capabilities to Node (see desktop/README.md):
//   nativeMessaging -> child_process, browserControl -> webContents.debugger,
//   alarms -> node-cron, sidePanel -> docked BrowserView.

const { ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

let cachedManifest = {};
try {
  cachedManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'dpp', 'manifest.json'), 'utf8'));
} catch { /* dev runs before staging */ }

const runtimeMessageListeners = new Set();
const storageChangedListeners = new Set();

// Deliver chat -> background messages, supporting async sendResponse + `return true`.
ipcRenderer.on('dpp-bg-deliver', (_e, { reqId, message, sender }) => {
  let responded = false;
  const sendResponse = (response) => {
    if (responded) return;
    responded = true;
    ipcRenderer.send('dpp-bg-response', reqId, response ?? null);
  };
  let keepOpen = false;
  for (const fn of runtimeMessageListeners) {
    try {
      const ret = fn(message, sender || {}, sendResponse);
      if (ret === true) keepOpen = true;
    } catch (err) {
      console.error('[DeepSeek++ bg] listener error', err);
    }
  }
  if (!keepOpen && !responded) sendResponse(null);
});

ipcRenderer.on('dpp-storage-changed', (_e, changes) => {
  for (const fn of storageChangedListeners) {
    try { fn(changes, 'local'); } catch {}
  }
});

function noopEvent() { return { addListener() {}, removeListener() {}, hasListener: () => false }; }

// chrome.alarms via setInterval/setTimeout. Valid because the background window
// is a real, persistent renderer (backgroundThrottling:false), not an MV3
// service worker that gets torn down between events.
function createAlarmsApi() {
  const timers = new Map(); // name -> { type, id }
  const listeners = new Set();

  function clearTimer(name) {
    const t = timers.get(name);
    if (!t) return;
    if (t.type === 'interval') clearInterval(t.id); else clearTimeout(t.id);
    timers.delete(name);
  }
  function fire(name) {
    for (const fn of listeners) {
      try { fn({ name, scheduledTime: Date.now() }); } catch (err) { console.error('[DeepSeek++ bg] onAlarm', err); }
    }
  }

  return {
    create(name, info) {
      let alarmName = name;
      let alarmInfo = info;
      if (typeof name === 'object' && name !== null) { alarmInfo = name; alarmName = ''; }
      alarmName = String(alarmName ?? '');
      alarmInfo = alarmInfo || {};
      clearTimer(alarmName);
      if (typeof alarmInfo.periodInMinutes === 'number' && alarmInfo.periodInMinutes > 0) {
        const ms = Math.max(0.1, alarmInfo.periodInMinutes) * 60_000;
        const id = setInterval(() => fire(alarmName), ms);
        timers.set(alarmName, { type: 'interval', id });
      } else {
        const delayMs = typeof alarmInfo.delayInMinutes === 'number'
          ? Math.max(0, alarmInfo.delayInMinutes) * 60_000
          : (typeof alarmInfo.when === 'number' ? Math.max(0, alarmInfo.when - Date.now()) : 0);
        const id = setTimeout(() => { timers.delete(alarmName); fire(alarmName); }, delayMs);
        timers.set(alarmName, { type: 'timeout', id });
      }
      return Promise.resolve();
    },
    clear(name) { clearTimer(String(name ?? '')); return Promise.resolve(true); },
    clearAll() { for (const k of [...timers.keys()]) clearTimer(k); return Promise.resolve(true); },
    get(name) { return Promise.resolve(timers.has(String(name ?? '')) ? { name: String(name ?? '') } : undefined); },
    getAll() { return Promise.resolve([...timers.keys()].map((name) => ({ name }))); },
    onAlarm: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
  };
}

// chrome.runtime.connectNative -> native messaging Port backed by a child
// process spawned in the main process (main.cjs). This is what powers the
// shell host and stdio MCP servers on desktop (Android could not do this).
let nativePortSeq = 0;
const runtimeLastError = { current: undefined };
function connectNative(hostName) {
  const portId = `np-${++nativePortSeq}`;
  const messageListeners = new Set();
  const disconnectListeners = new Set();
  let disconnected = false;

  const port = {
    name: String(hostName || ''),
    postMessage(message) { if (!disconnected) ipcRenderer.send('dpp-native-post', portId, message); },
    disconnect() { if (disconnected) return; disconnected = true; ipcRenderer.send('dpp-native-disconnect-req', portId); cleanup(); },
    onMessage: { addListener: (fn) => messageListeners.add(fn), removeListener: (fn) => messageListeners.delete(fn) },
    onDisconnect: { addListener: (fn) => disconnectListeners.add(fn), removeListener: (fn) => disconnectListeners.delete(fn) },
  };

  const onMessage = (_e, pid, message) => {
    if (pid !== portId) return;
    for (const fn of messageListeners) { try { fn(message); } catch (err) { console.error('[DeepSeek++ bg] native onMessage', err); } }
  };
  const onDisconnect = (_e, pid, errorMessage) => {
    if (pid !== portId || disconnected) return;
    disconnected = true;
    runtimeLastError.current = errorMessage ? { message: errorMessage } : undefined;
    for (const fn of disconnectListeners) { try { fn(port); } catch (err) { console.error('[DeepSeek++ bg] native onDisconnect', err); } }
    runtimeLastError.current = undefined;
    cleanup();
  };
  function cleanup() {
    ipcRenderer.removeListener('dpp-native-message', onMessage);
    ipcRenderer.removeListener('dpp-native-disconnect', onDisconnect);
  }

  ipcRenderer.on('dpp-native-message', onMessage);
  ipcRenderer.on('dpp-native-disconnect', onDisconnect);
  ipcRenderer.send('dpp-native-connect', portId, String(hostName || ''));
  return port;
}

// chrome.contextMenus -> a registry in main that builds an Electron Menu on
// right-click in the chat window and routes clicks back to onClicked.
function createContextMenusApi() {
  const clickListeners = new Set();
  ipcRenderer.on('dpp-contextmenu-clicked', (_e, payload) => {
    for (const fn of clickListeners) {
      try { fn(payload.info, payload.tab); } catch (err) { console.error('[DeepSeek++ bg] contextMenu onClicked', err); }
    }
  });
  function serialize(props) {
    const p = props || {};
    return { id: p.id, title: p.title, type: p.type, contexts: p.contexts };
  }
  return {
    create(props, cb) { ipcRenderer.send('dpp-ctxmenu-create', serialize(props)); if (typeof cb === 'function') cb(); return props && props.id; },
    update() { return Promise.resolve(); },
    remove() { return Promise.resolve(); },
    removeAll(cb) { ipcRenderer.send('dpp-ctxmenu-removeall'); if (typeof cb === 'function') cb(); return Promise.resolve(); },
    onClicked: { addListener: (fn) => clickListeners.add(fn), removeListener: (fn) => clickListeners.delete(fn) },
  };
}

// chrome.debugger polyfill -> webContents.debugger (CDP) in main.cjs.
// core/browser-control/cdp.ts uses attach/detach/sendCommand + onEvent/onDetach.
function createDebuggerApi() {
  const eventListeners = new Set();
  const detachListeners = new Set();

  ipcRenderer.on('dpp-debugger-event', (_e, payload) => {
    const source = { tabId: payload.tabId };
    for (const fn of eventListeners) {
      try { fn(source, payload.method, payload.params); } catch (err) { console.error('[DeepSeek++ bg] debugger onEvent', err); }
    }
  });
  ipcRenderer.on('dpp-debugger-detach-event', (_e, payload) => {
    const source = { tabId: payload.tabId };
    for (const fn of detachListeners) {
      try { fn(source, payload.reason || 'target_closed'); } catch (err) { console.error('[DeepSeek++ bg] debugger onDetach', err); }
    }
  });

  return {
    attach: (target, version) => ipcRenderer.invoke('dpp-debugger-attach', target?.tabId, version),
    detach: (target) => ipcRenderer.invoke('dpp-debugger-detach', target?.tabId),
    sendCommand: (target, method, params) => ipcRenderer.invoke('dpp-debugger-send', target?.tabId, method, params ?? {}),
    getTargets: () => ipcRenderer.invoke('dpp-tabs-query', {}),
    onEvent: { addListener: (fn) => eventListeners.add(fn), removeListener: (fn) => eventListeners.delete(fn) },
    onDetach: { addListener: (fn) => detachListeners.add(fn), removeListener: (fn) => detachListeners.delete(fn) },
  };
}

const chromeShim = {
  runtime: {
    id: 'deepseek-pp-desktop',
    getURL(p) { return `dppasset://asset/${String(p || '').replace(/^\/+/, '')}`; },
    getManifest() { return cachedManifest; },
    // background broadcasting to content scripts
    sendMessage(message) { ipcRenderer.send('dpp-runtime-broadcast', message); return Promise.resolve(undefined); },
    onMessage: {
      addListener(fn) { runtimeMessageListeners.add(fn); },
      removeListener(fn) { runtimeMessageListeners.delete(fn); },
    },
    onInstalled: noopEvent(),
    onStartup: noopEvent(),
    connectNative,
    get lastError() { return runtimeLastError.current; },
  },
  storage: {
    local: {
      get(keys) { return ipcRenderer.invoke('dpp-store-get', keys ?? null); },
      set(values) { return ipcRenderer.invoke('dpp-store-set', values); },
      remove(keys) { return ipcRenderer.invoke('dpp-store-remove', keys); },
    },
    // Session storage: in-memory in main, cleared on app restart.
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
  // Tabs: the chat window is tab id 1; AI-controlled tabs are Electron windows
  // managed by main.cjs (ids >= 100). main applies Chrome's query semantics.
  tabs: {
    query: (queryInfo) => ipcRenderer.invoke('dpp-tabs-query', queryInfo ?? {}),
    get: (tabId) => ipcRenderer.invoke('dpp-tabs-get', tabId),
    create: (props) => ipcRenderer.invoke('dpp-tabs-create', props ?? {}),
    update: (tabId, props) => ipcRenderer.invoke('dpp-tabs-update', tabId, props ?? {}),
    remove: (tabId) => ipcRenderer.invoke('dpp-tabs-remove', tabId),
    sendMessage: (tabId, message) => { ipcRenderer.send('dpp-tabs-send', tabId, message); return Promise.resolve(undefined); },
  },
  // Browser control: chrome.debugger -> webContents.debugger (CDP) in main.
  debugger: createDebuggerApi(),
  // Alarms backed by timers in this persistent (never-throttled) window — the
  // automation scheduler relies on chrome.alarms.create + onAlarm.
  alarms: createAlarmsApi(),
  // Context menus -> Electron Menu shown on right-click in the chat window.
  contextMenus: createContextMenusApi(),
  // Docked sidebar acts as the side panel; open() reveals it.
  sidePanel: {
    open: () => { ipcRenderer.send('dpp-open-sidebar'); return Promise.resolve(); },
    setPanelBehavior: () => Promise.resolve(),
  },
  permissions: { request: async () => false, contains: async () => false },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
};

// Marker read by core/platform/capabilities.ts -> electron_desktop kind.
window.__DPP_DESKTOP__ = true;
window.chrome = Object.assign(window.chrome || {}, chromeShim);
window.browser = window.chrome;
