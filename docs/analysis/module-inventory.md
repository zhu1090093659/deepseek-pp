# DeepSeek++ Module Inventory

## Scope and Rating

本清单基于 2026-07-13 PC-only refactor 主线，排除 `node_modules/`、`dist/`、`docs/archives/` 和生成资产。`core/skill/*-official/` 中约 1.1 MB 的 bundled Skill 文档作为资源记录，不计入 TypeScript LOC。Android 支持面已删除且不再属于兼容范围。

S.U.P.E.R 评分：🟢 符合；🟡 部分符合；🔴 明确违反或替换成本高。格式为 `S/U/P/E/R`：Single Purpose、Unidirectional Flow、Ports over Implementation、Environment-Agnostic、Replaceable Parts。

## Core Module Inventory

| Module | Responsibility / Public Surface | Main Dependencies and Boundary | Files / LOC | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| Core root (`types`, `constants`, `messaging`, `version`, `whats-new`) | 跨域 types/barrel、prompt constants、runtime messaging、版本更新状态 | 被大量领域依赖，同时反向 import prompt/tool/MCP/platform 等实现 | 5 / ~860 | High | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `artifact` | Artifact tool、ZIP、exact codec、单一 IndexedDB truth；`saveArtifact`, `getArtifact(s)`, `executeArtifactToolCall` | Dexie；Chrome storage 仅作一次性 legacy migration input；tool/i18n | 6 / 893 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `automation` | Schedule、execution context、runner、durable run lease、conservative retry/timeout；`runAutomation`, `runDeepSeekAutomation` | Scheduler 注入 executor；runner 依赖窄 `DeepSeekAutomationClient`/prompt/tool-loop；store 依赖 Chrome storage | 8 / 2,237 | High | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `background` | 背景图片配置 normalize/store | Chrome storage、root types | 2 / 43 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `browser` | WXT/browser 的 context-invalidated 安全代理 | `browser` / `chrome` globals | 1 / 68 | Low | S🟢 U🟢 P🟡 E🟢 R🟢 |
| `browser-control` | CDP connection、tab/snapshot/actions、tool provider；`BrowserControlService` | Chrome debugger/tabs、tool、platform、storage | 7 / 1,909 | High | S🔴 U🟡 P🟢 E🔴 R🟡 |
| `chat` | Chat enable、API key、official config、active-loop marker | Chrome local/session storage | 4 / 182 | Medium | S🟡 U🟢 P🟡 E🔴 R🔴 |
| `deepseek` | Pure route/request/SSE codecs、active Web client、PoW/upload/history、Official API、export transport | Codec 不依赖环境；active client 组合 injected fetch policy、Chrome storage/page localStorage 与 WASM；旧 adapter/parser 路径仅作兼容 re-export | 11 / 2,488 | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `export` | Conversation schema/normalize/attachments/sanitize/HTML/MD/PDF；`ConversationExportTransport`, `runConversationExport` | 明确 transport port；大部分为纯函数 | 11 / 1,600 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `floating-chat` | Floating chat enable store | Chrome storage；storage key 在 adapter 重复 | 1 / 16 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `i18n` | Typed locale keys、translator、resources、preference store | Chrome storage；双语资源和 audit 较完整 | 5 / 3,193 | Medium | S🟢 U🟢 P🟢 E🟡 R🟡 |
| `inline-agent` | Continuation loop、prompt、markdown、renderer、trace types | DeepSeek、interceptor、tool-loop、DOM UI | 5 / 1,236 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `interceptor` | Fetch/XHR/IDB hooks、SSE/tool parsing、history cleanup、token speed | prompt、memory、skill、inline-agent、tool；修改浏览器原型 | 9 / 3,203 | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `mcp` | MCP client/discovery/store 和 HTTP/SSE/bridge/native transports | JSON-RPC port 清晰；permission/header/store 与 Chrome 实现耦合 | 13 / 2,414 | High | S🟢 U🟡 P🟢 E🟡 R🟢 |
| `memory` | sole codec、Dexie migrations/repository、atomic import、scope、selector、injector/tool | Dexie、root types、prompt/i18n、shared persistence lock；local/sync/import/UI 复用同一 codec | 8 / 829 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `messaging/` | MAIN/content bridge envelope validation、单一 runtime command ownership/typed contracts、persistence/tool payload codecs、runtime broadcast helper | R4.1–R4.2 已把 86 个 receiver commands 纳入 typed registry；剩余 33 个 transitional commands 由 R4.3–R4.4 迁移，发送侧 best-effort 语义仍按原契约保留 | 13 / 2,766 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `model` | Model type preference store | Chrome storage | 1 / 20 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `multimodal` | Media policy、settings、MCP preset/contracts | MCP、tool、Chrome storage、外部 host package | 5 / 477 | Medium | S🟢 U🟡 P🟢 E🔴 R🟡 |
| `network` | Caller cancellation/deadline 组合、注入式 fetch、UTF-8 request/response budget、late-response cleanup；`createAbortScope`, `fetchWithNetworkPolicy` | 标准 Fetch/Streams/Abort API，不依赖领域模块或 `AbortSignal.any` | 2 / 314 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `pet` | Pet config、lines、store | i18n、Chrome storage | 3 / 134 | Low | S🟢 U🟢 P🟡 E🔴 R🟡 |
| `persistence` | Sync-owned local-state serialization/recovery precondition plus versioned repository/storage-slot contract | Promise FIFO and generic codec/repository depend only on narrow ports; the Chrome slot is the sole browser adapter for Project/Saved/Scenario | 2 / 111 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `platform` | 15-key capability matrix、optional Chrome API reader、Native/MCP gating | R3.9 已删除零消费者的 broad services facade；仍有 67 个 core/entrypoint TypeScript 文件直用 `chrome.*`，后续只随真实消费者引入窄 port | 4 / 160 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `preset` | Prompt preset CRUD | Chrome storage、root types、shared persistence lock | 1 / 74 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `project` | Project/conversation binding、lossless v1→v2 codec、pending context、journaled Project/Memory cascade | Versioned repository、Memory store、shared persistence/recovery lock；local/sync/UI 复用单一 codec | 5 / 649 | Medium | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `prompt` | Prompt augmentation、settings、visible marker | memory/tool/shell/i18n；settings 反向依赖 root constants | 4 / 427 | Medium | S🟢 U🟡 P🟢 E🟡 R🟡 |
| `sandbox` | Tool contract、Worker/Pyodide execution、types | tool/i18n；同一 request 在多层重复校验 | 5 / 493 | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |
| `saved-items` | Saved prompt/bookmark CRUD、legacy/versionless/v1 exact codec | Versioned repository、shared persistence lock；local/sync/UI 复用单一 codec | 4 / 241 | Low | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `scenario` | Context-menu scenario CRUD/template application、released bare-array codec | Versioned repository、shared persistence lock；跨 MV3 realm 集中化仍属 R4.4 | 2 / 144 | Low | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `shell` | Shell MCP names/spec/policy/preset contract | 纯数据/策略，serializable | 3 / 196 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `skill` | Built-ins、registry、GitHub/local import、creator tool、bundled resources | Chrome storage、fetch/GitHub、MCP、Shell、shared persistence lock；两个 importer 重复解析/policy | 8 / 3,169 + resources | Critical | S🔴 U🟡 P🟡 E🔴 R🔴 |
| `sync` | Config、snapshot、generation、schema、OAuth、WebDAV/GDrive/OneDrive backends、本地 staged apply/recovery | 远端 `StorageBackend` 与本地 state/journal ports 均有生产消费者；provider factory、generation pipeline、纯 apply coordinator、browser/Dexie adapters、retryable recovery barrier 分离 | 18 / 2,152 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
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
| `entrypoints/background.ts` + background handlers | MV3 bootstrap、单一 121-command registry、automation/sync/chat/export/tool/sandbox orchestration | R4.1–R4.2 已把 86 个 persistence/library/project/local-preference/MCP/browser/tool commands 拆为 typed handlers；R4.2 由 MCP、browser/web、tool-execution 三组 handler 与一个穷尽 payload codec 共同固定接收边界，根文件仍保留 33 个 transitional cases 和跨域 Chrome IO | 2,395 root LOC + extracted handler/codec/composition modules | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `entrypoints/content.ts` + content adapters | Bridge、DeepSeek DOM、tool/agent UI、export、多模态、theme、pet、history/project | 6,713 行根文件、全局状态、observer/timer、host selectors 与业务混合 | ~9,344 LOC | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `entrypoints/main-world.content.ts` | MAIN world hook/bridge composition | 入口集中，但运行于不可信 page realm，payload contract 浅 | 238 LOC | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `entrypoints/floating-chat.content.ts` | 全站 launcher 启动 | `<all_urls>` 生命周期、权限和默认值未形成状态机 | 22 LOC | Medium | S🟢 U🟢 P🟡 E🔴 R🟡 |
| `entrypoints/sidepanel/` | React UI、pages、settings state、runtime messaging | `McpPage` 1,776、`ChatPage` 951、settings hook 826；UI 内含领域 policy | ~11,254 TS + 1,816 CSS | Critical | S🔴 U🔴 P🔴 E🔴 R🔴 |
| Sandbox entrypoints | Offscreen relay、sandbox iframe/Worker execution | Request/result validation 在多层重复；Chromium offscreen 依赖 | ~358 LOC | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `packages/shell-host` | Installer、Native Messaging/MCP host、shell/session/python/file/skill/picker | `shell-mcp-host.mjs` 2,141 行，安全和 OS 分支集中 | 3 executable/library scripts / 2,762 LOC | Critical | S🔴 U🟡 P🟢 E🔴 R🔴 |
| `wxt.config.ts` | Manifest、ASCII JS、Pyodide asset plugin | Manifest 与 build plugins 混合；所有 target 无条件携带 Pyodide | 193 LOC | Medium | S🟡 U🟡 P🟢 E🟡 R🟡 |
| `scripts/` | CI/release/manifest/i18n/smoke | 文件职责大体单一；部分 contract 是字符串断言 | 16 / 3,118 | Medium | S🟢 U🟢 P🟡 E🟡 R🟢 |
| `tests/` | Vitest/jsdom 单元与契约测试 | 147 TS files / 127 test files；sync/cascade fault injection、database migration/convergence、automation cancellation/restart/lease fencing、runtime handler 与 PC capability contracts 已覆盖，但仍没有真实浏览器或 coverage gate | 147 / 29,047 | Medium | S🟢 U🟢 P🟡 E🟡 R🟡 |

