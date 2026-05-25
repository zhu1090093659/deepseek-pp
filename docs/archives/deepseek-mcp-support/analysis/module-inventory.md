## Module Inventory

| Module | Responsibility | Dependencies | Files | Lines | Complexity | S.U.P.E.R Score |
|:--|:--|:--|--:|--:|:--|:--|
| Background service worker | Message routing, persistence orchestration, sync, automation execution | memory, skill, preset, automation, sync, Chrome APIs | 1 | 491 | High | S🟡 U🟡 P🟡 E🟡 R🟡 |
| Content script | Page bridge, built-in tool execution, DOM rendering, restoration, background image integration | constants, tool parser, automation messages, Chrome APIs, DOM | 1 | 1012 | Critical | S🔴 U🟡 P🟡 E🟡 R🔴 |
| Main-world script | Network hook installation, page-context state sync, automation runner dispatch | fetch hook, skill popup, automation runner | 1 | 115 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |
| Interceptor | Prompt augmentation, SSE parsing, XML tool stripping, history cleanup | constants, memory injector, skill parser, SSE parser, tool parser | 3 | 1106 | Critical | S🔴 U🟡 P🔴 E🟡 R🔴 |
| Memory | Memory persistence, selection, prompt augmentation | Dexie, constants | 3 | 251 | Medium | S🟡 U🟢 P🟡 E🟢 R🟡 |
| Skill | Built-in/custom skill registry and slash parsing | Chrome Storage, constants | 3 | 297 | Low | S🟢 U🟢 P🟡 E🟢 R🟡 |
| Preset/model/background stores | Small Chrome Storage-backed config stores | Chrome Storage | 4 | 116 | Low | S🟢 U🟢 P🟡 E🟡 R🟢 |
| Automation | Automation types, storage, scheduling, DeepSeek runner, PoW | Chrome Storage, DeepSeek APIs, SSE parser, SHA3 | 7 | 2011 | Critical | S🟡 U🟢 P🟢 E🟡 R🟡 |
| Sync | WebDAV config/client and data merge | Chrome permissions, fetch | 3 | 122 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |
| Sidepanel UI | React management UI for memory, skills, presets, automation, settings | React, Chrome runtime messages | 14 | 2222 | High | S🟡 U🟢 P🟡 E🟡 R🟡 |
| Shared types/constants | Cross-module types, tool schemas, prompt templates | automation types | 2 | 288 | High | S🔴 U🟢 P🔴 E🟡 R🔴 |

## Module Details

### Background Service Worker

- Path: `entrypoints/background.ts`
- Responsibility: routes all extension messages, coordinates storage updates, handles sync, schedules automations, finds DeepSeek tabs, and sends automation run requests.
- Public API: `chrome.runtime.onMessage` actions in `MessageAction`; helper functions such as `executeAutomationRun`, `broadcastStateUpdate`, and `broadcastAutomationUpdate`.
- Internal dependencies: memory, skill, preset, automation, model, background, sync modules.
- External dependencies: Chrome extension APIs.
- Complexity rating: High.
- MCP transformation notes: MCP server config, tool discovery, invocation, permission grants, and health checks should be delegated into new `core/mcp/*` modules; `background.ts` should only route typed messages.
- S.U.P.E.R assessment:
  - S: Partial. It is currently a broad coordinator and message router.
  - U: Partial. Flow is mostly sidepanel/content -> background -> stores/tabs, but this file owns many unrelated workflows.
  - P: Partial. Message types exist, but runtime validation is minimal.
  - E: Partial. Chrome-specific by design; that is acceptable at entrypoint level.
  - R: Partial. Replacing sync, automation, or future MCP should be possible only if routing stays thin.

### Content Script

- Path: `entrypoints/content.ts`
- Responsibility: bridges main-world messages to Chrome runtime, executes built-in memory tools, renders and restores tool result blocks, cleans raw tool XML from the DOM, handles automation bridge, and applies background image behavior.
- Public API: window message handling for `TOOL_CALL`, `EXECUTE_TOOL_CALL`, `RESPONSE_COMPLETE`, and automation bridge messages.
- Internal dependencies: constants, tool parser, automation messages, background config.
- External dependencies: DOM APIs and Chrome runtime messaging.
- Complexity rating: Critical.
- MCP transformation notes: MCP tool execution must not be added as another large branch inside `executeToolCall`. Create a tool executor registry with built-in memory executor and MCP executor behind the same interface.
- S.U.P.E.R assessment:
  - S: Violation. Page DOM behavior, tool execution, restoration, bridge logic, and background image behavior are mixed.
  - U: Partial. It is correctly positioned between main-world and background, but execution logic is embedded locally.
  - P: Partial. `ToolCall` is typed, but tool-specific payload/result contracts are loose.
  - E: Partial. DOM selectors are tightly coupled to DeepSeek markup.
  - R: Violation. Swapping tool execution or UI rendering has high blast radius today.

### Main-World Script

- Path: `entrypoints/main-world.content.ts`
- Responsibility: installs network hooks, receives synced extension state, posts tool calls to content, and runs automation in the DeepSeek page context.
- Public API: `window.postMessage` protocol between main-world and content.
- Internal dependencies: `fetch-hook`, skill popup, automation runner.
- External dependencies: DeepSeek page globals, browser `window` APIs.
- Complexity rating: Medium.
- MCP transformation notes: main-world should receive only serializable tool schema metadata and callbacks, not MCP connection details.
- S.U.P.E.R assessment:
  - S: Compliant. The file mostly adapts between page context and extension context.
  - U: Compliant. Messages flow through content into background.
  - P: Partial. Existing message protocol is typed in practice but not centrally defined for all tool messages.
  - E: Partial. Main-world is page-specific by nature.
  - R: Partial. Hook implementation can be replaced, but message names are still string-based.

