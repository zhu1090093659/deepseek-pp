# Task Breakdown

## Overview

- **Task Name**: DeepSeek official conversation export
- **Confirmed Scope**: Export all official DeepSeek web conversations, with JSON + Markdown by default, raw and readable/sanitized modes, file references/metadata first, and file-body export only after endpoint verification.
- **Total Phases**: 5
- **Total Tasks**: 18
- **Estimated Total Effort**: XL
- **Tracking Mode**: GITHUB_STANDARD

## Confirmed Task Definition

Build a user-facing DeepSeek++ export feature that lets users export all of their official DeepSeek web conversation records. The first reliable release target is all-history text export with file references/metadata, `official/raw` and `readable/sanitized` modes, and JSON + Markdown artifacts. PDF support should be added through the same export schema/rendering pipeline if it remains low-risk. File content export is a controlled follow-on task: verify official file download endpoints first, then implement package download only if the endpoint, permissions, and large-file behavior are safe.

## S.U.P.E.R Design Constraints

- **S (Single Purpose)**: Keep export schema, DeepSeek API fetching, normalization, artifact formatting, background RPC, and UI in separate modules. Do not add export business logic to `content.ts`, `fetch-hook.ts`, or the Settings page body.
- **U (Unidirectional Flow)**: Data flows `sidepanel -> background RPC -> export service -> DeepSeek adapter -> normalized schema -> artifact`. DOM scraping is not a primary source.
- **P (Ports over Implementation)**: `ConversationExport` and related types are the feature's contract. Official DeepSeek payloads are adapter inputs, never cross-module truth.
- **E (Environment-Agnostic)**: Pass explicit `baseUrl`, `clientHeaders`, and `fetch` dependencies into adapter functions. Avoid `location`/`document` assumptions in background-callable code.
- **R (Replaceable Parts)**: Endpoint-specific parsing, artifact formats, attachment metadata, and future file-body packaging must be swappable without changing UI state logic.

## Phase 1: Discovery And Contracts

**Goal**: Lock the official endpoint facts and define the export data contract before implementation.
**Prerequisite**: Phase 1 analysis completed.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T1.1 | Freeze scope and export modes | P0 | S | - | Contract | S, P | Scope document records all-history export, JSON/Markdown defaults, raw/sanitized modes, metadata-first attachments, and gated file-body export. |
| T1.2 | Verify official endpoints and capture fixtures | P0 | L | - | Verify | P, E, R | Logged-in browser-context verification identifies session list/export/history and file metadata endpoints; fixtures are captured for success, pagination, missing fields, and endpoint failure. |
| T1.3 | Define `ConversationExport` schema and types | P0 | L | T1.1, T1.2 | Contract | S, P, R | `ConversationExportRequest`, `ConversationExport`, `ExportedSession`, `ExportedMessage`, and `ExportedAttachment` are serializable and become the single schema source. |
| T1.4 | Add validators and raw/sanitized contract | P0 | M | T1.3 | Contract | P, R | Validators fail closed with visible errors; raw and sanitized modes are explicit named transforms and do not depend on implicit `fetch-hook` mutation. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| Verify | T1.2 | L | Low | `tests/fixtures/deepseek-export/*`, `docs/analysis/risk-assessment.md` |
| Contract | T1.1, T1.3, T1.4 | XL | Low | `core/export/types.ts`, `core/export/schema.ts`, `core/export/sanitize.ts` |

## Phase 2: Core Export Pipeline

**Goal**: Fetch all official conversation data and normalize it into the export schema.
**Prerequisite**: Phase 1 contracts and fixtures.
**S.U.P.E.R Focus**: U, P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T2.1 | Create background-safe DeepSeek export transport port | P0 | M | T1.2, T1.3 | Adapter | U, P, E, R | Adapter functions accept explicit `baseUrl`, `clientHeaders`, and `fetch`; no `location`/`document` dependency in export code. |
| T2.2 | Implement all-session listing adapter | P0 | L | T2.1 | Adapter | S, U, P | Supports official pagination/cursor semantics, deterministic ordering, and typed endpoint errors. |
| T2.3 | Implement per-session history normalization | P0 | L | T1.4, T2.2 | Adapter | U, P, R | Fetches each session history and normalizes messages/fragments/metadata into `ConversationExport`; partial session failures are recorded, not hidden. |
| T2.4 | Implement attachment metadata manifest | P0 | M | T1.2, T1.3 | Attachment | S, P, R | Each `ref_file_id` is linked to source messages; available name/size/type metadata is stored; unavailable metadata is represented by explicit status. |
| T2.5 | Implement export orchestration and progress model | P0 | M | T2.3, T2.4 | Service | U, P, E | Export service composes listing/history/attachments and reports progress, cancellation, and typed failures without creating silent local archives. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| Adapter | T2.1, T2.2, T2.3 | XL | Medium | `core/deepseek/conversation-export.ts`, `core/export/normalize.ts` |
| Attachment | T2.4 | M | Low | `core/export/attachments.ts` |
| Service | T2.5 | M | Medium | `core/export/service.ts` |

