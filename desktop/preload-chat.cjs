'use strict';

// DeepSeek++ chat window preload — sandboxed, bridge-only design.
//
// Runs with sandbox:true + contextIsolation:true. This preload is intentionally
// MINIMAL: it builds the chrome shim + bridge relays and injects the built
// scripts into dedicated worlds. It NEVER eval()s the content bundle in the
// preload world.
//
// World layout (mirrors a real Chromium extension):
//   - MAIN world (world 0): the remote DeepSeek page + our main-world.js fetch
//     hook. The page can ONLY see a narrow DPP_BRIDGE message relay, gated by an
//     unguessable per-load token (held in main-world.js's injected closure).
//   - CONTENT isolated world (CONTENT_WORLD_ID): the built content.js bundle. It
//     gets the chrome shim (globalThis.browser) and an isolated DPP_BRIDGE via
//     contextBridge.exposeInIsolatedWorld. The page CANNOT reach this world.
//   - Preload world: this file. Holds ipcRenderer; never exposed to the page.
//
// Because content.js runs in a sandboxed renderer isolated world (not in the
// Node-backed preload world), a compromised page cannot reach Node even if an
// isolation bug surfaced — there is no Node in any world the page can touch.

const { ipcRenderer, webFrame, contextBridge } = require('electron');

// Dedicated isolated world for the content.js bundle. Must not collide with the
// main world (0) or the preload's internal isolation world.
const CONTENT_WORLD_ID = 1000;

// Unguessable per-load token (Blocker 2). Lives only here (preload world) and in
// main-world.js's injected closure. The page-facing bridge validates it on every
// call, so a page script — which cannot read main-world.js's closure — can
// neither forge messages to content.js nor observe content.js responses.
const BRIDGE_TOKEN = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

// ---- Manifest (sync IPC, available immediately) ----
let cachedManifest = {};
try { cachedManifest = ipcRenderer.sendSync('dpp-manifest') || {}; } catch { /* main not ready */ }

// ---- Event listener sets ----
const runtimeListeners = new Set();   // messages from background (via dpp-runtime-incoming)
// SEC-2: the two bridge directions are kept in SEPARATE listener sets so that
// the page-facing (main-world) shim never receives traffic destined for
// content.js, and the isolated (content) shim never receives content's own
// outbound echoes.
const contentInboxListeners = new Set();    // main-world.js → content.js (isolated world only)
const mainWorldInboxListeners = new Set();  // content.js → main-world.js (page main world)
const storageChangedListeners = new Set();

// Background → content.js (existing path: dpp-runtime-incoming)
ipcRenderer.on('dpp-runtime-incoming', (_e, message) => {
  for (const fn of runtimeListeners) {
    try { fn(message, { id: 'deepseek-pp-desktop' }, () => {}); } catch {}
  }
});

// Main-world.js → content.js relay (via IPC through main process).
// Delivered ONLY to content.js (isolated world).
ipcRenderer.on('dpp-bridge-from-mainworld', (_e, message) => {
  for (const fn of contentInboxListeners) {
    try { fn(message, { id: 'deepseek-pp-desktop' }, () => {}); } catch {}
  }
});

// content.js → main-world.js responses/pushes (via separate IPC channel).
// Delivered ONLY to main-world.js (page main world), and only to listeners that
// presented the correct per-load token.
ipcRenderer.on('dpp-bridge-from-content', (_e, message) => {
  for (const fn of mainWorldInboxListeners) {
    try { fn(message, { id: 'deepseek-pp-desktop' }, () => {}); } catch {}
  }
});

// Storage changes (existing path)
ipcRenderer.on('dpp-storage-changed', (_e, changes) => {
  for (const fn of storageChangedListeners) {
    try { fn(changes, 'local'); } catch {}
  }
});

// ---- Chrome shim (CONTENT isolated world only — NEVER exposed to main world) ----
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

// Whitelist of allowed message types the page-facing shim may forward.
const BRIDGE_ALLOWED_TYPES = new Set([
  'AUGMENT_REQUEST_BODY', 'AUGMENT_REQUEST_BODY_RESULT',
  'AUGMENT_REQUEST_BODY_EXTEND_TIMEOUT',
  'RESPONSE_COMPLETE', 'RESPONSE_TOKEN_SPEED',
  'TOOL_CALL', 'TOOL_CALL_STARTED', 'RESTORE_TOOL_CALLS',
  'MEMORIES_USED', 'SYNC_HOOK_STATE', 'DPP_BRIDGE_READY',
]);

// Rate limiter: sliding window counter to prevent IPC flooding from the page.
const BRIDGE_RATE_LIMIT = 100;
const BRIDGE_RATE_WINDOW_MS = 10_000;
let bridgeMsgCount = 0;
let bridgeRateResetTimer = null;
function checkBridgeRate() {
  if (!bridgeRateResetTimer) {
    bridgeRateResetTimer = setTimeout(() => {
      bridgeMsgCount = 0;
      bridgeRateResetTimer = null;
    }, BRIDGE_RATE_WINDOW_MS);
  }
  return ++bridgeMsgCount <= BRIDGE_RATE_LIMIT;
}

