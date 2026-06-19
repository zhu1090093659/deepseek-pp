'use strict';

// ---------------------------------------------------------------------------
// File logging for diagnosing silent exits.
// ---------------------------------------------------------------------------
const LOG_FILE = require('node:path').join(
  process.env.TEMP || process.env.TMP || 'C:	emp',
  'deepseek-pp-desktop.log'
);
function logToFile(msg) {
  try { require('node:fs').appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '
'); } catch {}
}
logToFile('=== APP START ===');

// ---------------------------------------------------------------------------
// Catch sync errors that would otherwise cause silent exit.
// ---------------------------------------------------------------------------
process.once('uncaughtException', (err) => {
  logToFile('UNCAUGHT: ' + err.message + '
' + err.stack);
  fs.appendFileSync(LOG_FILE, '[FATAL] ' + new Date().toISOString() + ' UNCAUGHT: ' + err.message + '
' + (err.stack || '') + '
');
  process.exit(1);
});
logToFile('Electron: ' + process.versions.electron);
logToFile('Argv: ' + process.argv.join(' '));


// DeepSeek++ desktop shell (Electron).
//
// Architecture (mirrors the project's existing Android WebView host, but uses
// the real background.js instead of a native subset):
//
//   chatWindow      -> visible, loads https://chat.deepseek.com, injects the
//                      built content scripts (main-world.js + content.js).
//   sidebarView     -> docked WebContentsView running the built sidepanel.html
//                      (toggle with Ctrl/Cmd+Shift+D).
//   backgroundWindow-> hidden, loads background.html which runs the built
//                      background.js. This is the extension service worker.
//   main process    -> relays chrome.runtime / chrome.tabs / chrome.storage
//                      between renderers, owns persistence, and spawns native
//                      messaging hosts (shell host / MCP) as child processes.

const {
  app, BrowserWindow, ipcMain, protocol, net, Menu, globalShortcut, session, screen,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const CHAT_URL = 'https://chat.deepseek.com/';
const DIST_DIR = path.join(__dirname, 'dpp'); // staged copy of dist/chrome-mv3
const REPO_ROOT = path.join(__dirname, '..');
const STORE_FILE = path.join(app.getPath('userData'), 'dpp-store.json');
const SIDEBAR_WIDTH = 440;

// Navigation guard (pure, unit-tested in tests/desktop-navigation-guard).
const { isValidNavigationUrl } = require('./navigation-guard.cjs');

// Browser control is gated by the persisted browser-control setting so the main
// process and the sidepanel UI share a single source of truth: the sidepanel's
// SET_BROWSER_CONTROL_ENABLED is written to chrome.storage.local, which is this
// process's `store`. See isBrowserControlEnabled() below.
const BROWSER_CONTROL_KEY = 'deepseek_pp_browser_control_settings';

// App manifest is read once here in the main process so renderer preloads do not
// need to require node:fs/node:path (which would expose Node in the same world as
// the remote DeepSeek page). Preloads fetch it via the synchronous 'dpp-manifest'.
let appManifest = {};
try { appManifest = JSON.parse(fs.readFileSync(path.join(DIST_DIR, 'manifest.json'), 'utf8')); } catch {}
ipcMain.on('dpp-manifest', (event) => { event.returnValue = appManifest; });

let chatWindow = null;
let backgroundWindow = null;
let sidebarWindow = null;

// ---------------------------------------------------------------------------
// Native messaging hosts (chrome.runtime.connectNative -> child_process).
// Maps host name -> a Node script run with Electron's bundled node.
// ---------------------------------------------------------------------------
function resolveShellHostScript() {
  // Staged into the app by scripts/copy-shell-host-to-desktop.mjs (asar:false
  // keeps this __dirname path valid in packaged builds). Fall back to the repo
  // copy for `npm start` runs that skipped staging.
  const staged = path.join(__dirname, 'native', 'shell-host', 'native', 'shell-mcp-host.mjs');
  if (fs.existsSync(staged)) return staged;
  return path.join(REPO_ROOT, 'packages', 'shell-host', 'native', 'shell-mcp-host.mjs');
}

const NATIVE_HOSTS = {
  'deepseek-pp-shell-host': { script: resolveShellHostScript() },
  // 'deepseek-pp-multimodal-mcp' is distributed as an npm package; wiring it
  // (npx spawn + API key env) is a follow-up.
};

// ---------------------------------------------------------------------------
// Persistent key/value store (replaces chrome.storage.local).
// ---------------------------------------------------------------------------
let store = {};
try {
  store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
} catch {
  store = {};
}
let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.writeFile(STORE_FILE, JSON.stringify(store), () => {});
  }, 50);
}
// Single source of truth for the browser-control gate: the persisted setting the
// sidepanel toggles via SET_BROWSER_CONTROL_ENABLED (saved into `store`).
function isBrowserControlEnabled() {
  const s = store[BROWSER_CONTROL_KEY];
  return !!(s && s.enabled === true);
}

function allSurfaces() {
  return [chatWindow, backgroundWindow, sidebarWindow].filter((w) => w && !w.isDestroyed() && !w.webContents.isDestroyed());
}
function broadcastStorageChange(changes) {
  for (const surface of allSurfaces()) surface.webContents.send('dpp-storage-changed', changes);
}

// ---------------------------------------------------------------------------
// Custom protocol so chrome.runtime.getURL(path) can resolve packaged assets.
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  { scheme: 'dppasset', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAssetProtocol() {
  protocol.handle('dppasset', (request) => {
    const url = new URL(request.url);
    // dppasset://asset/<relative path inside dist>
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.join(DIST_DIR, rel);
    if (!filePath.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// ---------------------------------------------------------------------------
// IPC: storage
// ---------------------------------------------------------------------------
ipcMain.handle('dpp-store-get', (_e, keys) => {
  if (keys == null) return { ...store };
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) if (k in store) out[k] = store[k];
  return out;
});
ipcMain.handle('dpp-store-set', (_e, values) => {
  const changes = {};
  for (const [k, v] of Object.entries(values || {})) {
    changes[k] = { oldValue: store[k], newValue: v };
    store[k] = v;
  }
  persist();
  broadcastStorageChange(changes);
  return true;
});
ipcMain.handle('dpp-store-remove', (_e, keys) => {
  const list = Array.isArray(keys) ? keys : [keys];
  const changes = {};
  for (const k of list) {
    if (k in store) { changes[k] = { oldValue: store[k], newValue: undefined }; delete store[k]; }
  }
  persist();
  broadcastStorageChange(changes);
  return true;
});

// chrome.storage.session — in-memory, cleared on app restart (mirrors the
// session lifetime used by the chat-loop interruption marker).
let sessionStore = {};
ipcMain.handle('dpp-session-get', (_e, keys) => {
  if (keys == null) return { ...sessionStore };
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) if (k in sessionStore) out[k] = sessionStore[k];
  return out;
});
ipcMain.handle('dpp-session-set', (_e, values) => {
  for (const [k, v] of Object.entries(values || {})) sessionStore[k] = v;
  return true;
});
ipcMain.handle('dpp-session-remove', (_e, keys) => {
  for (const k of (Array.isArray(keys) ? keys : [keys])) delete sessionStore[k];
  return true;
});

// ---------------------------------------------------------------------------
// IPC: chrome.runtime messaging relay  (any surface -> background, await reply)
// ---------------------------------------------------------------------------
let reqSeq = 0;
const pending = new Map();

ipcMain.handle('dpp-runtime-message', (e, message) => {
  if (!backgroundWindow || backgroundWindow.webContents.isDestroyed()) return null;
  const reqId = ++reqSeq;
  const fromTabId = e.sender === chatWindow?.webContents ? 1 : undefined;
  return new Promise((resolve) => {
    pending.set(reqId, resolve);
    backgroundWindow.webContents.send('dpp-bg-deliver', {
      reqId, message, sender: { tab: fromTabId ? { id: fromTabId } : undefined },
    });
    setTimeout(() => { if (pending.has(reqId)) { pending.delete(reqId); resolve(null); } }, 30000);
  });
});
ipcMain.on('dpp-bg-response', (_e, reqId, response) => {
  const resolve = pending.get(reqId);
  if (resolve) { pending.delete(reqId); resolve(response); }
});

// background -> surfaces. Mirror extension semantics:
//   chrome.runtime.sendMessage reaches extension pages (the sidepanel);
//   chrome.tabs.sendMessage reaches content scripts (the chat window).
ipcMain.on('dpp-runtime-broadcast', (_e, message) => {
  if (sidebarWindow && !sidebarWindow.isDestroyed() && !sidebarWindow.webContents.isDestroyed()) {
    sidebarWindow.webContents.send('dpp-runtime-incoming', message);
  }
});
ipcMain.on('dpp-tabs-send', (_e, _tabId, message) => {
  if (chatWindow && !chatWindow.webContents.isDestroyed()) chatWindow.webContents.send('dpp-runtime-incoming', message);
});

// ---------------------------------------------------------------------------
// IPC: native messaging (4-byte LE length frames, same as Chrome).
// ---------------------------------------------------------------------------
const nativeChildren = new Map(); // portId -> { child, buffer }

ipcMain.on('dpp-native-connect', (e, portId, hostName) => {
  const sender = e.sender;
  const def = NATIVE_HOSTS[hostName];
  if (!def) { sender.send('dpp-native-disconnect', portId, `Unknown native host: ${hostName}`); return; }
  if (!fs.existsSync(def.script)) { sender.send('dpp-native-disconnect', portId, `Native host script not found: ${def.script}`); return; }

  let child;
  try {
    child = spawn(process.execPath, [def.script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (err) {
    sender.send('dpp-native-disconnect', portId, `Failed to spawn native host: ${err.message}`);
    return;
  }

  const state = { child, buffer: Buffer.alloc(0) };
  nativeChildren.set(portId, state);

  child.stdout.on('data', (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    for (;;) {
      if (state.buffer.length < 4) break;
      const len = state.buffer.readUInt32LE(0);
      if (state.buffer.length < 4 + len) break;
      const json = state.buffer.subarray(4, 4 + len).toString('utf8');
      state.buffer = state.buffer.subarray(4 + len);
      if (sender.isDestroyed()) return;
      try { sender.send('dpp-native-message', portId, JSON.parse(json)); } catch (err) { console.error('[native] bad frame', err); }
    }
  });
  child.stderr.on('data', (d) => console.warn(`[native:${hostName}]`, d.toString().trimEnd()));
  child.on('exit', (code) => {
    nativeChildren.delete(portId);
    if (!sender.isDestroyed()) sender.send('dpp-native-disconnect', portId, `Native host exited (code ${code}).`);
  });
  child.on('error', (err) => {
    nativeChildren.delete(portId);
    if (!sender.isDestroyed()) sender.send('dpp-native-disconnect', portId, err.message);
  });
});

ipcMain.on('dpp-native-post', (_e, portId, message) => {
  const state = nativeChildren.get(portId);
  if (!state) return;
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  try { state.child.stdin.write(header); state.child.stdin.write(body); } catch (err) { console.error('[native] write failed', err); }
});

ipcMain.on('dpp-native-disconnect-req', (_e, portId) => {
  const state = nativeChildren.get(portId);
  if (!state) return;
  nativeChildren.delete(portId);
  try { state.child.kill(); } catch {}
});

// ---------------------------------------------------------------------------
// Context menus: background registers items via chrome.contextMenus; we build
// an Electron Menu on right-click in the chat window and route clicks back.
// ---------------------------------------------------------------------------
let contextMenuItems = [];
ipcMain.on('dpp-ctxmenu-create', (_e, item) => { if (item) contextMenuItems.push(item); });
ipcMain.on('dpp-ctxmenu-removeall', () => { contextMenuItems = []; });
ipcMain.on('dpp-open-sidebar', () => showSidebar());

function buildSelectionMenu(selectionText, isEditable) {
  const template = [];
  if (selectionText) template.push({ role: 'copy' });
  if (isEditable) template.push({ role: 'cut' }, { role: 'paste' });
  const dynamic = contextMenuItems
    .filter((i) => !Array.isArray(i.contexts) || i.contexts.includes('selection'))
    .map((i) => (i.type === 'separator'
      ? { type: 'separator' }
      : {
          label: i.title || '',
          click: () => {
            if (backgroundWindow && !backgroundWindow.webContents.isDestroyed()) {
              backgroundWindow.webContents.send('dpp-contextmenu-clicked', {
                info: { menuItemId: i.id, selectionText },
                tab: { id: 1 },
              });
            }
          },
        }));
  if (template.length > 0 && dynamic.length > 0) template.push({ type: 'separator' });
  template.push(...dynamic);
  return template;
}

// ---------------------------------------------------------------------------
// Browser control: AI-controlled tabs are Electron windows; chrome.tabs and
// chrome.debugger (CDP) are routed here from core/browser-control.
//
// Tab id 1 is the chat window. Controlled tabs get ids >= 100. To avoid the AI
// hijacking the chat window, the chat tab is only returned for url-filtered or
// active/currentWindow queries (used by broadcast + conversation detection);
// the bare query({}) that browser-control uses to list targets sees only
// AI-opened windows.
// ---------------------------------------------------------------------------
const controlledTabs = new Map(); // tabId -> BrowserWindow
const wiredDebuggers = new Set();
let controlledSeq = 99;

function matchesUrlPattern(pattern, url) {
  if (!url || typeof pattern !== 'string') return false;
  const re = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  try { return new RegExp(`^${re}$`).test(url); } catch { return false; }
}
function chatTabInfo() {
  const wc = chatWindow && !chatWindow.webContents.isDestroyed() ? chatWindow.webContents : null;
  return {
    id: 1, windowId: 1, groupId: -1, active: true, currentWindow: true,
    url: wc ? wc.getURL() : CHAT_URL, title: wc ? wc.getTitle() : 'DeepSeek',
  };
}
function controlledTabInfo(win, id) {
  return {
    id, windowId: id, groupId: -1,
    active: win.isFocused(), currentWindow: false,
    url: win.webContents.getURL(), pendingUrl: win.__dppPendingUrl,
    title: win.webContents.getTitle(),
  };
}
function listControlledTabs() {
  return [...controlledTabs.entries()]
    .filter(([, win]) => !win.isDestroyed())
    .map(([id, win]) => controlledTabInfo(win, id));
}

ipcMain.handle('dpp-tabs-query', (_e, queryInfo) => {
  const q = queryInfo || {};
  const patterns = q.url == null ? null : (Array.isArray(q.url) ? q.url : [q.url]);
  if (patterns) return [chatTabInfo(), ...listControlledTabs()].filter((t) => patterns.some((p) => matchesUrlPattern(p, t.url)));
  if (q.active || q.currentWindow) return [chatTabInfo()];
  return listControlledTabs();
});
ipcMain.handle('dpp-tabs-get', (_e, tabId) => {
  if (tabId === 1) return chatTabInfo();
  const win = controlledTabs.get(tabId);
  if (!win || win.isDestroyed()) throw new Error(`No tab with id ${tabId}`);
  return controlledTabInfo(win, tabId);
});
ipcMain.handle('dpp-tabs-create', (_e, props) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled. Enable it in settings to use tabs.create.');
  const url = typeof props.url === 'string' ? props.url : null;
  if (url && !isValidNavigationUrl(url)) throw new Error(`Blocked navigation to privileged URL: ${url}`);
  const id = ++controlledSeq;
  const win = new BrowserWindow({ width: 1100, height: 800, show: props.active !== false });
  win.__dppPendingUrl = url || undefined;
  controlledTabs.set(id, win);
  win.webContents.on('did-navigate', () => { win.__dppPendingUrl = undefined; });
  // Issue #3: use event.preventDefault() to properly cancel disallowed navigations.
  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!isValidNavigationUrl(navUrl)) event.preventDefault();
  });
  win.on('closed', () => {
    controlledTabs.delete(id);
    wiredDebuggers.delete(id);
    if (backgroundWindow && !backgroundWindow.webContents.isDestroyed()) {
      backgroundWindow.webContents.send('dpp-debugger-detach-event', { tabId: id, reason: 'target_closed' });
    }
  });
  if (url) win.loadURL(url);
  return { id, windowId: id, groupId: -1, active: props.active !== false, url: '', pendingUrl: win.__dppPendingUrl, title: '' };
});
ipcMain.handle('dpp-tabs-update', (_e, tabId, props) => {
  const win = tabId === 1 ? chatWindow : controlledTabs.get(tabId);
  if (win && !win.isDestroyed() && props && props.active) { win.show(); win.focus(); }
  return tabId === 1 ? chatTabInfo() : (win && !win.isDestroyed() ? controlledTabInfo(win, tabId) : null);
});
ipcMain.handle('dpp-tabs-remove', (_e, tabId) => {
  const win = controlledTabs.get(tabId);
  if (win && !win.isDestroyed()) win.close();
  return true;
});

ipcMain.handle('dpp-tabs-reload', (_e, tabId) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  const win = tabId === 1 ? chatWindow : controlledTabs.get(tabId);
  if (win && !win.isDestroyed()) win.webContents.reload();
  return true;
});

ipcMain.handle('dpp-tabs-go-back', (_e, tabId) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  const win = tabId === 1 ? chatWindow : controlledTabs.get(tabId);
  if (win && !win.isDestroyed() && win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
  return true;
});

ipcMain.handle('dpp-tabs-go-forward', (_e, tabId) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  const win = tabId === 1 ? chatWindow : controlledTabs.get(tabId);
  if (win && !win.isDestroyed() && win.webContents.navigationHistory.canGoForward()) win.webContents.navigationHistory.goForward();
  return true;
});

// Gate chrome.debugger (attach / sendCommand) behind the same persisted setting.
ipcMain.handle('dpp-debugger-attach', (_e, tabId, version) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  const dbg = debuggerForTab(tabId);
  if (!dbg.isAttached()) dbg.attach(version || '1.3');
  wireDebuggerEvents(tabId);
  return true;
});
ipcMain.handle('dpp-debugger-send', (_e, tabId, method, params) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  return debuggerForTab(tabId).sendCommand(method, params || {});
});