## Dependency Graph Findings

静态 TypeScript import 图显示：

- `entrypoints/background.ts` 直接依赖 88 个内部文件，是最高 fan-out 文件。
- `entrypoints/content.ts` 直接依赖约 34 个内部文件。
- `core/types.ts` 被约 77 个文件直接 import，是最高 fan-in 中心。
- `core/tool/runtime.ts` 直接依赖 16 个内部文件，并以硬编码分支认识多个 provider。
- 基线文件图识别出两个强连通分量；当前状态如下：
  1. 14 文件 SCC：`core/types.ts`、`constants.ts`、prompt settings、tool catalog/providers、MCP types、memory、platform/browser-control 等。多数边是 type-only 或 barrel export，未必形成运行时初始化错误，但证明 contract 层反向依赖具体实现。
  2. T2.4 已删除 `sync/storage-backend.ts` 与 GDrive/OneDrive clients 的 3 文件 SCC；provider 只 type-import 零实现依赖的 port，composition factory 独立。
- 目录级还存在 `interceptor <-> inline-agent`、`mcp <-> multimodal`、root barrel 与多个领域之间的双向依赖。

## Duplicate Contracts and Multiple Truth Sources

1. **Runtime messages**
   - 单一 production registry 现拥有 `88 typed / 33 legacy / 2 client-only`；`background.ts` 仅余 33 个 transitional `case`。
   - `core/types.ts` 的 `MessageAction` 仍有 91 个 variant；R4.2 的 12 个 live-only receiver commands 通过窄 typed contract 接管而未扩张旧 union，剩余 20 个 live-only names 由 R4.3–R4.4 收敛。
   - R4.1–R4.2 的 58 个 payload-bearing commands 分别由两个穷尽 command-codec map 在 handler 接收边界解码；Memory、Skill、Preset 复用各自领域 codec，MCP、permission、sandbox 和 tool authorization 在特权 IO 前完成校验。剩余 transitional surface 有 12 个直接 `as` 强转和九个 delegated payload readers。

