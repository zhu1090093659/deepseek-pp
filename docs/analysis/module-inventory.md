# DeepSeek++ Module Inventory

## Scope and Rating

本清单基于 2026-07-13 Issue #321 工作树，排除 `node_modules/`、`dist/`、`docs/archives/` 和生成资产。`core/skill/*-official/` 中约 1.1 MB 的 bundled Skill 文档作为资源记录，不计入 TypeScript LOC。Android 支持面已删除。

S.U.P.E.R 评分：🟢 符合；🟡 部分符合；🔴 明确违反或替换成本高。格式为 `S/U/P/E/R`：Single Purpose、Unidirectional Flow、Ports over Implementation、Environment-Agnostic、Replaceable Parts。

## Core Module Inventory

| Module | Responsibility / Public Surface | Main Dependencies and Boundary | Files / LOC | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| Core root (`types`, `constants`, `messaging`, `version`, `whats-new`) | 跨域 types/barrel、prompt constants、runtime messaging、版本更新状态 | 被大量领域依赖，同时反向 import prompt/tool/MCP/platform 等实现 | 5 / ~860 | High | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `artifact` | Artifact tool、ZIP、IndexedDB/storage persistence；`saveArtifact`, `getArtifact(s)`, `executeArtifactToolCall` | Dexie、Chrome storage、tool/i18n | 5 / 734 | Medium | S🟢 U🟡 P🟢 E🟡 R🟡 |
| `automation` | Schedule、execution context、runner、durable run lease、conservative retry/timeout；`runAutomation`, `runDeepSeekAutomation` | Scheduler 注入 executor；runner 依赖 DeepSeek adapter/prompt/tool-loop；store 依赖 Chrome storage | 8 / 2,290 | High | S🟢 U🟢 P🟢 E🔴 R🟡 |
| `background` | 背景图片配置 normalize/store | Chrome storage、root types | 2 / 43 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `browser` | WXT/browser 的 context-invalidated 安全代理 | `browser` / `chrome` globals | 1 / 68 | Low | S🟢 U🟢 P🟡 E🟢 R🟢 |
| `browser-control` | CDP connection、tab/snapshot/actions、tool provider；`BrowserControlService` | Chrome debugger/tabs、tool、platform、storage | 7 / 1,909 | High | S🔴 U🟡 P🟢 E🔴 R🟡 |
| `chat` | Chat enable、API key、official config、active-loop marker | Chrome local/session storage | 4 / 182 | Medium | S🟡 U🟢 P🟡 E🔴 R🔴 |
| `deepseek` | Web API adapter、PoW、upload、history、SSE、official API、export transport | fetch、Chrome storage、page localStorage、WASM、interceptor contracts | 6 / 1,663 | High | S🔴 U🟡 P🟡 E🔴 R🔴 |
| `export` | Conversation schema/normalize/attachments/sanitize/HTML/MD/PDF；`ConversationExportTransport`, `runConversationExport` | 明确 transport port；大部分为纯函数 | 11 / 1,600 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `floating-chat` | Floating chat enable store | Chrome storage；storage key 在 adapter 重复 | 1 / 16 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `i18n` | Typed locale keys、translator、resources、preference store | Chrome storage；双语资源和 audit 较完整 | 5 / 3,193 | Medium | S🟢 U🟢 P🟢 E🟡 R🟡 |
| `inline-agent` | Continuation loop、prompt、markdown、renderer、trace types | DeepSeek、interceptor、tool-loop、DOM UI | 5 / 1,236 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `interceptor` | Fetch/XHR/IDB hooks、SSE/tool parsing、history cleanup、token speed | prompt、memory、skill、inline-agent、tool；修改浏览器原型 | 9 / 3,203 | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `mcp` | MCP client/discovery/store 和 HTTP/SSE/bridge/native transports | JSON-RPC port 清晰；permission/header/store 与 Chrome 实现耦合 | 13 / 2,414 | High | S🟢 U🟡 P🟢 E🟡 R🟢 |
| `memory` | Dexie store/migrations、scope、selector、injector、importer/tool | Dexie、root types、prompt/i18n、shared persistence lock | 7 / 637 | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |
| `messaging/` | MAIN/content bridge envelope validation、runtime broadcast helper | payload 校验浅；发送失败多为 best-effort | 2 / 113 | Medium | S🟢 U🟡 P🟡 E🟢 R🟡 |
| `model` | Model type preference store | Chrome storage | 1 / 20 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `multimodal` | Media policy、settings、MCP preset/contracts | MCP、tool、Chrome storage、外部 host package | 5 / 477 | Medium | S🟢 U🟡 P🟢 E🔴 R🟡 |
| `network` | Caller cancellation 与 deadline 的兼容组合；`createAbortScope` | 标准 `AbortController`/`AbortSignal`，不依赖 `AbortSignal.any` | 1 / 40 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `pet` | Pet config、lines、store | i18n、Chrome storage | 3 / 134 | Low | S🟢 U🟢 P🟡 E🔴 R🟡 |
| `persistence` | Sync-owned local-state mutation serialization and fail-closed recovery precondition | Pure Promise FIFO; stores and sync runtime share the same lock without domain imports | 1 / 37 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `platform` | Capability matrix、`PlatformServices`、browser implementation | 抽象存在但生产接入很少；仍有 71 个 core/entrypoint TypeScript 文件直用 `chrome.*` | 5 / 298 | High-risk | S🟢 U🟡 P🔴 E🟡 R🔴 |
| `preset` | Prompt preset CRUD | Chrome storage、root types、shared persistence lock | 1 / 74 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `project` | Project/conversation binding、pending context、schema v2、project/Memory cascade | Chrome storage、Memory store、shared persistence lock；normalize/schema 较清晰 | 4 / 430 | Medium | S🟢 U🟢 P🟢 E🔴 R🟡 |
| `prompt` | Prompt augmentation、settings、visible marker | memory/tool/shell/i18n；settings 反向依赖 root constants | 4 / 427 | Medium | S🟢 U🟡 P🟢 E🟡 R🟡 |
| `sandbox` | Tool contract、Worker/Pyodide execution、types | tool/i18n；同一 request 在多层重复校验 | 5 / 493 | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |
| `saved-items` | Saved prompt/bookmark CRUD、schema v1 | Chrome storage、shared persistence lock；legacy array normalize | 3 / 180 | Low | S🟢 U🟢 P🟢 E🔴 R🟡 |
| `scenario` | Context-menu scenario CRUD/template application | Chrome storage；旧式 key、无 version、读取异常回退 | 1 / 73 | Low | S🟢 U🟢 P🔴 E🔴 R🔴 |
| `shell` | Shell MCP names/spec/policy/preset contract | 纯数据/策略，serializable | 3 / 196 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `skill` | Built-ins、registry、GitHub/local import、creator tool、bundled resources | Chrome storage、fetch/GitHub、MCP、Shell、shared persistence lock；两个 importer 重复解析/policy | 8 / 3,169 + resources | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| `sync` | Config、snapshot、generation、schema、OAuth、WebDAV/GDrive/OneDrive backends、本地 staged apply/recovery | 远端 `StorageBackend` 与本地 state/journal ports 均有生产消费者；provider factory、generation pipeline、纯 apply coordinator、browser/Dexie adapters、retryable recovery barrier 分离 | 18 / 2,223 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `theme` | DeepSeek theme store | Chrome storage | 1 / 16 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `token` | Token 粗略估算 | 纯函数 | 1 / 13 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `tool` | Tool types/catalog/runtime/restore/history、内置 providers | 依赖 artifact/browser-control/MCP/memory/project/skill；硬编码 dispatch | 18 / 3,553 | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `tool-loop` | Generic continuation loop；`runToolContinuationLoop` | Callback ports、serializable records | 1 / 88 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `ui` | Injected UI、skill popup、tool result renderer registry | DOM、artifact/i18n；renderer registry 可替换 | 5 / 1,389 | High | S🟡 U🟢 P🟢 E🔴 R🟢 |
| `usage` | Usage normalize、aggregate、store | Stats 纯；store 全数组重写 Chrome storage | 3 / 495 | Medium | S🟢 U🟢 P🟢 E🔴 R🟡 |
| `voice` | Voice settings/capability detection | Web Speech、Chrome storage | 1 / 58 | Low | S🟢 U🟢 P🟢 E🟡 R🟡 |

