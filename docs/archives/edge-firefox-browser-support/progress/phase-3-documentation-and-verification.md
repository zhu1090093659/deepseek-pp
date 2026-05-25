## Phase 3: Documentation And Verification

- [x] T3.1 Update install and verification docs
  Acceptance: README and verification notes list Chrome, Edge, and Firefox loading paths.
- [x] T3.2 Validate builds and Firefox lint
  Acceptance: Type check, browser builds, MCP smoke checks, and Firefox lint pass or have only pre-existing content warnings.

### Notes

Verification passed. Firefox add-on lint now has zero errors and four `UNSAFE_VAR_ASSIGNMENT` warnings from bundled `innerHTML` usage; the earlier manifest/API warnings were removed.
