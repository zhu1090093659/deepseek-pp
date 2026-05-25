## Phase 1: Browser Target Packaging

- [x] T1.1 Add WXT browser targets and build scripts
  Acceptance: `build:chrome`, `build:edge`, `build:firefox`, and `build:all` generate expected output dirs.
- [x] T1.2 Make manifest browser-aware
  Acceptance: Chrome/Edge include side panel fields; Firefox omits Chromium-only side panel fields and includes Gecko metadata.

### Notes

Implemented in `package.json` and `wxt.config.ts`.
