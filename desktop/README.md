# DeepSeek++ Desktop (Electron) — Phase 1 scaffold

Packages the DeepSeek web app + the DeepSeek++ extension into a standalone
desktop app, the way the `android/` target packages it into a WebView app.

## Why Electron (not Tauri)

The extension is Chromium-targeted: it injects content scripts, hooks `fetch`
in the page's MAIN world, and uses CDP (`chrome.debugger`) for browser control.
Electron *is* Chromium, so all of that runs unchanged and the Electron main
process gives us Node.js — which makes the features Android had to disable
(native messaging, MCP stdio, scheduling) **native and easier**. Tauri uses the
OS WebView (WebView2/WKWebView), which has no CDP and different injection
semantics, so it would require rewriting those subsystems.

## How it works

```
chatWindow       visible   loads chat.deepseek.com, injects
                           dpp/content-scripts/{main-world.js,content.js}
backgroundWindow hidden    runs dpp/background.js (the "service worker")
main.cjs         process   relays chrome.runtime / chrome.tabs / chrome.storage
                           between the two renderers; owns persistence
```

Each renderer gets a `window.chrome` polyfill from its preload
(`preload-chat.cjs`, `preload-background.cjs`). This reuses the project's own
platform-host pattern (`core/platform/`, the `android/` bridge) — the same
built artifacts the Chrome/Android builds use, no fork of `core/`.

## Run it

```bash
# from the repo root
npm install
npm run build:chrome        # produces dist/chrome-mv3

cd desktop
npm install                 # electron
npm start                   # stages dist -> dpp, then launches
```

Log in to DeepSeek as usual; memory/skill/prompt-injection run in-window.

## Status

**Phase 1 (done):** window + content-script injection + background
runtime/storage bridge.

**Phase 2 (done):**
- `electron_desktop` PlatformKind in `core/platform/capabilities.ts`
  (detected via the `window.__DPP_DESKTOP__` marker the preloads set), with a
  vitest contract test. `GET_PLATFORM_CAPABILITIES` now reports it.
- **nativeMessaging / shell host / MCP stdio** → `chrome.runtime.connectNative`
  is polyfilled in `preload-background.cjs` and backed by `child_process.spawn`
  in `main.cjs`, speaking Chrome's 4-byte-LE-framed native messaging protocol.
  Verified end-to-end against `packages/shell-host` (initialize + tools/list →
  shell_exec, python_exec, …).
- **sidePanel UI** → the built `sidepanel.html` runs in a docked
  `WebContentsView` (toggle **Ctrl/Cmd+Shift+D**). Background broadcasts route
  to it the way the extension routes `chrome.runtime.sendMessage` to extension
  pages; `chrome.tabs.sendMessage` routes to the chat window.

**Phase 2b (done): browser control via CDP.**
- `chrome.debugger` is polyfilled in `preload-background.cjs`
  (attach/detach/sendCommand + onEvent/onDetach) and routed to
  `webContents.debugger` in `main.cjs` — near 1:1 with Chrome's CDP.
- AI-controlled tabs are modeled as Electron `BrowserWindow`s (ids ≥ 100) with
  a full `chrome.tabs` surface (query/get/create/update/remove). The chat
  window (tab id 1) is deliberately excluded from the target list browser
  control enumerates, so the AI can't navigate the chat away.
- `browserControl` / `debugger` / `accessibilityTree` / `tabs` are now `true`
  in `getElectronDesktopEnvironment()` (covered by the vitest contract test).
  The whole `core/browser-control` service (navigate, click, fill, snapshot via
  `Accessibility.getFullAXTree`, dialogs, evaluate) runs unmodified.

**Phase 2c (in progress): packaging + automation scheduler.**
- **Packaging** via `electron-builder`. `npm run dist` stages the bundle and the
  shell host, then builds a Win NSIS / macOS dmg / Linux AppImage. Uses
  `asar: false` so the `dppasset://` file protocol, `fs.readFileSync` of the
  staged bundle, and `child_process` spawning of the native host all keep
  working from `__dirname`-relative paths in the packaged app.
- **Shell host bundling** → `scripts/copy-shell-host-to-desktop.mjs` stages
  `packages/shell-host` into `desktop/native/`; `main.cjs` resolves it there
  (with a repo fallback for dev). Verified: the staged host answers the native
  messaging protocol via the exact path/env `main.cjs` uses.
- **alarms / automation scheduler** → `chrome.alarms` is polyfilled with
  `setInterval`/`setTimeout` in the persistent background window (valid because
  it is never throttled/torn down, unlike an MV3 service worker). `alarms` is
  now `true` in `getElectronDesktopEnvironment()`.

**Build the installer**

```bash
cd desktop
npm install
npm run dist     # -> desktop/release/
```

> First package build downloads electron + electron-builder (~hundreds of MB)
> and must run on the target OS (Windows builds on Windows, etc.). Code-signing
> is not configured yet — add signing credentials before public distribution.

### Verified

`electron-builder --dir` (unpacked app, no installer/signing) was built and the
exe was boot-tested on Windows: the app starts, `background.js` loads in the
hidden window, and `chat.deepseek.com` loads in the chat window. Every runtime
path `main.cjs` resolves — `dpp/background.js`, `dpp/sidepanel.html`, the
content scripts, and `native/shell-host/native/shell-mcp-host.mjs` — is present
in `resources/app/` (≈285 MB total with the Electron runtime).

The boot test surfaced and fixed two polyfill gaps: `chrome.runtime.getManifest`
(used by `core/version.ts`) and `chrome.storage.session` (used by the chat-loop
interruption marker). Both are now implemented in the preloads + main.

### Known issue: full installer on Windows without Developer Mode

