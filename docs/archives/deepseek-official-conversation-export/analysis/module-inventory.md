# Module Inventory

## Summary Table

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| Manifest/config | Generate browser extension manifest, permissions, build config. | WXT, Tailwind, package metadata. | 1 | 78 | Medium | S🟢 U🟢 P🟡 E🟢 R🟡 |
| Main-world entrypoint | Install page-context hooks and bridge to isolated content. | `core/interceptor`, MessagePort. | 1 | 181 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |
| Isolated content coordinator | Runtime state sync, DOM rendering, inline agent UI, token speed, pet/background overlays, bridge handling. | Chrome runtime/storage, DOM, many `core/*` modules. | 1 | 3591 | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| Background runtime | Central message router, side panel behavior, sync, MCP, automation, sidepanel chat. | Chrome APIs, almost all storage and feature modules. | 1 | 1096 | Critical | S🔴 U🟡 P🔴 E🟡 R🔴 |
| Sidepanel shell | React tab shell and lazy page routing. | React, `core/chat/store`, extension version. | 1 | 129 | Medium | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Sidepanel pages/components | Management UI for memory, settings, MCP, automation, presets, skills, chat. | React, Chrome runtime, feature stores/types. | 23 | 5341 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| DeepSeek adapter | Shared official DeepSeek transport for headers, session, PoW, completion, history snapshot. | Fetch, localStorage, chrome.storage, SSE parser, PoW WASM. | 2 | 737 | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Interceptor | Fetch/XHR/IndexedDB interception, prompt augmentation bridge, stream cleanup, history cleanup. | DeepSeek constants, prompt/tool helpers, SSE parser, browser page APIs. | 6 | 1783 | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| Prompt/memory injection | Build prompt augmentation from memories, skills, presets, tools. | Memory selector, skill parser, token estimator, constants. | 7 | 775 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Memory store | Dexie-backed long-term memory CRUD and retention cleanup. | Dexie, crypto UUID, shared types. | 3 | 243 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |
| Skill registry/import | Built-in/custom/remote skill storage and GitHub import. | Chrome storage, GitHub API, parser, OfficeCLI library. | 4 main files plus bundled skills | 1388+ | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| MCP subsystem | MCP server storage, discovery, client, transports. | Chrome permissions, native messaging, fetch/SSE/HTTP transports. | 10 | 1719 | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Tool runtime/history | Built-in tool descriptors, invocation parsing, runtime execution, history. | Tool providers, storage, web search, memory tool. | 6 | 773 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Inline agent/tool loop | In-chat continuation after tool results. | DeepSeek adapter, tool-loop engine, renderer, prompt contracts. | 5 | 854 | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Automation | Scheduled/manual automation, run storage, scheduler, DeepSeek runner. | Chrome alarms/storage, DeepSeek adapter, tool execution. | 7 | 1584 | High | S🟡 U🟢 P🟢 E🟡 R🟡 |
| Sync/WebDAV | WebDAV config/client and runtime validators for extension data backup. | Fetch, Chrome storage, schema validators. | 3 | 276 | Medium | S🟢 U🟢 P🟢 E🟡 R🟡 |
| Settings/background/theme/pet/model/scenario stores | Feature settings in `chrome.storage.local`. | Chrome storage, config normalizers. | 10 | 399 | Medium | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Tests/scripts | Vitest unit tests and release/smoke/manifest scripts. | Vitest, Node scripts, WXT output. | 15+ | n/a | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |

> S.U.P.E.R score legend: 🟢 healthy, 🟡 partial, 🔴 violation.

## Module Details

### Manifest/config

- **Path**: `wxt.config.ts`
- **Responsibility**: Generate extension metadata, browser-specific permissions, host permissions, CSP, and Vite aliases.
- **Public API**: `defineConfig({ manifest: createManifest })`.
- **Internal Dependencies**: `core/browser/safe-wxt-browser.ts`.
- **External Dependencies**: WXT, Tailwind Vite plugin, Node fs/path/url.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Current host permission already covers `chat.deepseek.com`; `downloads` permission is absent. If attachment export needs Chrome Downloads API or CDN host access, update manifest, manifest policy check, and store docs together.
- **S.U.P.E.R Assessment**:
  - **S**: Good. Manifest generation is the only job.
  - **U**: Good. Config depends on app metadata; runtime modules do not depend back on config.
  - **P**: Partial. Permission contracts are encoded in code and scripts, not a shared schema.
  - **E**: Good. Browser-specific differences are centralized.
  - **R**: Partial. Permissions can change locally, but policy docs/scripts must stay in sync.

