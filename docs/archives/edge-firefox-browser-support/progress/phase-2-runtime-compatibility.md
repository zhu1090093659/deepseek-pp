## Phase 2: Runtime Compatibility

- [x] T2.1 Gate Chromium-only side panel API
  Acceptance: Firefox startup path does not require `chrome.sidePanel`.
- [x] T2.2 Remove Chrome-only native messaging wording
  Acceptance: user-visible text and runtime error use browser-neutral Native Messaging wording.

### Notes

Implemented in `entrypoints/background.ts`, `core/mcp/transports/native.ts`, and `entrypoints/sidepanel/pages/McpPage.tsx`.