// Note: the sidepanel toggles browser control via SET_BROWSER_CONTROL_ENABLED
// (background.js → chrome.storage.local), which already flows through
// dpp-store-set above into `store` and drives isBrowserControlEnabled(). No
// dedicated get/set IPC is needed — the storage relay is the single source of
// truth.

function debuggerForTab(tabId) {
  const win = tabId === 1 ? chatWindow : controlledTabs.get(tabId);
  if (!win || win.isDestroyed()) throw new Error(`No tab with id ${tabId}`);
  return win.webContents.debugger;
}
function wireDebuggerEvents(tabId) {
  if (wiredDebuggers.has(tabId)) return;
  const dbg = debuggerForTab(tabId);
  wiredDebuggers.add(tabId);
  dbg.on('message', (_e, method, params) => {
    if (backgroundWindow && !backgroundWindow.webContents.isDestroyed()) {
      backgroundWindow.webContents.send('dpp-debugger-event', { tabId, method, params });
    }
  });
  dbg.on('detach', (_e, reason) => {
    wiredDebuggers.delete(tabId);
    if (backgroundWindow && !backgroundWindow.webContents.isDestroyed()) {
      backgroundWindow.webContents.send('dpp-debugger-detach-event', { tabId, reason });
    }
  });
}
ipcMain.handle('dpp-debugger-detach', (_e, tabId) => {
  try { const dbg = debuggerForTab(tabId); if (dbg.isAttached()) dbg.detach(); } catch {}
  return true;
});

