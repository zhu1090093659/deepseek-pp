## Risk Assessment

Task: add Edge and Firefox support.

### Compatibility Risks

| Risk | Impact | Likelihood | Mitigation |
|:--|:--|:--|:--|
| Firefox package includes Chromium-only `sidePanel` permission or `side_panel` manifest key | AMO lint warning or runtime incompatibility | High | Generate manifest from `ConfigEnv` and omit Chromium side panel fields for Firefox |
| Background references `chrome.sidePanel` in Firefox bundle | Firefox linter unsupported API warning and possible startup failure | High | Gate side panel behavior behind `import.meta.env.FIREFOX` and optional API lookup |
| Firefox MV2 default build diverges from current MV3 architecture | Wrong background semantics and confusing install docs | High | Add `build:firefox` script that always passes `--mv3` |
| Firefox MV3 package lacks Gecko add-on ID | `addons-linter` error | High | Add stable `browser_specific_settings.gecko.id` |
| Firefox data collection declaration missing | AMO warning for new add-ons | High | Declare required data collection categories for website/chat content handled by the extension |
| Documentation remains Chrome-only | Users load the wrong output directory | Medium | Update README and verification notes with Chrome/Edge/Firefox paths |
| Native messaging host manifests differ per browser | MCP native transport fails on Edge/Firefox | Medium | Make UI/docs wording browser-neutral and call out browser-specific host manifest installation |

### S.U.P.E.R Architecture Health

| Principle | Status | Notes |
|:--|:--|:--|
| Single Purpose | Yellow | `background.ts` remains broad, but browser compatibility is a small boundary concern and does not need a new subsystem. |
| Unidirectional Flow | Green | WXT build env determines manifest/runtime behavior; core modules do not depend on browser target. |
| Ports over Implementation | Yellow | Message contracts are typed but not runtime validated; unchanged by this task. |
| Environment-Agnostic | Yellow -> Green for this task | Removing Chrome-only manifest/runtime assumptions improves target-browser portability. |
| Replaceable Parts | Green | Browser-specific differences are contained in WXT config and one background capability gate. |

### Validation Baseline

Before changes, `npm run build -- --browser edge` and `npm run build -- --browser firefox --mv3` produced output directories, but Firefox lint reported:

- invalid `sidePanel` permission
- missing `browser_specific_settings.gecko.id`
- missing `data_collection_permissions`
- unsupported `sidePanel.setPanelBehavior`

Those findings define the acceptance criteria for this compatibility pass.