`npm run dist` (NSIS installer) fails extracting electron-builder's `winCodeSign`
toolchain: its archive contains macOS `.dylib` **symlinks** and Windows blocks
symlink creation without Developer Mode/admin
(`Cannot create symbolic link … 客户端没有所需的特权`). Fixes, any one of:
- Enable **Settings → For developers → Developer Mode**, then `npm run dist`; or
- run the build shell **as Administrator**; or
- build the unpacked app with `npx electron-builder --dir` (used for the
  verification above — it still runs `rcedit` from winCodeSign but does not need
  the installer pipeline).

**Phase 2c (done): context menus + app icon.**
- **contextMenus** → `chrome.contextMenus` is polyfilled (create/removeAll/
  onClicked) and registered items are shown as an Electron `Menu` on right-click
  in the chat window (with Copy/Cut/Paste roles); clicks route back to the
  background handler. `chrome.sidePanel.open` reveals the docked sidebar, so the
  "send to chat" item works end to end.
- **app icon** → `scripts/copy-dist-to-desktop.mjs` stages `public/logo.png`
  (1254²) into `desktop/build/icon.png`; electron-builder generates the exe icon
  from it and `main.cjs` sets the window/taskbar icon. Verified: the rebuilt exe
  no longer uses the default Electron icon, and boots clean.

**Phase 2c remaining:**
- **multimodal MCP host** → spawn `deepseek-pp-multimodal-mcp` (npx + API key).
- Sidebar currently overlays the right edge; convert the chat page to a sibling
  `WebContentsView` so the two tile instead of overlap.
- Auto-update via `electron-updater`; code-signing for Win/macOS.

**Phase 3 (done): security hardening.**
- **Sandboxed renderer + minimal preload** (Blocker 1) → the chat window runs
  `contextIsolation:true` **and `sandbox:true`**. The preload no longer `eval()`s
  the content bundle in a Node-backed world. Instead it is a minimal,
  sandbox-compatible bridge that injects the built scripts into dedicated worlds:
  - `content.js` runs in a **dedicated isolated world** (`CONTENT_WORLD_ID`) via
    `webFrame.executeJavaScriptInIsolatedWorld`. Its chrome shim
    (`globalThis.browser`) and isolated `DPP_BRIDGE` are placed there with
    `contextBridge.exposeInIsolatedWorld`. The page (main world) cannot reach
    this world, and because the whole renderer is sandboxed there is no Node in
    any world the page can touch.
  - only `main-world.js` (the fetch hook) is injected into the MAIN world via
    `webFrame.executeJavaScript`. It never sees the chrome shim
    (`window.browser === undefined`, `window.chrome` stays the empty Electron
    stub).
- **Per-load bridge token** (Blocker 2) → `main-world.js` is injected wrapped in
  a closure that holds an unguessable per-load token (`__DPP_BRIDGE_TOKEN__`,
  generated by the preload, never assigned to any global). The page-facing
  `window.DPP_BRIDGE` requires that token on **every** call: `sendMessage(token,
  msg)` and `onMessage.addListener(token, fn)`. A page script — which cannot read
  another script's closure — therefore can neither forge messages to `content.js`
  (e.g. `TOOL_CALL`) nor observe `content.js` responses. Defence in depth: the
  page-facing shim also enforces a message-type whitelist and a sliding-window
  rate limit, and the two bridge directions use separate listener sets (SEC-2).
- **MessagePort elimination (desktop)** → the main-world ↔ content bridge no
  longer uses `window.postMessage` / `MessagePort`. All desktop bridge traffic
  routes through the preload → IPC → main process → IPC → preload relay.
- **Tool-execution confirmation** → as a further backstop, every `tools/call`
  frame that is not on the read-only allowlist requires explicit per-tool,
  per-session user approval via a native dialog (`dpp-native-post`) before the
  shell/python/MCP host runs it. A forged or unknown tool name does not bypass
  the gate (SEC-4).
- **Sender-origin checks + at-rest encryption** → the chat (remote) window
  cannot write the sensitive store keys (`deepseekCachedClientHeaders`,
  `deepseek_pp_browser_control_settings`); those are persisted encrypted via
  Electron `safeStorage`. Auth headers are captured by the main process from
  real outbound requests, not from the bridge.

## Site "abnormal environment" warning

DeepSeek's site shows a dismissible 使用环境异常 ("abnormal usage environment")
notice when it detects a non-standard browser. It is **not** raised by our
injected scripts and does not block chat — you can close it and keep using the
app. The primary trigger is the Electron User-Agent, so `main.cjs`
(`normalizeUserAgent`) strips the ` Electron/<v>` and `<appName>/<v>` tokens and
serves a plain Chrome UA on the default session. Verified: the window now
reports `…Chrome/130.0.6723.191 Safari/537.36`.

If the notice still appears after this, the remaining suspect is DeepSeek
detecting that `window.fetch` is wrapped (the core fetch hook — shared with the
browser extension). Mitigating that would mean making the hook's `toString()`
report native code, and is a `core/interceptor` change to evaluate separately.

## Caveats

- This is an untested-on-CI starting point; expect to debug the message relay
  the first run (open the background window devtools with
  `backgroundWindow.webContents.openDevTools()` in `main.cjs`).
- `contextIsolation:true` + `sandbox:true` are used on the chat window. The
  preload keeps the chrome shim in a dedicated isolated world (reached only by
  `content.js`) and exposes ONLY a narrow, token-gated `DPP_BRIDGE` message relay
  to the main world via `contextBridge`. The remote page cannot see preload
  globals, cannot reach Node APIs, and cannot call any `chrome.*` privileged
  API — without the per-load token it cannot even forward a bridge message or
  observe a response, and any resulting local tool execution is additionally
  gated by a native confirmation dialog.
- DeepSeek auth lives in the window's own cookies/session, same as a browser.
