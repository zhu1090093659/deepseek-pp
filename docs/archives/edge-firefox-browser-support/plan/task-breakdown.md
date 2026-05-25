## Task Breakdown

Task definition: add Edge and Firefox support for DeepSeek++ while keeping one shared extension codebase.

Tracking mode: LOCAL_ONLY for this narrow implementation pass. GitHub pre-flight found `GITHUB_STANDARD` available, but no remote Issues were created.

### Phase 1: Browser Target Packaging

| Task | Priority | Effort | Dependencies | S.U.P.E.R drivers | Acceptance criteria |
|:--|:--|:--|:--|:--|:--|
| T1.1 Add WXT browser targets and build scripts | P0 | S | None | E, R | `build:chrome`, `build:edge`, `build:firefox`, and `build:all` generate the expected output dirs. |
| T1.2 Make manifest browser-aware | P0 | M | T1.1 | P, E, R | Chrome/Edge include `sidePanel` and `side_panel`; Firefox omits them and includes Gecko ID plus data permissions. |

### Phase 2: Runtime Compatibility

| Task | Priority | Effort | Dependencies | S.U.P.E.R drivers | Acceptance criteria |
|:--|:--|:--|:--|:--|:--|
| T2.1 Gate Chromium-only side panel API | P0 | S | T1.2 | E, R | Firefox bundle does not fail startup because `chrome.sidePanel` is absent. |
| T2.2 Remove Chrome-only native messaging wording | P1 | S | None | S, E | UI/runtime errors refer to browser Native Messaging instead of Chrome-only hosts. |

### Phase 3: Documentation And Verification

| Task | Priority | Effort | Dependencies | S.U.P.E.R drivers | Acceptance criteria |
|:--|:--|:--|:--|:--|:--|
| T3.1 Update install and verification docs | P0 | S | T1.1 | P, E | README and verification notes list Chrome, Edge, and Firefox loading paths. |
| T3.2 Validate builds and Firefox lint | P0 | M | T1, T2 | E, R | Type check, all browser builds, MCP smoke tests, and Firefox lint pass or have only pre-existing content warnings. |

### Parallel Lanes

- Lane A: T1.1 and T1.2 in `package.json` / `wxt.config.ts`.
- Lane B: T2.1 and T2.2 in runtime/UI text.
- Lane C: T3.1 docs after Lane A defines commands and paths.

Merge risk is low because write sets are mostly disjoint.