`core/developer/` 当前为空，不构成模块。`packages/multimodal-mcp/` 也是本地空目录；实际多模态 MCP 通过外部 npm package 安装。

## Entrypoint, Native, and Build Modules

| Module | Responsibility / Public Surface | Main Issue | Size | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| `entrypoints/background.ts` | MV3 bootstrap、119 个 runtime commands、automation/sync/chat/export/tool/sandbox orchestration | Router、payload cast、domain orchestration 和 Chrome IO 集中；sync apply 与 automation execution authority 已移出，仅保留 lifecycle barrier/composition | 2,831 LOC | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `entrypoints/content.ts` + content adapters | Bridge、DeepSeek DOM、tool/agent UI、export、多模态、theme、pet、history/project | 6,713 行根文件、全局状态、observer/timer、host selectors 与业务混合 | ~9,344 LOC | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `entrypoints/main-world.content.ts` | MAIN world hook/bridge composition | 入口集中，但运行于不可信 page realm，payload contract 浅 | 238 LOC | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `entrypoints/floating-chat.content.ts` | 全站 launcher 启动 | `<all_urls>` 生命周期、权限和默认值未形成状态机 | 22 LOC | Medium | S🟢 U🟢 P🟡 E🔴 R🟡 |
| `entrypoints/sidepanel/` | React UI、pages、settings state、runtime messaging | `McpPage` 1,776、`ChatPage` 951、settings hook 826；UI 内含领域 policy | ~11,254 TS + 1,816 CSS | Critical | S🔴 U🔴 P🔴 E🔴 R🔴 |
| Sandbox entrypoints | Offscreen relay、sandbox iframe/Worker execution | Request/result validation 在多层重复；Chromium offscreen 依赖 | ~358 LOC | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `packages/shell-host` | Installer、Native Messaging/MCP host、shell/session/python/file/skill/picker | `shell-mcp-host.mjs` 2,141 行，安全和 OS 分支集中 | ~2,774 LOC | Critical | S🔴 U🟡 P🟢 E🔴 R🔴 |
| `wxt.config.ts` | Manifest、ASCII JS、Pyodide asset plugin | Manifest 与 build plugins 混合；所有 target 无条件携带 Pyodide | 193 LOC | Medium | S🟡 U🟡 P🟢 E🟡 R🟡 |
| `scripts/` | CI/release/manifest/i18n/smoke | 文件职责大体单一；部分 contract 是字符串断言 | 16 / 3,109 | Medium | S🟢 U🟢 P🟡 E🟡 R🟢 |
| `tests/` | Vitest/jsdom 单元与契约测试 | 111 TS files / 97 test files；sync fault injection 与 automation cancellation/restart/lease fencing 已覆盖，但仍没有真实浏览器、完整 domain migration 或 coverage gate | 111 / 19,391 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |

