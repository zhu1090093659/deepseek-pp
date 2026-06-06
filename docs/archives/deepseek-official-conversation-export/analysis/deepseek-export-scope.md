# DeepSeek Conversation Export Scope

## Confirmed Release Scope

- Export all official DeepSeek web conversations available to the signed-in browser session.
- Default artifacts: JSON and Markdown.
- Optional artifact: print-ready HTML for browser PDF output.
- Modes:
  - `sanitized`: readable export that strips DeepSeek++ internal prompt markers, tool-call markup, raw endpoint payloads, and signed file URLs.
  - `raw`: canonical schema plus official raw payloads for user-owned archival/debug use.
- Attachments:
  - Export message file references and official file metadata when available.
  - Record unavailable metadata explicitly as `metadata_unavailable`.
  - Do not export file bodies until the official download path, signed URL lifetime, CORS behavior, and large-file handling are verified.

## Non-Goals For This Slice

- No DOM scraping as a source of truth.
- No new `downloads` permission; sidepanel saves artifacts with Blob URLs.
- No extension backend, cloud archive, or automatic remote sync of exported conversations.
- No direct PDF binary generation library in this slice.

## User-Facing Default

The sidepanel defaults to `sanitized`, JSON, Markdown, and attachment metadata. Raw mode and HTML/PDF-ready output are opt-in.
