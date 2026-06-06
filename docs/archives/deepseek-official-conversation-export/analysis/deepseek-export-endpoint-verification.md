# DeepSeek Conversation Export Endpoint Verification

Date: 2026-06-06

## Evidence Captured

- A logged-in browser context reached `https://chat.deepseek.com/` and showed the signed-in DeepSeek home experience.
- The current DeepSeek frontend bundle exposed the conversation/session/file export endpoints used by this implementation.
- Static bundle inspection confirmed:
  - session pagination uses a chat-session page fetch with `count` and cursor fields.
  - per-session history is fetched by chat session id.
  - file metadata can be requested by comma-separated file ids.
  - official all-history export endpoints exist, but their server-side archive lifecycle is separate from this local export pipeline.
- Direct browser navigation to the JSON endpoint was blocked by the browser client, so no private live response fixture was saved.

## Fixture Policy

Tests use synthetic fixtures under `tests/fixtures/deepseek-export/`. They model the observed response envelope and field names without storing real user conversation content.

## File Body Gate

File-body export remains disabled. Before enabling it, verify:

- whether the official file endpoint returns stable downloadable bodies or short-lived signed URLs;
- whether extension-page fetch can legally and reliably read those bodies with current host permissions;
- maximum practical file size and cancellation behavior;
- whether exported packages need ZIP streaming rather than in-memory Blob generation.