## Dependency Graph Findings

静态 TypeScript import 图显示：

- `entrypoints/background.ts` 直接依赖约 65 个内部文件，是最高 fan-out 文件。
- `entrypoints/content.ts` 直接依赖约 34 个内部文件。
- `core/types.ts` 被约 77 个文件直接 import，是最高 fan-in 中心。
- `core/tool/runtime.ts` 直接依赖 16 个内部文件，并以硬编码分支认识多个 provider。
- 基线文件图识别出两个强连通分量；当前状态如下：
  1. 14 文件 SCC：`core/types.ts`、`constants.ts`、prompt settings、tool catalog/providers、MCP types、memory、platform/browser-control 等。多数边是 type-only 或 barrel export，未必形成运行时初始化错误，但证明 contract 层反向依赖具体实现。
  2. T2.4 已删除 `sync/storage-backend.ts` 与 GDrive/OneDrive clients 的 3 文件 SCC；provider 只 type-import 零实现依赖的 port，composition factory 独立。
- 目录级还存在 `interceptor <-> inline-agent`、`mcp <-> multimodal`、root barrel 与多个领域之间的双向依赖。

## Duplicate Contracts and Multiple Truth Sources

1. **Runtime messages**
   - `background.ts` 有 119 个 `case`。
   - `core/types.ts` 的 `MessageAction` 约 89 个 variant。
   - Background handler 接受宽松 `{ type: string; payload?: unknown }` 并大量 `as` 强转。

2. **Platform abstraction**
   - `PlatformServices` 已存在，但生产代码几乎没有使用 `createBrowserExtensionPlatformServices()`。
   - 71 个 core/entrypoint TypeScript 文件直接访问 `chrome.*`，其中多数位于 core（统计同时包含 `.ts` 与 `.tsx`）。

3. **Skill import**
   - GitHub/local importers 分别维护 parsed document、大小限制、命名冲突和资源 policy。
   - `MAX_SKILL_BYTES` 等边界在 browser/native paths 重复。

4. **Sandbox validation**
   - Tool schema、background、offscreen、runner 分别手写 request/result validation。