## Phase 3: Artifacts And Runtime RPC

**Goal**: Generate downloadable artifacts from one schema and expose a thin runtime RPC.
**Prerequisite**: Phase 2 export service.
**S.U.P.E.R Focus**: S, U, P, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T3.1 | Build JSON artifact formatter | P0 | M | T2.5 | Format | S, P, R | JSON output is the validated canonical schema with source metadata, extension version, created timestamp, mode, and attachment manifest. |
| T3.2 | Build Markdown artifact formatter | P0 | M | T1.4, T2.5 | Format | S, P, R | Markdown output is readable, stable ordered, and includes session headings, messages, and attachment references/metadata. |
| T3.3 | Add print-ready HTML/PDF path | P1 | M | T3.2 | Format | S, P, E, R | HTML/PDF-ready output is generated from the same schema/rendering pipeline; direct PDF file generation is used only if low-risk and Unicode-safe. |
| T3.4 | Add typed background export RPC | P0 | M | T3.1, T3.2, T3.3 | RPC | U, P, R | Background adds a thin typed branch such as `EXPORT_DEEPSEEK_CONVERSATIONS`; endpoint parsing and formatting stay in `core/export/*`. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| Format | T3.1, T3.2, T3.3 | L | Low | `core/export/artifact-json.ts`, `core/export/artifact-markdown.ts`, `core/export/artifact-html.ts` |
| RPC | T3.4 | M | Medium | `entrypoints/background.ts`, `core/types.ts`, `core/export/service.ts` |

## Phase 4: User Surface, Files, And Policy

**Goal**: Provide the sidepanel export experience, keep downloads local, and handle file/policy boundaries.
**Prerequisite**: Runtime RPC and artifact builders.
**S.U.P.E.R Focus**: S, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T4.1 | Add sidepanel export UI | P0 | L | T3.4 | UI | S, U, P | UI supports all-history export, JSON/Markdown, raw/sanitized, attachment metadata, progress, cancellation, and visible errors. |
| T4.2 | Implement local download UX and auth handling | P0 | M | T4.1 | UI | E, R | Blob/anchor local downloads work without `downloads` permission; filenames are stable; login/token/permission failures are explicit. |
| T4.3 | Verify file-body export gate | P1 | M | T1.2, T2.4 | FileGate | P, E, R | Official file download/signature/CORS/size behavior is verified; if unsafe or unavailable, UI remains metadata-only with explicit status. |
| T4.4 | Update privacy, store, and manifest policy docs | P0 | M | T4.1, T4.3 | Policy | P, E | Privacy policy and Chrome Web Store submission docs disclose local conversation export and attachment limits; manifest policy check stays aligned. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| UI | T4.1, T4.2 | L | Medium | `entrypoints/sidepanel/pages/ExportPage.tsx`, `entrypoints/sidepanel/App.tsx` |
| FileGate | T4.3 | M | Low | `core/export/attachments.ts`, `wxt.config.ts` if permissions change |
| Policy | T4.4 | M | Medium | `docs/chrome-web-store/privacy-policy.md`, `docs/chrome-web-store/submission.md`, `scripts/manifest-policy-check.mjs` |

## Phase 5: Verification And Release Readiness

**Goal**: Verify behavior, permissions, cross-browser builds, and user-facing documentation.
**Prerequisite**: Export UI and policy updates.
**S.U.P.E.R Focus**: P, E, R.

| # | Task | Priority | Effort | Depends On | Lane | S.U.P.E.R | Acceptance Criteria |
|:--|:--|:--|:--|:--|:--|:--|:--|
| T5.1 | Add fixture and unit test coverage | P0 | L | T1.4, T2.5, T3.4, T4.1 | QA | P, R | Tests cover schema validation, normalization, raw/sanitized transforms, JSON/Markdown/HTML artifacts, RPC mock, and attachment metadata states. |
| T5.2 | Run build and manifest validation gates | P0 | M | T4.4, T5.1 | QA | E, R | `npm run compile`, `npm test`, `npm run verify:manifest-policy`, `npm run build:all` pass. |
| T5.3 | Final smoke and user-facing docs | P1 | S | T5.2 | QA | S, R | Manual smoke proves JSON + Markdown local download; README/release copy describes user-visible export capability without exposing internal API endpoints. |

### Parallel Lanes

| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:--|:--|:--|:--|:--|
| QA | T5.1, T5.2, T5.3 | XL | Low | `tests/*`, `README.md`, `README_EN.md`, `docs/releases/*` |

## Strategy Choice

The chosen strategy combines the two task-architect outputs:

- Use the contract-first approach to prevent endpoint and attachment uncertainty from leaking into UI or background code.
- Use the vertical-slice approach to keep the first user-visible release focused on all-history text export with attachment metadata.
- Defer file-body package export until endpoint and permission facts are verified.
- Treat PDF as a same-schema rendering enhancement, not a second content source.