### Interceptor

- Path: `core/interceptor/`
- Responsibility: modifies DeepSeek request prompts, parses SSE chunks, extracts tool calls, hides XML tags from stream/history/DOM, and tracks completed responses.
- Public API: `installFetchHook`, `updateHookState`, `extractToolCalls`, `stripToolCalls`, `parseSSEChunk`.
- Internal dependencies: constants, memory injector, skill parser.
- External dependencies: DeepSeek request and streaming response formats.
- Complexity rating: Critical.
- MCP transformation notes: hardcoded `TOOL_NAMES`, `TOOL_CALL_REGEX`, and memory schemas must become dynamic tool metadata. A future `ToolDescriptor` list should drive prompt schema, parser matching, and filtering.
- S.U.P.E.R assessment:
  - S: Violation. `fetch-hook.ts` combines prompt building, response filtering, history cleanup, and stream state machine logic.
  - U: Partial. It depends inward on memory/skill modules rather than receiving a fully built prompt context.
  - P: Violation. Tool schemas are string constants, not contract objects.
  - E: Partial. It is strongly tied to DeepSeek API shape.
  - R: Violation. Adding tool types currently requires edits across constants, parser, filter, and content executor.

### Memory

- Path: `core/memory/`
- Responsibility: stores memories, selects relevant memories, and injects memory context into prompts.
- Public API: `getAllMemories`, `saveMemory`, `updateMemory`, `deleteMemory`, `buildAugmentedPrompt`.
- Internal dependencies: constants.
- External dependencies: Dexie.
- Complexity rating: Medium.
- MCP transformation notes: memory tools should become one implementation of a generic local tool provider, not the only tool provider.
- S.U.P.E.R assessment:
  - S: Partial. Storage, selection, and injection are separated but still coupled through constants.
  - U: Compliant. Prompt injection reads selected memory state without reverse dependencies.
  - P: Partial. Memory types are explicit, but tool schemas are not derived from typed contracts.
  - E: Compliant. Storage dependency is declared and local.
  - R: Partial. Replacement cost is moderate because prompt templates embed memory tools.

### Skill

- Path: `core/skill/`
- Responsibility: stores built-in/custom skills and parses slash invocations.
- Public API: `getAllSkills`, `saveSkill`, `deleteSkill`, `parseSkillCommand`.
- Internal dependencies: constants and `BUILTIN_SKILLS`.
- External dependencies: Chrome Storage.
- Complexity rating: Low.
- MCP transformation notes: skills could later declare allowed MCP tools, but the first MCP design should not overload Skill definitions.
- S.U.P.E.R assessment:
  - S: Compliant.
  - U: Compliant.
  - P: Partial. Skill shape is typed but not schema-versioned.
  - E: Compliant.
  - R: Partial. Replacing storage is easy; replacing invocation syntax is moderate.

### Automation

- Path: `core/automation/`
- Responsibility: stores automation definitions/runs, calculates schedules, executes DeepSeek page API runs, handles PoW, and reconciles history.
- Public API: automation store functions, schedule validation, `runAutomation`, `runDeepSeekAutomation`, automation bridge message types.
- Internal dependencies: SSE parser, constants.
- External dependencies: Chrome Storage, DeepSeek APIs, `js-sha3`.
- Complexity rating: Critical.
- MCP transformation notes: if automation prompts should use MCP, `AutomationRunnerRequest` needs either injected MCP tool schema or a shared prompt augmentation service. Tool execution during automation also needs a path back to background MCP execution.
- S.U.P.E.R assessment:
  - S: Partial. Submodules are reasonably focused, but runner remains large.
  - U: Compliant. Scheduler -> runner -> DeepSeek result flow is clear.
  - P: Compliant. Automation request/result contracts are explicit and serializable.
  - E: Partial. DeepSeek endpoints and PoW script URLs are hardcoded in page runner.
  - R: Partial. Replacing the DeepSeek runner is feasible but not cheap.

### Sidepanel UI

- Path: `entrypoints/sidepanel/`
- Responsibility: exposes management screens for memory, skills, presets, automation, settings, sync, model mode, and background image.
- Public API: React components and Chrome runtime message calls.
- Internal dependencies: shared types, automation schedule validator.
- External dependencies: React and Chrome extension APIs.
- Complexity rating: High.
- MCP transformation notes: add a dedicated MCP page if the feature includes server list, connection status, discovered tools, permission toggles, and test invocation. SettingsPage is already large and should not absorb a full MCP manager.
- S.U.P.E.R assessment:
  - S: Partial. Pages are split, but SettingsPage and AutomationPage are large.
  - U: Compliant. UI talks to background via messages.
  - P: Partial. Runtime message payloads are typed but not validated.
  - E: Partial. Chrome runtime APIs are used directly in pages.
  - R: Partial. Replacing UI widgets is feasible; replacing message contracts requires cross-file edits.

### Shared Types And Constants

- Path: `core/types.ts`, `core/constants.ts`
- Responsibility: central type definitions, DeepSeek constants, prompt templates, tool schemas, and parser regex.
- Public API: most cross-module types and constants.
- Internal dependencies: automation types.
- External dependencies: none.
- Complexity rating: High.
- MCP transformation notes: tool-related constants should move into a dynamic tool descriptor system; `core/types.ts` should not become a dumping ground for all MCP types.
- S.U.P.E.R assessment:
  - S: Violation. Tool schema strings, prompt templates, API URLs, regex, and stop words coexist.
  - U: Compliant. Shared modules do not import runtime entrypoints.
  - P: Violation. Schemas are string blobs rather than structured descriptors.
  - E: Partial. DeepSeek URL constants are hardcoded.
  - R: Violation. Tool replacement requires broad constant edits.