### Main-world entrypoint

- **Path**: `entrypoints/main-world.content.ts`
- **Responsibility**: Install `installFetchHook()` in MAIN world and bridge hook events to isolated content.
- **Public API**: WXT `defineContentScript({ world: 'MAIN' })`.
- **Internal Dependencies**: `core/interceptor/fetch-hook`, `core/ui/skill-popup`.
- **External Dependencies**: browser `window.postMessage`, `MessagePort`.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Keep this as a hook/bridge. Export should not fetch, normalize, or package data here.
- **S.U.P.E.R Assessment**:
  - **S**: Good. Hook installation and bridge coordination.
  - **U**: Good. Sends events outward.
  - **P**: Partial. Bridge messages are normalized but not centrally typed.
  - **E**: Partial. Requires MAIN world/page APIs.
  - **R**: Partial. Replacing the hook transport would require coordinated content changes.

### Isolated content coordinator

- **Path**: `entrypoints/content.ts`
- **Responsibility**: Synchronize runtime state to main world, coordinate tool execution UI, inline agent traces, DOM cleanup, token speed, theme/background, and pet overlay.
- **Public API**: WXT content script, runtime message handlers, DOM rendering helpers.
- **Internal Dependencies**: Broad imports from `core/*`.
- **External Dependencies**: Chrome runtime/storage, DOM APIs.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Avoid adding export logic here. At most, expose the current route/session context if background cannot infer it.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Many UI, state, bridge, and DOM responsibilities in one file.
  - **U**: Partial. It mediates multiple directions between page, main world, background, and DOM.
  - **P**: Partial. Message payloads are ad hoc.
  - **E**: Violation. Deep page DOM selectors and browser APIs are embedded.
  - **R**: Violation. DOM or DeepSeek UI changes ripple through a large file.

### Background runtime

- **Path**: `entrypoints/background.ts`
- **Responsibility**: Extension service worker: message routing, state broadcasts, context menus, sync, MCP, automation, sidepanel chat.
- **Public API**: `chrome.runtime.onMessage` message types.
- **Internal Dependencies**: Memory, skill, preset, model, theme, background, pet, sync, tool runtime, MCP, shell, web tools, scenario, chat, automation, DeepSeek adapter, prompt builder.
- **External Dependencies**: Chrome extension APIs, fetch.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Add export through a narrow branch and delegate to `core/deepseek`/`core/export`. Do not place endpoint parsing or file packaging inside the switch.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Central router owns too many feature workflows.
  - **U**: Partial. Mostly UI/background/core flow, but message switch couples many domains.
  - **P**: Violation. `core/types.ts` does not fully cover all runtime messages.
  - **E**: Partial. Chrome service worker assumptions are expected but broad.
  - **R**: Violation. Replacing one feature path risks touching the central file.

### Sidepanel shell and pages

- **Path**: `entrypoints/sidepanel/`
- **Responsibility**: React management UI for chat, memory, capabilities, presets, automation, settings, MCP, and skills.
- **Public API**: User-facing side panel routes and runtime message calls.
- **Internal Dependencies**: Shared types, stores, page components.
- **External Dependencies**: React, Chrome runtime APIs.
- **Complexity Rating**: High.
- **Transformation Notes**: Existing Settings page has a memory JSON Blob download pattern. Conversation export needs separate state, progress, and errors, probably as a new Settings section or dedicated tab.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Pages are split, but Settings is already dense.
  - **U**: Partial. Pages call background directly.
  - **P**: Partial. Message contracts are not fully typed.
  - **E**: Partial. Chrome runtime is directly used in pages.
  - **R**: Partial. A new export component can be isolated if message contracts are explicit.

### DeepSeek adapter

- **Path**: `core/deepseek/`
- **Responsibility**: Shared transport for official DeepSeek session creation, PoW headers, prompt submission, streaming parsing, history snapshot, session URL helpers.
- **Public API**: `createChatSession`, `createPowHeaders`, `createClientHeaders`, `rememberDeepSeekClientHeaders`, `loadClientHeadersFromStorage`, `submitPromptStreaming`, `readHistorySnapshot`, `buildDeepSeekSessionUrl`.
- **Internal Dependencies**: `core/constants`, `core/chat/store`, `core/interceptor/sse-parser`, `core/deepseek/pow`.
- **External Dependencies**: Fetch, `localStorage`, `chrome.storage.local`, `document`, `navigator`.
- **Complexity Rating**: High.
- **Transformation Notes**: Add export-specific adapter functions here or in a sibling module. Fix environment assumptions for background use by passing explicit origins/headers.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Transport concerns are related, but the file mixes auth, PoW, stream parsing, history snapshot, and environment reads.
  - **U**: Good. Feature callers depend on adapter.
  - **P**: Partial. DeepSeek history message shape is only lightly normalized.
  - **E**: Partial. Uses page globals.
  - **R**: Partial. Endpoint changes currently affect this file, which is good, but schemas are not explicit enough.

