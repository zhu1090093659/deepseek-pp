# DeepSeek++ Refactor Baseline

This document replaces stale active planning documents. It describes the code that exists on `main` now, so future work does not use a deleted agent-run rewrite plan as truth.

## Current Runtime Shape

- `core/automation/*` owns scheduled and manual automation tasks, run storage under `deepseek_pp_automations`, schedule parsing, run locking, retries, timeout handling, and the DeepSeek automation runner.
- `core/inline-agent/*` owns the in-chat continuation loop after manual MCP tool calls. It receives a DeepSeek session and parent message, sends continuation/nudge/finalization prompts, streams step UI events, and executes tools through the content bridge.
- `core/deepseek/active-client.ts` composes the active DeepSeek transport behind an injected automation port. Pure request/SSE codecs live beside it, `core/network/request-policy.ts` owns caller deadlines and UTF-8 body budgets, and `adapter.ts` is only a compatibility export for inline-agent/background callers not yet renamed.
- `core/interceptor/fetch-hook.ts` is the passive page adapter over the shared DeepSeek route/SSE codecs. It injects memory/Skill/preset/tool context, strips executable tool XML from visible streams/history/IndexedDB cache, tracks token speed, and reports response-complete metadata.
- `entrypoints/content.ts` is the isolated-world coordinator for runtime state, main-world messages, tool execution blocks, inline-agent traces, token speed UI, theme/background sync, and the pet overlay.
- `core/persistence/versioned-repository.ts` owns the narrow raw storage-slot and versioned repository contract used by Project, Saved Items, and Scenario. Each domain owns one pure codec reused by local storage, sync, and Side Panel boundaries; legal legacy reads do not write eagerly, while future/corrupt state fails closed before replacement.
- `core/memory/codec.ts` is the single Memory authority for IndexedDB rows, sync payloads, Settings imports, and UI notifications. Memory batch imports validate before one locked Dexie transaction; ordinary reads and writes reject corrupt or future database state instead of overwriting it.
- `core/artifact/store.ts` treats the released Chrome-storage array as migration input only and IndexedDB as the sole runtime truth. The existing `DeepSeekPPSyncRecovery` full-preimage journal is also reused for Project/Memory cascade deletion, so no second recovery protocol or cross-store truth source was added.

## Refactor Direction

- Prompt output is frozen byte-for-byte. System templates, tool schema rendering, tool reminders, and inline-agent continuation/nudge/finalization prompts must not change.
- Keep the current product surface and compatibility contracts: automation UI, inline agent, MCP, memory, Skill, preset, settings, and `deepseek_pp_automations`. The unused content/window automation bridge has been retired; durable scheduler/runner contracts remain.
- Keep `core/deepseek/request-codec.ts`, `stream-codec.ts`, and `stream-metrics.ts` as the sole route/SSE/metric authorities for active and passive consumers; page adapters own only browser interception and visible-stream rewriting.
- Share the tool continuation loop between automation and inline agent while keeping each caller's prompt builders, event callbacks, and UI behavior.
- Split large entrypoint/interceptor responsibilities into focused modules after behavior is pinned by tests.

## Validation Baseline

The expected validation sequence for this refactor is:

```bash
npm run prompt:freeze
npm run compile
npm run verify:automation
npm run smoke:mcp
npm run verify:mcp:mock
npm run smoke:shell
npm run build:all
```

If any prompt freeze case changes, stop and restore the previous prompt output before continuing.