5. **MCP UI policy**
   - Origin permission、allowlist 和 transport form policy 分散在 core 与多个 Side Panel 页面。

6. **DeepSeek protocol**
   - 被动 page hook 与主动 DeepSeek client 共享部分 parser，但仍分别维护 header/context/end/error 规则。

7. **Persistence**
   - Floating chat key 在 store 和 adapter 重复。
   - Artifact 同时使用 IndexedDB 和 legacy Chrome storage；migration failure 被 catch 后不会自动重试。
   - Automation、usage、tool history 等以整 state/array 重写。

## Hotspot Details

### `entrypoints/background.ts`

- **Responsibility**：Extension composition root、runtime command router、跨域 application service 和 Chrome lifecycle。
- **Public API**：119 类 runtime message 的事实入口。
- **Internal dependencies**：Memory、Skill、MCP、tool、sync、automation、DeepSeek、export、sandbox、browser control 等几乎全部领域。
- **Transformation note**：先建立单一 message schema/handler registry，再按 domain 拆 handler；不能在旧 switch 旁增加第二套路由。
- **S.U.P.E.R issue**：五项均红；它既是 composition root，又直接承载业务流程和 validation。

### `entrypoints/content.ts`

- **Responsibility**：DeepSeek 页面隔离世界内的所有长期运行能力。
- **Public API**：MAIN bridge handler、runtime listener、DOM controllers、tool/agent render/restore。
- **Internal dependencies**：34 个直接 imports，横跨 16 个 core 领域。
- **Transformation note**：按 capability controller 拆分，每个 controller 必须拥有 `start/stop` 生命周期、最小 DOM root 和显式 state；先做 characterization tests。
- **S.U.P.E.R issue**：多职责、全局 mutable state、DOM/platform 直接依赖和高替换半径。

### `core/interceptor/fetch-hook.ts`

- **Responsibility**：网络拦截、stream 过滤、history/IDB cleanup、tool events、token speed。
- **Public API**：`installFetchHook`, `updateHookState` 与 response payload types。
- **Transformation note**：把 DeepSeek request/stream contract 与 page patch adapter 分开；保留 byte-for-byte prompt 和 stream semantics。

### `core/tool` + root barrels

- **Responsibility**：Tool contracts、catalog、providers、dispatch 和 persistence。
- **Public API**：`ToolDescriptor`, `ToolCall`, `executeRuntimeToolCall`, catalog helpers。
- **Transformation note**：把 contract 文件变为零实现依赖；用 provider registry/composition root 替代硬编码领域识别；逐步拆除 `core/types.ts` 中心 barrel。

### `core/platform`

- **Responsibility**：声明环境 capability 和 platform services。
- **Current gap**：Port 已声明但未成为依赖规则，业务仍直连 `chrome.*`。
- **Transformation note**：按 storage/runtime/permission/identity/download 等窄 port 渐进接入，禁止一次性大爆炸替换。

### `core/sync`

- **Responsibility**：远端 backend、OAuth、schema validation 和快照同步。
- **Public API**：`StorageBackend`, `createStorageBackend`, generation publisher/reader, snapshot serializer, schema validators。
- **Transformation note**：T2.4 已拆开远端 port/factory 并增加 generation pointer commit；T2.5 已增加纯 local-apply coordinator、raw browser preimage adapter、独立恢复 journal 与 background recovery barrier。T3.3 继续统一 domain codec/repository，T6.3 处理一般并发覆盖与写放大。

### `core/skill`

- **Responsibility**：Skill registry、import、bundled resources 和 creator tool。
- **Transformation note**：提取共享 parser/resource policy/merge core；provider 只负责读取；bundled resources 改按需加载并设 bundle budget。

### `packages/shell-host`

- **Responsibility**：Native protocol、Shell/Python/session/file/Skill/picker/OS path/logging。
- **Transformation note**：先冻结 Native Messaging/MCP schema 和 installer compatibility fixtures，再按 tool/provider 拆模块。

## Healthy Reference Modules

- `core/export`：transport port、schema、normalizer、renderer 分层完整。
- `core/tool-loop`：纯 engine，通过 callback 注入外部行为。
- `core/shell`：协议与 policy 独立于 native host 实现。
- `core/token`、`automation/schedule.ts`：纯函数、低替换成本。
- `core/mcp/transports`：JSON-RPC/transport contract 相对清晰。

这些模块应作为重构风格参考：contract 独立、依赖单向、外部 IO 通过窄 port 注入。