### Interceptor

- **Path**: `core/interceptor/`
- **Responsibility**: Intercept DeepSeek request/response paths, augment requests, parse SSE, strip internal tool-call/prompt artifacts from visible stream/history/IndexedDB cache, track token speed.
- **Public API**: `installFetchHook`, `updateHookState`, parsers/cleanup helpers.
- **Internal Dependencies**: DeepSeek constants/adapter, prompt sanitizers, tool descriptors, SSE/token-speed helpers.
- **External Dependencies**: Fetch, XHR, IndexedDB, page streams.
- **Complexity Rating**: Critical.
- **Transformation Notes**: Existing history interception mutates `history_messages` output for display hygiene. Export must not accidentally inherit this cleaning path unless the user selects a sanitized export.
- **S.U.P.E.R Assessment**:
  - **S**: Violation. Hook installation, request mutation, stream mutation, history cleanup, IDB cleanup, response metadata are combined.
  - **U**: Partial. Mostly one-way hook callbacks, but page APIs and app logic are interleaved.
  - **P**: Partial. Parser contracts are implicit.
  - **E**: Violation. Strongly page/browser-context specific.
  - **R**: Violation. Official response shape changes can affect streaming, cleanup, tool restoration, and future export if not isolated.

### Storage and sync modules

- **Path**: `core/memory`, `core/sync`, feature-specific `store.ts` files.
- **Responsibility**: Persist user-created extension data and sync selected extension data to WebDAV.
- **Public API**: CRUD functions and validators.
- **Internal Dependencies**: Shared types and config normalizers.
- **External Dependencies**: Dexie, Chrome storage, fetch/WebDAV.
- **Complexity Rating**: Medium.
- **Transformation Notes**: Official conversations should not be silently persisted in extension storage. Export artifacts should be generated on demand unless the user explicitly asks for local archives.
- **S.U.P.E.R Assessment**:
  - **S**: Partial to good. Individual stores are small, but no shared storage port exists.
  - **U**: Good. Feature code calls stores.
  - **P**: Partial/good. Sync validators are good; many stores lack runtime schemas.
  - **E**: Partial. Chrome/Dexie assumptions are embedded.
  - **R**: Partial. Storage backend replacement would touch many feature stores.

### Automation and inline agent

- **Path**: `core/automation`, `core/inline-agent`, `core/tool-loop`
- **Responsibility**: Run long-running tasks in DeepSeek, continue after tool results, store run/session state.
- **Public API**: Automation store/runner/scheduler, inline agent loop payloads.
- **Internal Dependencies**: DeepSeek adapter, prompt builders, tool runtime.
- **External Dependencies**: Chrome alarms/storage, DeepSeek APIs.
- **Complexity Rating**: High.
- **Transformation Notes**: Automation's session URL, parent message id, and history snapshot handling are useful references for export context and state modeling.
- **S.U.P.E.R Assessment**:
  - **S**: Partial. Split by domain but still complex.
  - **U**: Good. Callers drive runner/loop.
  - **P**: Partial/good. Automation types are stronger than background message contracts.
  - **E**: Partial. Chrome/DeepSeek assumptions remain.
  - **R**: Partial. Shared `core/tool-loop/engine.ts` improves replacement cost.

## Export-Specific Missing Module

The codebase currently lacks a module that owns official conversation export. The planned module should provide:

- `ConversationExportRequest`: target scope, format, attachment mode, raw/sanitized mode.
- `ConversationExport`: metadata, sessions, messages, attachment manifest, source API metadata, createdAt/version.
- `ExportedMessage`: message id, parent id, role, createdAt, content/fragments, model/search/thinking metadata, file refs.
- `ExportedAttachment`: file id, name, size, MIME/type hints, source message ids, signed/download URL metadata if available, download status.
- `normalizeDeepSeekHistoryPayload()`: official payload to schema.
- `buildExportArtifact()`: schema to JSON/Markdown/package payload.
- `validateConversationExport()`: fail-closed validation for user download.

This module is a structural prerequisite before implementing UI, because it creates a single source of truth for exported data shape and keeps official API churn out of sidepanel/background code.