// ---------------------------------------------------------------------------
// Content-script injection — the same built files the Chrome/Android builds use.
// This is how the extension enhances the DeepSeek chat (memory, tools, tok/s,
// /skill popup, tool-result blocks); the side panel is the control surface.
// ---------------------------------------------------------------------------
function readDist(rel) {
  try { return fs.readFileSync(path.join(DIST_DIR, rel), 'utf8'); } catch { return null; }
}
async function injectContentScripts(win) {
  for (const rel of ['content-scripts/main-world.js', 'content-scripts/content.js']) {
    const code = readDist(rel);
    if (!code) { console.warn('[DeepSeek++] missing', rel, '- run prestart copy'); continue; }
    try {
      await win.webContents.executeJavaScript(`${code}\n//# sourceURL=dpp/${rel}`, true);
    } catch (err) {
      console.error('[DeepSeek++] inject failed', rel, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Sidebar (docked WebContentsView running the built sidepanel.html).
// ---------------------------------------------------------------------------
function createSidebarWindow() {
  const b = chatWindow && !chatWindow.isDestroyed()
    ? chatWindow.getBounds()
    : { x: 120, y: 120, width: 1280, height: 860 };
  // Prefer docking just right of the chat window, but clamp to the visible work
  // area so a maximized/full-width chat window never pushes the panel off-screen.
  const wa = screen.getDisplayMatching(b).workArea;
  let x = b.x + b.width;
  if (x + SIDEBAR_WIDTH > wa.x + wa.width) x = wa.x + wa.width - SIDEBAR_WIDTH;
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - 200));
  const height = Math.min(b.height, wa.height);
  sidebarWindow = new BrowserWindow({
    width: SIDEBAR_WIDTH,
    height,
    x,
    y,
    title: 'DeepSeek++ 控制台',
    icon: path.join(DIST_DIR, 'logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-sidebar.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  sidebarWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[DeepSeek++] sidebar load failed', code, desc, url);
  });
  sidebarWindow.webContents.on('did-finish-load', () => {
    console.log('[DeepSeek++] sidebar loaded', sidebarWindow.webContents.getURL());
  });
  sidebarWindow.on('closed', () => { sidebarWindow = null; });
  // dppasset:// (not loadFile) so sidepanel.html's absolute asset paths resolve.
  sidebarWindow.loadURL('dppasset://asset/sidepanel.html');
}
function showSidebar() {
  if (!sidebarWindow || sidebarWindow.isDestroyed()) { createSidebarWindow(); return; }
  if (!sidebarWindow.isVisible()) sidebarWindow.show();
  sidebarWindow.focus();
}
function toggleSidebar() {
  if (sidebarWindow && !sidebarWindow.isDestroyed() && sidebarWindow.isVisible()) {
    sidebarWindow.hide();
    return;
  }
  showSidebar();
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
function createBackgroundWindow() {
  backgroundWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-background.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  backgroundWindow.loadFile(path.join(__dirname, 'background.html'));
}

function createChatWindow() {
  chatWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'DeepSeek++',
    icon: path.join(DIST_DIR, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-chat.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  chatWindow.webContents.on('did-finish-load', async () => {
    const url = chatWindow.webContents.getURL();
    if (url.startsWith('https://chat.deepseek.com')) {
      // The preload exposes __DPP_CHROME__ via contextBridge (can't use 'chrome'
      // key because Electron pre-populates window.chrome for web pages). Alias
      // it to window.chrome before injecting content scripts so they find the
      // familiar chrome.runtime / chrome.storage API.
      try {
        await chatWindow.webContents.executeJavaScript(`
          (function() {
            if (!window.__DPP_CHROME__) return;
            try { window.chrome = window.__DPP_CHROME__; } catch(e) {}
            try { window.browser = window.chrome; } catch(e) {}
          })();
        `);
      } catch (err) {
        console.error('[DeepSeek++] chrome alias injection failed', err);
      }
      injectContentScripts(chatWindow);
    }
  });
  // Block navigation to privileged URLs (file://, chrome://, etc.)
  chatWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!isValidNavigationUrl(navUrl)) event.preventDefault();
  });
  chatWindow.webContents.on('context-menu', (_event, params) => {
    const template = buildSelectionMenu(params.selectionText || '', params.isEditable);
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: chatWindow });
  });
  chatWindow.loadURL(CHAT_URL);
  chatWindow.on('closed', () => {
    chatWindow = null;
    // The DeepSeek window is primary; closing it quits the whole app (sidebar +
    // hidden background) so the session profile flushes and unlocks for next launch.
    logToFile('chatWindow closed, calling quit'); if (process.platform !== 'darwin') app.quit();
  });
}

