'use strict';

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
  app, BrowserWindow, ipcMain, protocol, net, Menu, globalShortcut, session, screen, dialog,
  safeStorage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

const CHAT_URL = 'https://chat.deepseek.com/';
const DIST_DIR = path.join(__dirname, 'dpp'); // staged copy of dist/chrome-mv3
const REPO_ROOT = path.join(__dirname, '..');
const STORE_FILE = path.join(app.getPath('userData'), 'dpp-store.json');
const SIDEBAR_WIDTH = 440;
const ENC_PREFIX = '__enc__:';
// Keys that the chat window (remote page) must not write, and that are
// encrypted on disk via safeStorage to protect auth tokens at rest.
const SENSITIVE_STORE_KEYS = new Set([
  'deepseekCachedClientHeaders',
  'deepseek_pp_browser_control_settings',
]);

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

function readDist(rel) {
  try { return fs.readFileSync(path.join(DIST_DIR, rel), 'utf8'); } catch { return null; }
}
function scriptHash(rel) {
  const src = readDist(rel);
  if (!src) return null;
  return crypto.createHash('sha256').update(src).digest('hex');
}
ipcMain.on('dpp-content-scripts', (e) => {
  e.returnValue = {
    mainWorld: readDist('content-scripts/main-world.js') || '',
    content: readDist('content-scripts/content.js') || '',
  };
});

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
    // Encrypt sensitive keys before writing to disk
    const diskStore = { ...store };
    for (const key of SENSITIVE_STORE_KEYS) {
      if (diskStore[key] != null && safeStorage.isEncryptionAvailable()) {
        try {
          const json = typeof diskStore[key] === 'string' ? diskStore[key] : JSON.stringify(diskStore[key]);
          diskStore[key] = ENC_PREFIX + safeStorage.encryptString(json).toString('base64');
        } catch (e) { console.warn('[dpp] encrypt failed for key', key, e.message); }
      }
    }
    fs.writeFile(STORE_FILE, JSON.stringify(diskStore), () => {});
  }, 50);
}
function decryptStoreValue(key, value) {
  if (!SENSITIVE_STORE_KEYS.has(key) || typeof value !== 'string' || !value.startsWith(ENC_PREFIX)) return value;
  try {
    const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
    return JSON.parse(safeStorage.decryptString(buf));
  } catch { return value; }
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
  const ALLOWED_EXTENSIONS = new Set([
    '.html', '.js', '.mjs', '.cjs', '.css', '.json', '.png', '.jpg', '.jpeg',
    '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map', '.wasm',
    '.zip', '.txt',
  ]);

  protocol.handle('dppasset', (request) => {
    const url = new URL(request.url);
    // dppasset://asset/<relative path inside dist>
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.join(DIST_DIR, rel);
    if (!filePath.startsWith(DIST_DIR)) return new Response('Forbidden', { status: 403 });
    const ext = path.extname(filePath).toLowerCase();
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      return new Response('Unsupported file type', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// ---------------------------------------------------------------------------
// IPC: storage
// ---------------------------------------------------------------------------
ipcMain.handle('dpp-store-get', (_e, keys) => {
  if (keys == null) {
    // Return full store with decrypted sensitive values
    const out = {};
    for (const [k, v] of Object.entries(store)) out[k] = decryptStoreValue(k, v);
    return out;
  }
  const list = Array.isArray(keys) ? keys : [keys];
  const out = {};
  for (const k of list) if (k in store) out[k] = decryptStoreValue(k, store[k]);
  return out;
});

ipcMain.handle('dpp-store-set', (e, values) => {
  const isChatSender = chatWindow && e.sender === chatWindow.webContents;
  const changes = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (isChatSender && SENSITIVE_STORE_KEYS.has(k)) {
      console.warn(`[dpp] blocked chat window write to sensitive key: ${k}`);
      continue;
    }
    changes[k] = { oldValue: store[k], newValue: v };
    store[k] = v;
  }
  persist();
  broadcastStorageChange(changes);
  return true;
});
ipcMain.handle('dpp-store-remove', (e, keys) => {
  const isChatSender = chatWindow && e.sender === chatWindow.webContents;
  const list = Array.isArray(keys) ? keys : [keys];
  const changes = {};
  for (const k of list) {
    if (isChatSender && SENSITIVE_STORE_KEYS.has(k)) {
      console.warn(`[dpp] blocked chat window delete of sensitive key: ${k}`);
      continue;
    }
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
// IPC: DPP_BRIDGE relay  (main-world.js ↔ content.js via preload contextBridge)
//
// With sandbox:true the MessagePort bridge is eliminated on desktop.
// All main-world ↔ content communication routes through these handlers
// so the page can neither observe nor forge bridge messages.
//
// Two directions:
//   dpp-bridge-relay:         main-world.js → content.js  (fire-and-forget)
//   dpp-bridge-to-mainworld:  content.js   → main-world.js (fire-and-forget)
// ---------------------------------------------------------------------------

ipcMain.handle('dpp-bridge-relay', (e, message) => {
  if (!chatWindow || chatWindow.webContents.isDestroyed()) return null;
  if (e.sender !== chatWindow.webContents) return null;
  chatWindow.webContents.send('dpp-bridge-from-mainworld', message);
  return null;
});

// content.js → main-world.js push messages (e.g. SYNC_HOOK_STATE, AUGMENT results)
ipcMain.handle('dpp-bridge-to-mainworld', (e, message) => {
  if (!chatWindow || chatWindow.webContents.isDestroyed()) return;
  if (e.sender !== chatWindow.webContents) return;
  chatWindow.webContents.send('dpp-bridge-from-content', message);
});

// ---------------------------------------------------------------------------
// IPC: native messaging (4-byte LE length frames, same as Chrome).
// ---------------------------------------------------------------------------
const nativeChildren = new Map(); // portId -> { child, buffer }

// Tool-execution confirmation gate (Finding #1, §5b.1). Intercepts every
// `tools/call` JSON-RPC frame before it reaches the native host child process.
// Read-only/status tools are allowed silently; anything that can mutate the
// local machine requires an explicit user confirmation per tool per session.
const trustedToolsThisSession = new Set(); // tool names trusted for this session
const READ_ONLY_TOOLS = new Set([
  'shell_status', 'python_status', 'local_skill_preview', 'local_folder_pick',
]);

function summarizeToolCall(name, args) {
  if (name === 'shell_exec') return `命令:\n${String(args?.command ?? '').slice(0, 800)}`;
  if (name === 'python_exec') return `Python 代码:\n${String(args?.code ?? '').slice(0, 800)}`;
  try { return JSON.stringify(args ?? {}, null, 2).slice(0, 800); } catch { return '(无法显示参数)'; }
}

async function confirmToolExecution(hostName, name, args) {
  if (trustedToolsThisSession.has(name)) return true;
  const parent = (chatWindow && !chatWindow.isDestroyed()) ? chatWindow : undefined;
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, {
    type: 'warning',
    noLink: true,
    title: 'DeepSeek++ · 工具执行确认',
    message: `允许在你的电脑上执行「${name}」?`,
    detail: `来源:${hostName}\n\n${summarizeToolCall(name, args)}`,
    buttons: ['拒绝', '允许这一次'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: `本次会话内信任「${name}」(不再询问此工具)`,
    checkboxChecked: false,
  });
  const allowed = response === 1;
  if (allowed && checkboxChecked) trustedToolsThisSession.add(name);
  return allowed;
}

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

ipcMain.on('dpp-native-post', async (e, portId, message) => {
  const state = nativeChildren.get(portId);
  if (!state) return;

  const rpc = message && message.message;
  if (rpc && rpc.method === 'tools/call') {
    const name = rpc.params?.name;
    // SEC-4: only the explicit read-only allowlist may run without confirmation.
    // A missing/unknown tool name must NOT silently bypass the gate, so anything
    // that is not a known read-only tool (including a forged frame with no name)
    // requires user confirmation.
    if (!name || !READ_ONLY_TOOLS.has(name)) {
      const ok = await confirmToolExecution(message.server?.id || 'native host',
                                            name || '(未知工具)', rpc.params?.arguments);
      if (!ok) {
        if (!e.sender.isDestroyed()) {
          e.sender.send('dpp-native-message', portId, {
            jsonrpc: '2.0',
            id: rpc.id ?? null,
            error: { code: -32001, message: '用户拒绝了该工具执行。' },
          });
        }
        return;
      }
    }
  }

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
// CDP method whitelist — only methods needed by the browser control service.
// Blocks dangerous methods (Browser.close, System.getInfo, IO.read, etc.)
// that could be abused by a compromised background script or rogue AI action.
const CDP_ALLOWED_METHODS = new Set([
  // Navigation & page lifecycle
  'Page.navigate', 'Page.reload', 'Page.getFrameTree', 'Page.enable',
  // DOM inspection
  'DOM.getDocument', 'DOM.querySelector', 'DOM.querySelectorAll',
  'DOM.describeNode', 'DOM.getOuterHTML', 'DOM.getAttributes', 'DOM.enable',
  // Accessibility tree
  'Accessibility.getFullAXTree', 'Accessibility.getPartialAXTree',
  // Script evaluation (filtered further by expression validator in service.ts)
  'Runtime.evaluate', 'Runtime.callFunctionOn', 'Runtime.enable',
  // Input simulation
  'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText',
  // Network observation
  'Network.enable', 'Network.getResponseBody',
  // Target auto-attach
  'Target.setAutoAttach',
  // JavaScript dialogs
  'Page.handleJavaScriptDialog',
  // Screenshots
  'Page.captureScreenshot',
]);

ipcMain.handle('dpp-debugger-send', (_e, tabId, method, params) => {
  if (!isBrowserControlEnabled()) throw new Error('Browser control is disabled.');
  if (!CDP_ALLOWED_METHODS.has(method)) {
    throw new Error(`CDP method not allowed: ${method}`);
  }
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
      // Sidebar loads a LOCAL file (sidepanel.html) — trusted content.
      // contextIsolation:true ensures the preload world is isolated from the
      // page; sandbox:false allows the preload to use contextBridge reliably.
      // The chrome shim is exposed to the main world ONLY via contextBridge.
      contextIsolation: true,
      sandbox: false,
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
  // Navigation guard: sidebar should never navigate away from its local page.
  sidebarWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!isValidNavigationUrl(navUrl)) event.preventDefault();
  });
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
      // Background loads a LOCAL file (background.html) — trusted content.
      // contextIsolation:true ensures the preload world is isolated from the
      // page, so even a compromised background.html cannot reach ipcRenderer.
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
      contextIsolation: true,   // remote page cannot see the preload world
      sandbox: true,            // remote chat renderer stays sandboxed (Blocker 1).
                                // The preload is minimal & sandbox-compatible: it only
                                // builds a bridge and injects scripts into dedicated
                                // worlds — it never eval()s the content bundle itself.
      nodeIntegration: false,
    },
  });

  // Content-script injection is handled by preload-chat.cjs (sandbox-safe):
  //   - chrome shim + DPP_BRIDGE go into a dedicated CONTENT isolated world via
  //     contextBridge.exposeInIsolatedWorld; the page can never reach that world
  //   - content.js runs in that isolated world via executeJavaScriptInIsolatedWorld
  //     (NOT eval'd in the Node-backed preload world)
  //   - main-world.js is injected into the MAIN world via webFrame.executeJavaScript,
  //     wrapped in a closure holding an unguessable per-load bridge token (Blocker 2)
  //   - the MAIN world only sees a narrow, token-gated DPP_BRIDGE relay — never the
  //     chrome shim, and a page script without the token can neither forge nor observe
  // Navigation guard stays here.
  chatWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!isValidNavigationUrl(navUrl)) event.preventDefault();
  });
  chatWindow.webContents.on('context-menu', (_event, params) => {
    const template = buildSelectionMenu(params.selectionText || '', params.isEditable);
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window: chatWindow });
  });
  // --- Security audit probe (Finding #1) ---
  // Runs in the MAIN world to verify the chrome shim is NOT exposed there.
  // SEC-6: development-only diagnostic; gated behind DPP_DEBUG so it does not
  // execute on every load in packaged/production builds.
  if (process.env.DPP_DEBUG) chatWindow.webContents.on('did-finish-load', () => {
    chatWindow.webContents.executeJavaScript(`
      (function() {
        let sendMessageResult;
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            // Native chrome.runtime.sendMessage exists (Electron pre-populates it);
            // calling it should NOT reach our background because it's the browser
            // native Proxy, not our shim.
            sendMessageResult = 'native_proxy_present';
          } else {
            sendMessageResult = 'chrome.runtime unavailable';
          }
        } catch (e) {
          sendMessageResult = 'error: ' + e.message;
        }
        const fetchStr = String(window.fetch);
        const fetchHooked = fetchStr.includes('async function') || fetchStr.length > 200;
        const mainWorldVal = window.mainWorld;
        return JSON.stringify({
          __DPP_CHROME__: typeof window.__DPP_CHROME__,
          browser: typeof window.browser,
          chrome_runtime: typeof window.chrome?.runtime,
          sendMessageResult: sendMessageResult,
          fetchHooked: fetchHooked,
          fetchHasAsync: fetchStr.includes('async function'),
          fetchHasNative: fetchStr.includes('native code'),
          fetchLength: fetchStr.length,
          fetchStrPreview: fetchStr.slice(0, 100),
          mainWorldType: typeof mainWorldVal,
          __DPP_DESKTOP__: window.__DPP_DESKTOP__,
          __DPP_MAIN_WORLD_INITIALIZED__: window.__DPP_MAIN_WORLD_INITIALIZED__,
          timestamp: Date.now()
        });
      })()
    `, true).then((result) => {
      console.log('[AUDIT] Main world security probe:', result);
    }).catch((err) => {
      console.log('[AUDIT] Main world security probe FAILED:', err.message);
    });
  });
  // --- End security audit probe ---
  chatWindow.loadURL(CHAT_URL);
  chatWindow.on('closed', () => {
    chatWindow = null;
    // The DeepSeek window is primary; closing it quits the whole app (sidebar +
    // hidden background) so the session profile flushes and unlocks for next launch.
    if (process.platform !== 'darwin') app.quit();
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

// ---------------------------------------------------------------------------
// DeepSeek auth-header capture (Finding #1, §5b.2).
//
// Instead of trusting the main-world script to forward HEADERS_CAPTURED over
// the page-visible bridge (which a compromised page could spoof), observe the
// real outbound request headers directly in the main process and persist them.
// This keeps the bridge untrusted for authentication data and also makes the
// captured headers available to the sidebar web chat.
// ---------------------------------------------------------------------------
const DEEPSEEK_HEADERS_KEY = 'deepseekCachedClientHeaders';

function lcHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return out;
}

function startDeepSeekHeaderCapture() {
  // SEC-7: https only — never capture/trust auth headers from a plaintext
  // (downgraded) chat.deepseek.com request.
  const filter = { urls: ['https://chat.deepseek.com/*'] };
  session.defaultSession.webRequest.onSendHeaders(filter, (details) => {
    const h = lcHeaders(details.requestHeaders);
    const auth = h['authorization'];
    if (!auth || !/^Bearer\s+\S/i.test(auth)) return;

    const captured = {
      Authorization: auth,
      'X-App-Version': h['x-app-version'] || '',
      'x-client-platform': h['x-client-platform'] || '',
      'x-client-version': h['x-client-version'] || '',
      'x-client-locale': h['x-client-locale'] || '',
      'x-client-timezone-offset': h['x-client-timezone-offset'] || '',
    };

    const prev = store[DEEPSEEK_HEADERS_KEY];
    if (prev && prev.Authorization === captured.Authorization) return;
    store[DEEPSEEK_HEADERS_KEY] = captured;
    persist();
    broadcastStorageChange({ [DEEPSEEK_HEADERS_KEY]: { oldValue: prev, newValue: captured } });
  });
}

// One instance only: a second launch can't share the session profile (locked
// cookie/storage DBs), which would surface as being logged out. Defer to the
// running instance and (re)open its DeepSeek window.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
app.on('second-instance', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.focus();
  } else if (app.isReady()) {
      createChatWindow();
  }
});

