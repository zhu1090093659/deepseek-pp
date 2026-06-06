# Risk Assessment

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:--|:--|:--|:--|
| **S** Single Purpose | 🔴 | `entrypoints/content.ts`, `entrypoints/background.ts`, and `core/interceptor/fetch-hook.ts` are large multi-responsibility hotspots. | High |
| **U** Unidirectional Flow | 🟡 | The desired sidepanel -> background -> adapter -> artifact flow exists for some features, but page hook, DOM rendering, cleanup, and background routing are tightly coupled. | High |
| **P** Ports over Implementation | 🔴 | No export schema, no attachment schema, no typed export RPC, and only partial runtime validation patterns. | High |
| **E** Environment-Agnostic | 🟡 | DeepSeek transport uses page globals in places; attachment download may involve CDN hosts, signed URLs, or MV3 service worker lifecycle issues. | Medium |
| **R** Replaceable Parts | 🔴 | Official DeepSeek API shape changes currently concentrate in adapter/interceptor, but export would ripple if implemented directly in UI/hook code. | High |

**Overall Health**: 1/5 principles healthy enough for this feature. The current codebase is usable, but this feature needs a structural foundation rather than a local hotfix.

### S.U.P.E.R Violation Hotspots

1. `entrypoints/content.ts`: critical size and mixed DOM/runtime/state responsibilities. Do not add export fetching or packaging here.
2. `core/interceptor/fetch-hook.ts`: combines fetch/XHR/IndexedDB hook, response mutation, tool stripping, token speed, response metadata. Do not use it as the export engine.
3. `entrypoints/background.ts`: central untyped message switch. Add only a narrow RPC and delegate implementation.
4. `core/deepseek/adapter.ts`: best transport boundary, but currently mixes environment reads with API calls; export work should add explicit origins/headers and schemas.
5. `core/types.ts`: partial runtime message union. Export messages should be typed or isolated in a feature-specific contract.

## Risk Matrix

| Risk | Impact | Likelihood | Severity | Mitigation |
|:--|:--|:--|:--|:--|
| Official DeepSeek export/history/file APIs are private and can change. | Export breaks or misses data. | High | High | Start implementation with logged-in API discovery and fixture capture; isolate endpoint parsing in `core/deepseek/conversation-export.ts`. |
| Attachments are not available through `history_messages`. | User expects files but gets only IDs. | Medium | High | Treat file bodies as a separate attachment mode; require endpoint verification before promising file contents. |
| Existing history hook returns sanitized/mutated history. | Raw official export becomes inaccurate. | Medium | High | Export through independent adapter fetch with bypass/explicit mode, and expose raw vs sanitized as an explicit choice. |
| DOM scraping seems easy but is brittle. | Breaks with DeepSeek UI class changes and misses hidden data. | High | High | Use DOM only as last-resort current-session context, not as primary export source. |
| Adding `downloads` or new host permissions affects Chrome Web Store policy. | Store review risk or user trust issue. | Medium | High | Prefer Blob/anchor download for JSON/Markdown first; add permissions only if needed for attachment packages and update policy docs/scripts together. |
| MV3 service worker lifecycle interrupts long downloads. | Incomplete attachment export. | Medium | Medium | For large files, use foreground sidepanel orchestration or resumable manifest state; record failures in attachment manifest. |
| Exporting conversations creates privacy-sensitive artifacts. | Accidental data leakage. | Medium | High | On-demand only, no silent archive; clear UI copy, local-only generation, no cloud sync unless explicitly requested. |
| Runtime schema is missing. | Bad payload silently creates corrupt exports. | High | High | Add validators and fail closed with visible errors. |
| Background message switch grows further. | Maintainability regression. | High | Medium | Keep background branch thin; use feature module functions and typed request/result. |
| Cross-browser differences. | Chrome works, Firefox/Edge fails. | Medium | Medium | Include `build:all` and permission policy checks in validation. |

## High-Severity Risks

### Official API Contract Risk

