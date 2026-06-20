'use strict';

// DeepSeek++ chat window preload.
//
// Runs in the ISOLATED preload world (contextIsolation:true). The remote
// DeepSeek page lives in the MAIN world and cannot see any variable set here.
// We build a chrome.* shim in this isolated world and run content.js here as
// well, so it has access to the shim + the shared DOM but the page cannot
// reach the privileged APIs.
//
// main-world.js is the only script intentionally injected into the page's
// main world; it only hooks fetch and forwards data to content.js over a
// transferred MessagePort, so it never needs the chrome shim.

const { ipcRenderer, webFrame } = require('electron');

// Manifest comes from the main process — this preload must not pull in
// node:fs/node:path, because the main world must not be able to obtain Node.
let cachedManifest = {};
try { cachedManifest = ipcRenderer.sendSync('dpp-manifest') || {}; } catch { /* main not ready */ }

// Load the same content scripts the Chrome/Android builds use.
const { mainWorld, content } = ipcRenderer.sendSync('dpp-content-scripts') || {};

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

// Marker read by core/platform/capabilities.ts -> electron_desktop kind.
// Kept inside the isolated world only; the main world cannot see it.
try { Object.defineProperty(globalThis, '__DPP_DESKTOP__', { value: true, configurable: true, writable: true }); }
catch { globalThis.__DPP_DESKTOP__ = true; }

// Expose the shim as `browser` in the isolated world. We deliberately do NOT
// touch `chrome` here: Electron pre-populates window.chrome in every renderer
// as a non-writable Proxy, and attempting to override it would fail or leak
// into the main world. content.js is built to read `globalThis.browser` first
// (via the WXT browser polyfill alias); for any remaining bare `chrome.*`
// references we rebind them locally when evaluating content.js below.
try { Object.defineProperty(globalThis, 'browser', { value: chromeShim, configurable: true, writable: true }); }
catch { globalThis.browser = chromeShim; }

// 1) Inject main-world.js into the page's MAIN world before any page script
//    runs, so it can hook fetch before the first page request.
//
//    The three steps must execute strictly in order:
//    a) set __DPP_DESKTOP__ so main-world.js's auto-run guard triggers;
//    b) run main-world.js (which sets up the fetch hook + content bridge);
//    c) freeze window.fetch so the page cannot uninstall the hook.
if (mainWorld) {
  webFrame.executeJavaScript(`window.__DPP_DESKTOP__ = true;\n//# sourceURL=dpp/set-desktop-flag.js`)
    .then(() => webFrame.executeJavaScript(`${mainWorld}\n//# sourceURL=dpp/main-world.js`))
    .then(() => {
      // Protect the fetch hook from being overwritten by page scripts
      return webFrame.executeJavaScript(`
        (function() {
          const hooked = window.fetch;
          Object.defineProperty(window, 'fetch', {
            value: hooked,
            writable: false,
            configurable: false,
            enumerable: true,
          });
        })();
        //# sourceURL=dpp/fetch-lock.js
      `);
    })
    .then(() => {
      console.log('[dpp] main-world.js injected and fetch hook locked');
    })
    .catch((e) => {
      console.error('[dpp] main-world inject or fetch lock failed', e);
    });
}

// 2) Run content.js in this ISOLATED preload world. It shares the DOM with
//    the page but runs in a separate JS global, so it can use our shim while
//    the page cannot. Rebinding `chrome` locally covers any direct chrome.*
//    references that the WXT browser polyfill does not intercept.
function runContent() {
  if (!content) return;
  try {
    (0, eval)(`(function(){
  var chrome = globalThis.browser;
  var browser = globalThis.browser;
  ${content}
})();
//# sourceURL=dpp/content.js`);
  } catch (e) {
    console.error('[dpp] content inject failed', e);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runContent, { once: true });
else runContent();