// Page-facing shim (exposed to the MAIN world via contextBridge). This is the
// ONLY bridge the untrusted DeepSeek page can reach. Every method REQUIRES the
// per-load token as its first argument; main-world.js supplies it from its
// injected closure, so a page script (which cannot read that closure) is
// rejected. Defence in depth: type whitelist + rate limit on top of the token.
const mainWorldBridgeShim = {
  sendMessage(token, message) {
    if (token !== BRIDGE_TOKEN) {
      // A page script trying to forge a message to content.js.
      return Promise.reject(new Error('Bridge token invalid'));
    }
    if (!message || typeof message.type !== 'string') {
      return Promise.reject(new Error('Bridge message must have a string type'));
    }
    if (!BRIDGE_ALLOWED_TYPES.has(message.type)) {
      console.warn(`[dpp] bridge blocked disallowed type: ${message.type}`);
      return Promise.reject(new Error(`Bridge message type not allowed: ${message.type}`));
    }
    if (!checkBridgeRate()) {
      console.warn('[dpp] bridge rate limit exceeded');
      return Promise.reject(new Error('Bridge rate limit exceeded'));
    }
    return ipcRenderer.invoke('dpp-bridge-relay', { source: 'deepseek-pp-main', ...message });
  },
  onMessage: {
    addListener(token, fn) {
      // Only main-world.js (with the closure token) may observe content.js
      // responses; a page listener without the token is silently ignored.
      if (token !== BRIDGE_TOKEN || typeof fn !== 'function') return;
      mainWorldInboxListeners.add(fn);
    },
    removeListener(token, fn) {
      if (token !== BRIDGE_TOKEN) return;
      mainWorldInboxListeners.delete(fn);
    },
  },
};

// Isolated-world shim (exposed to content.js only via exposeInIsolatedWorld).
// content.js runs in the trusted isolated world the page cannot reach, so no
// token/whitelist/rate limit is needed on its outbound path. Its sendMessage
// routes ONLY to main-world.js; its onMessage receives ONLY main-world.js
// → content.js messages.
const isolatedBridgeShim = {
  sendMessage(message) {
    if (!message || typeof message.type !== 'string') {
      return Promise.reject(new Error('Bridge message must have a string type'));
    }
    const { direction, ...rest } = message;
    return ipcRenderer.invoke('dpp-bridge-to-mainworld', { source: 'deepseek-pp-content', ...rest });
  },
  onMessage: {
    addListener(fn) { contentInboxListeners.add(fn); },
    removeListener(fn) { contentInboxListeners.delete(fn); },
  },
};

// ---- Expose the chrome shim + bridge into the CONTENT isolated world ----
// The page (main world) cannot see anything in CONTENT_WORLD_ID.
try { contextBridge.exposeInIsolatedWorld(CONTENT_WORLD_ID, 'browser', chromeShim); } catch (e) { console.error('[dpp] expose browser failed', e); }
try { contextBridge.exposeInIsolatedWorld(CONTENT_WORLD_ID, 'DPP_BRIDGE', isolatedBridgeShim); } catch (e) { console.error('[dpp] expose isolated bridge failed', e); }

// ---- Expose ONLY the narrow, token-gated relay to the MAIN world ----
// DPP_BRIDGE is NOT the chrome shim — it cannot call chrome.runtime.sendMessage,
// chrome.storage.local, or any privileged API. Without the per-load token it
// cannot forward anything or observe any response.
try { contextBridge.exposeInMainWorld('DPP_BRIDGE', mainWorldBridgeShim); } catch {}
try { contextBridge.exposeInMainWorld('__DPP_DESKTOP__', true); } catch {}

// ---- Load script sources (sync IPC from main; no fs in the preload) ----
const { mainWorld: mainWorldCode, content: contentCode } = (() => {
  try { return ipcRenderer.sendSync('dpp-content-scripts') || {}; } catch { return {}; }
})();

// 1) Inject main-world.js into the page's MAIN world. It is wrapped in a closure
//    that receives the per-load token as __DPP_BRIDGE_TOKEN__ — never assigned to
//    any global, so other main-world (page) scripts cannot read it.
if (mainWorldCode) {
  const wrapped =
    `(function(__DPP_BRIDGE_TOKEN__){\n${mainWorldCode}\n})(${JSON.stringify(BRIDGE_TOKEN)});` +
    `\n//# sourceURL=dpp/main-world.js`;
  webFrame.executeJavaScript(wrapped)
    .then(() => {
      // Protect the fetch hook from being overwritten by page scripts (§4a).
      return webFrame.executeJavaScript(`
        (function() {
          const hooked = window.fetch;
          Object.defineProperty(window, 'fetch', {
            value: hooked, writable: false, configurable: false, enumerable: true,
          });
        })();
        //# sourceURL=dpp/fetch-lock.js
      `);
    })
    .then(() => console.log('[dpp] main-world.js injected into main world, fetch hook locked'))
    .catch((e) => console.error('[dpp] main-world injection failed', e));
}

// 2) Run content.js in the CONTENT isolated world (NOT in the preload world).
//    It sees globalThis.browser (chrome shim) and globalThis.DPP_BRIDGE
//    (isolated relay), shares the DOM with the page, but has isolated JS globals.
function runContent() {
  if (!contentCode) return;
  webFrame.executeJavaScriptInIsolatedWorld(CONTENT_WORLD_ID, [
    { code: 'globalThis.__DPP_DESKTOP__ = true; if (!globalThis.chrome) globalThis.chrome = globalThis.browser;' },
    { code: `${contentCode}\n//# sourceURL=dpp/content.js` },
  ]).then(() => console.log('[dpp] content.js running in isolated world ' + CONTENT_WORLD_ID))
    .catch((e) => console.error('[dpp] content.js injection failed', e));
}
if (contentCode) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runContent, { once: true });
  } else {
    runContent();
  }
}