app.whenReady().then(() => {
    if (!hasSingleInstanceLock) { app.quit(); return; }
  normalizeUserAgent();
  registerAssetProtocol();
  // Log script integrity hashes for audit trail (supply chain detection).
  console.log(`[dpp] script integrity: main-world.js sha256=${scriptHash('content-scripts/main-world.js') || 'MISSING'}`);
  console.log(`[dpp] script integrity: content.js sha256=${scriptHash('content-scripts/content.js') || 'MISSING'}`);

  // --- CSP injection for the chat window (Item 8) ---
  // Adds a restrictive CSP when DeepSeek's own response lacks one.
  // unsafe-inline/unsafe-eval are required because the DeepSeek SPA uses both.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['https://chat.deepseek.com/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      const cspKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-security-policy');
      if (!cspKey) {
        headers['Content-Security-Policy'] = [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "connect-src 'self' https://chat.deepseek.com https://*.deepseek.com; " +
          "img-src 'self' data: blob: https:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "media-src 'self' blob:; " +
          "worker-src 'self' blob:;",
        ];
      }
      callback({ responseHeaders: headers });
    },
  );

  startDeepSeekHeaderCapture();
  Menu.setApplicationMenu(null);
    createBackgroundWindow();
  createChatWindow();
  const shortcutOk = globalShortcut.register('CommandOrControl+Shift+D', toggleSidebar);
  console.log('[DeepSeek++] sidebar shortcut registered:', shortcutOk);
  // The DeepSeek++ side panel launches together with the app, once the
  // background bridge is ready (so its first state queries resolve). Ctrl+Shift+D
  // still toggles it; the main DeepSeek window is left as the original extension
  // injects it (memory/skills/tools intact).
  backgroundWindow.webContents.once('did-finish-load', () => { showSidebar(); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createChatWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const { child } of nativeChildren.values()) { try { child.kill(); } catch {} }
  for (const win of controlledTabs.values()) { try { if (!win.isDestroyed()) win.destroy(); } catch {} }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
