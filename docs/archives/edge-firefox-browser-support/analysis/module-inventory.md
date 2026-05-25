## Module Inventory

Task: add Edge and Firefox support.

### Inventory

| Module | Responsibility | Browser support relevance | Size | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| WXT config | Manifest generation, target browser configuration, output dirs | Primary source for Chrome/Edge/Firefox package differences | 1 file | Low | S green, U green, P yellow, E yellow, R yellow |
| Background entrypoint | Runtime message router, alarms, tab orchestration, sidepanel behavior | Contains Chromium-only `sidePanel` call that must be gated | 648 lines | Medium | S yellow, U green, P yellow, E yellow, R yellow |
| Content scripts | DeepSeek DOM bridge and main-world interception | Mostly browser-neutral WebExtension APIs plus DeepSeek DOM assumptions | 2 files, 1475 lines | High | S yellow, U yellow, P yellow, E yellow, R yellow |
| Sidepanel UI | React settings for memory, skills, automation, MCP | Runs as Chrome/Edge side panel or Firefox sidebar | 14 files, 3000+ lines | High | S yellow, U green, P yellow, E yellow, R yellow |
| MCP transports | HTTP/SSE/bridge/native messaging adapters | Host permission and native messaging wording must be browser-neutral | 6 files | Medium | S green, U green, P green, E yellow, R green |
| Tool runtime | Provider-neutral tool descriptors, execution, history | Browser-neutral except storage boundary | 6 files | Medium | S green, U green, P green, E yellow, R green |
| Stores | Memory, skill, preset, automation, MCP, background config | Use WebExtension storage APIs | 8 files | Medium | S green, U green, P yellow, E yellow, R green |
| Documentation | README and verification notes | Must describe browser-specific build/load paths and limits | 3 files | Low | S green, U green, P green, E green, R green |

### S.U.P.E.R Notes

- Single Purpose: browser support changes belong at the manifest/runtime boundary, not in MCP or DeepSeek domain logic.
- Unidirectional Flow: keep browser target detection flowing from WXT build env into manifest/runtime gates.
- Ports over Implementation: use one manifest factory as the browser compatibility contract instead of duplicating config files.
- Environment-Agnostic: avoid Chrome-only wording and API calls in shared docs/runtime paths.
- Replaceable Parts: Edge should reuse the Chromium package shape; Firefox should differ only where the platform requires sidebar and Gecko metadata.