2. **Platform access**
   - R3.9 已删除 `PlatformServices`、其 browser implementation 和未被消费的 storage/runtime/download/file-picker ports，没有建立替代 facade。
   - 67 个 core/entrypoint TypeScript 文件仍直接访问 `chrome.*`；它们按 R4 的真实 capability consumer 分批迁移，禁止一次性引入无消费者 abstraction。

3. **Skill import**
   - GitHub/local importers 分别维护 parsed document、大小限制、命名冲突和资源 policy。
   - `MAX_SKILL_BYTES` 等边界在 browser/native paths 重复。

4. **Sandbox validation**
   - Tool schema、background、offscreen、runner 分别手写 request/result validation。

5. **MCP UI policy**
   - Origin permission、allowlist 和 transport form policy 分散在 core 与多个 Side Panel 页面。

6. **DeepSeek protocol**
   - R3.3/R3.4 已把主动与被动 route/request/SSE 收敛到纯 codec + 单一 network policy。被动 Fetch/XHR 只保留浏览器拦截、prompt 增强和可见流重写，不再维护 substring router、SSE framing/parser 或 token metrics facade。

7. **Persistence**
   - Floating chat key 在 store 和 adapter 重复。
   - R3.6 已让 Artifact 只以 IndexedDB 为运行时真相；legacy Chrome storage 仅作严格、可重试、可验证清理的一次性迁移输入。
   - Automation、usage、tool history 等以整 state/array 重写。
   - R3.5 已让 Project、Saved Items、Scenario 共用窄 storage slot/versioned repository；R3.6 又让 Memory local/sync/import/UI 共用唯一 codec，并让 Project/Memory cascade 复用现有全量 preimage journal。跨 MV3 realm Scenario mutation 仍由 R4.4 负责。