// DeepSeek's site shows an "abnormal environment" warning when it sees the
// Electron UA. Present a plain Chrome UA: drop the ` Electron/<v>` token and the
// app-product token (`<appName>/<v>`) that precedes ` Chrome/`.
function normalizeUserAgent() {
  const original = session.defaultSession.getUserAgent();
  const clean = original
    .replace(/ Electron\/[^ ]+/, '')
    .replace(/ [^ ]+\/[^ ]+ Chrome\//, ' Chrome/');
  session.defaultSession.setUserAgent(clean);
  console.log('[DeepSeek++] UA:', clean);
}

// One instance only: a second launch can't share the session profile (locked
// cookie/storage DBs), which would surface as being logged out. Defer to the
// running instance and (re)open its DeepSeek window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
logToFile('requestSingleInstanceLock result: ' + hasSingleInstanceLock);
const _origQuit = app.quit; app.quit = function(...args) { logToFile('app.quit() called: ' + new Error().stack); _origQuit.apply(this, args); };

app.on('second-instance', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.focus();
  } else if (app.isReady()) {
      logToFile('Creating chat window...');
  createChatWindow();
  }
});

app.whenReady().then(() => {
    logToFile('=== app.whenReady fired ===');
  if (!hasSingleInstanceLock) { logToFile('QUIT: single instance lock not acquired'); app.quit(); return; }
  normalizeUserAgent();
  registerAssetProtocol();
  Menu.setApplicationMenu(null);
    logToFile('Creating background window...');
  createBackgroundWindow();
  createChatWindow();
  const shortcutOk = globalShortcut.register('CommandOrControl+Shift+D', toggleSidebar);
  console.log('[DeepSeek++] sidebar shortcut registered:', shortcutOk);
  // The DeepSeek++ side panel launches together with the app, once the
  // background bridge is ready (so its first state queries resolve). Ctrl+Shift+D
  // still toggles it; the main DeepSeek window is left as the original extension
  // injects it (memory/skills/tools intact).
  backgroundWindow.webContents.once('did-finish-load', () => { logToFile('Background loaded, showing sidebar...'); showSidebar(); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createChatWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const { child } of nativeChildren.values()) { try { child.kill(); } catch {} }
  for (const win of controlledTabs.values()) { try { if (!win.isDestroyed()) win.destroy(); } catch {} }
});

app.on('window-all-closed', () => { logToFile('window-all-closed fired');
  if (process.platform !== 'darwin') app.quit();
});