Current code hardcodes and validates the completion path and uses `/api/v0/chat/history_messages` for history snapshot/cleanup. It does not have a stable public contract for conversation listing, full export jobs, file metadata, or file downloads.

An unauthenticated live request to `https://chat.deepseek.com/` was blocked with HTTP 429 during Phase 1, so Phase 1 could not independently verify the current official frontend bundle or export endpoints. Future implementation must perform logged-in browser-context verification before locking the plan for file bodies.

### Attachment Completeness Risk

The existing request model only preserves `ref_file_ids`. There is no current local schema for file name, size, MIME type, signed URL, expiry, checksum, image metadata, or audit/download state. A feature that says "including files" must distinguish:

- file references and metadata, which may be available from history or file lookup APIs;
- file contents, which require verified download endpoints and permission/lifecycle handling.

### Raw vs Sanitized Export Risk

DeepSeek++ intentionally cleans internal prompt and tool-call artifacts from visible streams, history responses, and DeepSeek IndexedDB cache reads. That is correct for page display, but it is unsafe as an implicit export policy.

The export feature must explicitly define at least two modes:

- **Official/raw**: user-owned official records as returned by DeepSeek APIs, with minimal normalization.
- **Readable/sanitized**: user-visible conversation text with DeepSeek++ internal markers stripped through an explicit transform.

The transform must be named and test-covered, not accidentally inherited from `fetch-hook.ts`.

### Permission and Policy Risk

Current manifest permissions include `storage`, `alarms`, `nativeMessaging`, `contextMenus`, Chromium `sidePanel`, and host permission for `chat.deepseek.com`. There is no `downloads` permission. Optional host permissions are documented for user-configured WebDAV/MCP endpoints.

If attachment export needs external signed URLs or browser downloads, update these together:

- `wxt.config.ts`
- `scripts/manifest-policy-check.mjs`
- `docs/chrome-web-store/privacy-policy.md`
- `docs/chrome-web-store/submission.md`
- release/listing notes if user-visible

## Technical Debt

- `entrypoints/content.ts` is the largest hotspot and should not absorb new feature logic.
- `entrypoints/background.ts` is a large switch with many untyped message branches.
- `core/interceptor/fetch-hook.ts` combines interception and mutation logic that should stay separate from export.
- `core/types.ts` contains partial contracts and does not fully represent background messages.
- Storage modules are split by feature but lack a shared runtime validation convention except sync.
- Existing tests are useful but narrow; no fixtures cover DeepSeek history/file payload normalization.

## Compatibility Concerns

- DeepSeek official endpoints may require a current logged-in session, captured client headers, CSRF-like headers, PoW, or browser origin.
- `readHistorySnapshot()` currently builds a URL from `location.origin`; background code needs explicit `https://chat.deepseek.com`.
- Firefox MV3 behavior and permissions may differ from Chrome/Edge.
- JSON/Markdown export can be done without new dependencies. ZIP packaging would require a dependency or custom archive generation and should be planned deliberately.
- Very large attachments may exceed comfortable in-memory Blob packaging.

## Recommended Direction for Phase 2

The feature should be scoped as a structural implementation:

1. Build an explicit export schema and DeepSeek export/history/file adapter.
2. Verify official endpoints in a logged-in browser context before implementing file-body export.
3. Add a sidepanel export surface that calls background RPC and downloads a local artifact.
4. Start with JSON plus readable Markdown; only add ZIP/file-body export if endpoint verification confirms it is reliable.
5. Update privacy/permission docs in the same phase as any new permission or attachment behavior.

## Phase 1 Validation

- Read-only project analysis completed with three parallel explorer agents plus direct source inspection.
- `gh` pre-flight detected `GITHUB_STANDARD`.
- One explorer reported `npm run compile` and `npm test` passing during read-only risk analysis.
- Direct unauthenticated live endpoint check of `https://chat.deepseek.com/` returned HTTP 429, so official export/file endpoint details remain unverified.