## Hotspot Details

### `entrypoints/background.ts`

- **Responsibility**：Extension composition root、runtime command registry、剩余跨域 application service 和 Chrome lifecycle。
- **Public API**：121 个 live runtime commands 的单一入口；88 个 typed handlers，33 个 transitional legacy cases。
- **Internal dependencies**：Memory、Skill、MCP、tool、sync、automation、DeepSeek、export、sandbox、browser control 等几乎全部领域。
- **Transformation note**：沿现有 registry 按 R4.3–R4.4 的既定 ownership 继续迁移；每组迁移后立即删除对应旧 case，禁止增加第二套路由或 validator。
- **S.U.P.E.R issue**：五项仍红；R4.1–R4.2 已移出 persistence/library/project/local-preference/MCP/browser/tool 业务流程，但根文件仍承载 33 个命令和多域 lifecycle/IO。

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

- **Responsibility**：声明 PC browser-extension / all-false unknown 环境 capability，读取可能不可用的 Chrome API，并提供 Native/MCP gating。
- **Current gap**：15-key matrix 仍有 manifest drift，Side Panel 加载前的 null sentinel 仍保留 released gating；owner 分别为 R4.7、R4.11 和 R4.9。
- **Transformation note**：R3.9 已删除零消费者的 broad facade。后续只允许在 storage/runtime/permission/identity/download 的真实生产 consumer 同一任务中引入窄 port。

### `core/sync`

- **Responsibility**：远端 backend、OAuth、schema validation 和快照同步。
- **Public API**：`StorageBackend`, `createStorageBackend`, generation publisher/reader, snapshot serializer, schema validators。
- **Transformation note**：T2.4 已拆开远端 port/factory 并增加 generation pointer commit；T2.5 已增加纯 local-apply coordinator、raw browser preimage adapter、独立恢复 journal 与 background recovery barrier；R3.5-R3.8 已统一 Project/Saved/Scenario、Memory/Artifact、sync config、Automation/Usage/Tool History 的 codec 与 mutation authority；R3.10 让 Skill/Sources 与 Preset/active-ID 复用同一 local codec 和现有 recovery journal。R6.5 / #379 只处理测量后的写放大。

### `core/skill`

- **Responsibility**：Skill registry、import、bundled resources 和 creator tool。
- **Transformation note**：R3.10 已增加唯一 Skill/Source codec 与 local-only sync policy、strict local/sync parity、duplicate-record fail-closed mutation，以及复用现有 full-preimage journal 的 staged paired mutations；本地 provider 继续不参与云同步。后续只提取共享 parser/resource policy/merge core、让 provider 只负责读取，并在 R6 建立 bundled-resource 预算。

### `core/preset` and History Organizer

- **Responsibility**：Preset/active-ID 持久化、History 标签 codec 与 content controller。
- **Transformation note**：R3.10 已保留 released bare-array/raw-string/versionless shapes，拒绝 future/corrupt/ambiguous mutation 而不覆盖；Preset 删除复用 sync recovery journal，active response 使用 domain-first decode，History 在 content realm 内用独立 FIFO 重读 confirmed state 且只在写成功后发布。History 的 cross-realm controller ownership 明确留给 R4.7 / #366。

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
