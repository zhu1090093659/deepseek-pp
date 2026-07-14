# DeepSeek++ Module Inventory

## Scope and Rating

本清单基于 2026-07-13 PC-only refactor 主线，排除 `node_modules/`、`dist/`、`docs/archives/` 和生成资产。`core/skill/*-official/` 中约 1.1 MB 的 bundled Skill 文档作为资源记录，不计入 TypeScript LOC。Android 支持面已删除且不再属于兼容范围。

S.U.P.E.R 评分：🟢 符合；🟡 部分符合；🔴 明确违反或替换成本高。格式为 `S/U/P/E/R`：Single Purpose、Unidirectional Flow、Ports over Implementation、Environment-Agnostic、Replaceable Parts。

## Core Module Inventory

| Module | Responsibility / Public Surface | Main Dependencies and Boundary | Files / LOC | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| Core root (`types`, `constants`, `messaging`, `version`, `whats-new`) | 跨域 types/barrel、prompt constants、runtime messaging、版本更新状态 | 被大量领域依赖，同时反向 import prompt/tool/MCP/platform 等实现 | 5 / ~860 | High | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `artifact` | Artifact tool、ZIP、exact codec、单一 IndexedDB truth；`saveArtifact`, `getArtifact(s)`, `executeArtifactToolCall` | Dexie；Chrome storage 仅作一次性 legacy migration input；tool/i18n | 6 / 893 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `automation` | Schedule、execution context、runner、durable run lease、conservative retry/timeout、runtime request codec；`runAutomation`, `runDeepSeekAutomation` | Scheduler 注入 executor；runner 依赖窄 `DeepSeekAutomationClient`/prompt/tool-loop；store 依赖 Chrome storage | 10 / 2,819 | High | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `background` | 背景图片配置 normalize/store | Chrome storage、root types | 2 / 43 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `browser` | WXT/browser 的 context-invalidated 安全代理 | `browser` / `chrome` globals | 1 / 68 | Low | S🟢 U🟢 P🟡 E🟢 R🟢 |
| `browser-control` | CDP connection、tab/snapshot/actions、tool provider；`BrowserControlService` | Chrome debugger/tabs、tool、platform、storage；Side Panel response codec 复用 core boundary | 8 / 2,023 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `chat` | Chat enable、API key、official config contract、active-loop marker、pending-text mailbox | Chrome local/session storage；pending text 使用单一 typed slot/controller | 6 / 260 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `deepseek` | Pure route/request/SSE codecs、active Web client、PoW/upload/history、Official API、export transport | Codec 不依赖环境；active client 组合 injected fetch policy、Chrome storage/page localStorage 与 WASM；旧 adapter/parser 路径仅作兼容 re-export | 11 / 2,488 | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `export` | Conversation schema/normalize/attachments/sanitize/HTML/MD/PDF；`ConversationExportTransport`, `runConversationExport` | 明确 transport port；大部分为纯函数 | 11 / 1,600 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `floating-chat` | Floating chat enable store and runtime state machine | Chrome storage + browser permission/runtime state；`disabled / missing-permission / ready / invalidated` 由单一纯状态模型投影 | 2 / 46 | Low | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `i18n` | Typed locale keys、translator、resources、preference store | Chrome storage；双语资源和 audit 较完整 | 5 / 3,193 | Medium | S🟢 U🟢 P🟢 E🟡 R🟡 |
| `inline-agent` | Continuation loop、prompt、markdown、renderer、trace codec/store/types | DeepSeek、interceptor、tool-loop、DOM UI；trace storage 通过单一 codec/repository | 8 / 1,423 | High | S🟡 U🟡 P🟢 E🔴 R🟡 |
| `interceptor` | Fetch/XHR/IDB hooks、SSE/tool parsing、history cleanup、token speed | prompt、memory、skill、inline-agent、tool；修改浏览器原型 | 9 / 3,203 | Critical | S🔴 U🔴 P🟡 E🔴 R🔴 |
| `mcp` | MCP client/discovery/store 和 HTTP/SSE/bridge/native transports | JSON-RPC port 清晰；permission/header/store 与 Chrome 实现耦合 | 13 / 2,414 | High | S🟢 U🟡 P🟢 E🟡 R🟢 |
| `memory` | sole codec、Dexie migrations/repository、atomic import、scope、selector、injector/tool | Dexie、root types、prompt/i18n、shared persistence lock；local/sync/import/UI 复用同一 codec | 8 / 829 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `messaging/` | MAIN/content bridge envelope validation、单一 runtime command ownership/typed contracts、全量 payload codecs、runtime broadcast helper | R4.1–R4.4 已把全部 121 个 receiver commands 纳入 typed registry；80 个 payload-bearing commands 均在接收边界解码；bridge disconnect 是唯一 additive lifecycle handshake，runtime failure/error projection 只有一个 core authority | 17 / 3,433 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `model` | Model type preference store | Chrome storage | 1 / 20 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `multimodal` | Media policy、settings、MCP preset/contracts | MCP、tool、Chrome storage、外部 host package | 5 / 477 | Medium | S🟢 U🟡 P🟢 E🔴 R🟡 |
| `network` | Caller cancellation/deadline 组合、注入式 fetch、UTF-8 request/response budget、late-response cleanup；`createAbortScope`, `fetchWithNetworkPolicy` | 标准 Fetch/Streams/Abort API，不依赖领域模块或 `AbortSignal.any` | 2 / 314 | Medium | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `pet` | Pet config、lines、store | i18n、Chrome storage | 3 / 134 | Low | S🟢 U🟢 P🟡 E🔴 R🟡 |
| `persistence` | Sync-owned serialization/recovery、versioned repository/storage slot、coalescing mutation queue | FIFO/repository/coalescer depend on narrow ports；Chrome slot remains the browser adapter and only eligible stores consume the coalescer | 5 / 199 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `platform` | 15-key capability matrix、optional Chrome API reader、Native/MCP gating | R3.9 已删除零消费者的 broad services facade；仍有 67 个 core/entrypoint TypeScript 文件直用 `chrome.*`，后续只随真实消费者引入窄 port | 4 / 160 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `preset` | Prompt preset CRUD | Chrome storage、root types、shared persistence lock | 1 / 74 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `project` | Project/conversation binding、lossless v1→v2 codec、pending context、journaled Project/Memory cascade | Versioned repository、Memory store、shared persistence/recovery lock；local/sync/UI 复用单一 codec | 5 / 649 | Medium | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `prompt` | Prompt augmentation、settings、visible marker | memory/tool/shell/i18n；settings 反向依赖 root constants | 4 / 427 | Medium | S🟢 U🟡 P🟢 E🟡 R🟡 |
| `sandbox` | Tool contract、Worker/Pyodide execution、types | tool/i18n；同一 request 在多层重复校验 | 5 / 493 | Medium | S🟢 U🟡 P🟡 E🟡 R🟡 |
| `saved-items` | Saved prompt/bookmark CRUD、legacy/versionless/v1 exact codec | Versioned repository、shared persistence lock；local/sync/UI 复用单一 codec | 4 / 241 | Low | S🟢 U🟢 P🟢 E🔴 R🟢 |
| `scenario` | Context-menu scenario CRUD/template application、released bare-array codec | Versioned repository、shared persistence lock；Background 是跨 MV3 realm mutation authority，旧 payload-less refresh 仍兼容 | 3 / 212 | Low | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `shell` | Shell MCP names/spec/policy/preset contract | 纯数据/策略，serializable | 3 / 196 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `skill` | Built-ins、registry、GitHub/local import、creator tool、lazy bundled resources | Chrome storage、fetch/GitHub、MCP、Shell、shared persistence lock；bundled manifest/loader 只按需读取目标资源 | 12 / 3,897 + resources | High | S🟡 U🟡 P🟢 E🟡 R🟢 |
| `sync` | Config、snapshot、generation、schema、OAuth、WebDAV/GDrive/OneDrive backends、本地 staged apply/recovery | 远端 `StorageBackend` 与本地 state/journal ports 均有生产消费者；provider factory、generation pipeline、纯 apply coordinator、browser/Dexie adapters、retryable recovery barrier 分离 | 18 / 2,152 | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `theme` | DeepSeek theme store | Chrome storage | 1 / 16 | Low | S🟢 U🟢 P🟡 E🔴 R🔴 |
| `token` | Token 粗略估算 | 纯函数 | 1 / 13 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `tool` | Tool types/catalog/runtime/restore/history、execution-block codec/store、内置 providers | 依赖 artifact/browser-control/MCP/memory/project/skill；provider dispatch 仍集中，UI restore storage 已收敛到单一 codec/repository | 24 / 3,841 | Critical | S🔴 U🟡 P🟡 E🔴 R🟡 |
| `tool-loop` | Generic continuation loop；`runToolContinuationLoop` | Callback ports、serializable records | 1 / 88 | Low | S🟢 U🟢 P🟢 E🟢 R🟢 |
| `ui` | Injected UI、skill popup、tool result renderer registry | DOM、artifact/i18n；renderer registry 可替换 | 5 / 1,389 | High | S🟡 U🟢 P🟢 E🔴 R🟢 |
| `usage` | Usage input codec、aggregate、store | Codec/stats 纯；released whole-array storage 由 store-local queue coalesce 相邻未观察 writes | 7 / 785 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `voice` | Voice settings/capability detection | Web Speech、Chrome storage | 1 / 58 | Low | S🟢 U🟢 P🟢 E🟡 R🟡 |

`core/developer/` 当前为空，不构成模块。`packages/multimodal-mcp/` 也是本地空目录；实际多模态 MCP 通过外部 npm package 安装。

## Entrypoint, Native, and Build Modules

| Module | Responsibility / Public Surface | Main Issue | Size | Complexity | S.U.P.E.R |
|:--|:--|:--|--:|:--|:--|
| `entrypoints/background.ts` + background handlers | MV3 bootstrap、单一 121-command registry、automation/sync/tool/sandbox composition 与 lifecycle | 全部 121 commands 使用 typed handler；auth、multimodal、chat、export、usage、sync、automation、scenario 均通过注入式 handler/service 和接收 codec，旧 switch 已删除 | 1,411 root LOC + 28 extracted handler/service/composition modules | High | S🟡 U🟢 P🟡 E🟡 R🟢 |
| `entrypoints/content.ts` + content controllers/adapters | DeepSeek DOM capability composition、tool/agent UI、export、多模态、theme、pet、history/project | 单一 lifecycle kernel 拥有 controller epoch 和 listener/observer/timer/root/port ledger；bridge、navigation、mutation hub、codec/store 已拆出，根文件仍保留较多 DOM/domain composition | 7,417 root + 4,164 content-module LOC | Critical | S🟡 U🟡 P🟡 E🔴 R🟡 |
| `entrypoints/main-world.content.ts` + controllers | MAIN hook/bridge/navigation composition | 根缩至 89 LOC；fetch/navigation patch 由幂等 controller 和 lifecycle scope 拥有；任一 bridge world 单独重启会显式释放旧 Port、撤销旧 runtime state 并重新握手 | 89 root + 427 controller LOC | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `entrypoints/floating-chat.content.ts` + launcher lifecycle | 全站 launcher 启动 | `<all_urls>` 权限、context invalidation、BFCache 和 DOM/drag cleanup 归四态模型与幂等 start/stop | 22 root + 220 adapter LOC | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `entrypoints/sidepanel/` | React UI、lazy pages、typed runtime client、domain controllers | 页面不再直接发送 runtime request；MCP/Tools/Chat/Settings/Library policy 进入 controllers，route chunks 按需加载；Settings bootstrap decode 和 PET event/load ordering 显式受测 | 13,390 TS/TSX + CSS | High | S🟡 U🟢 P🟢 E🟡 R🟢 |
| Sandbox entrypoints | Offscreen relay、sandbox iframe/Worker execution | Request/result validation 在多层重复；Chromium offscreen 依赖 | ~358 LOC | High | S🟢 U🟡 P🟡 E🔴 R🟡 |
| `packages/shell-host` | Installer、Native Messaging/MCP host、session/process/file/skill/picker/OS providers | Native root 54 LOC、installer root 214 LOC；framing/router/providers/adapters 各有单一 owner，协议和 tool 顺序保持冻结 | 2,878 native/lib LOC | High | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `wxt.config.ts` | Manifest、ASCII JS、exact-once Pyodide/Skill asset plugins | Manifest 与 build plugins 仍同文件；每个 browser artifact 只包含 5 个 Pyodide runtime files，并生成 strict bundled-Skill manifest | 255 LOC | Medium | S🟡 U🟢 P🟢 E🟡 R🟢 |
| `scripts/` | CI/release/manifest/i18n/smoke/performance budgets | 文件职责大体单一；package/chunk/burst policies 是可执行门禁；i18n/automation smoke 跟随当前 controller/provider owners，而非旧大文件位置 | 21 / 3,871 | Medium | S🟢 U🟢 P🟢 E🟡 R🟢 |
| `tests/` | Vitest/jsdom 单元与契约测试 | 182 TS files / 161 test files；fault/restart/migration/runtime/resource/performance contracts 已覆盖，但仍没有全量真实浏览器或 coverage gate | 182 / 34,292 | Medium | S🟢 U🟢 P🟡 E🟡 R🟢 |

## Dependency Graph Findings

静态 TypeScript import 图显示：

- `entrypoints/background.ts` 直接依赖 89 个内部文件，是最高 fan-out 文件。
- `entrypoints/content.ts` 直接依赖约 34 个内部文件。
- `core/types.ts` 被约 77 个文件直接 import，是最高 fan-in 中心。
- `core/tool/runtime.ts` 直接依赖 16 个内部文件，并以硬编码分支认识多个 provider。
- R5.1 以 TypeScript AST 扫描 `core/` 与 `entrypoints/` 的 351 个 source files；当前 relative-import graph 为 `0` 个强连通分量。
- `core/types.ts` 和 `entrypoints/background.ts` 仍是高 fan-in/fan-out 中心，但没有形成 changed-path import cycle；后续拆分必须保持这一零环基线。

## Duplicate Contracts and Multiple Truth Sources

1. **Runtime messages**
   - 单一 production registry 现拥有 `121 typed / 0 legacy / 2 client-only`；`background.ts` 不再包含 transitional switch。
   - `core/types.ts` 的 `MessageAction` 仍有 91 个 variant；R4.2–R4.3 的 live-only receiver commands 通过窄 typed contract 接管而未扩张旧 union，剩余 live-only names 由 R4.4 收敛。
   - 80 个 payload-bearing commands 均由穷尽 command-codec maps 在 handler 接收边界解码；Memory、Skill、Preset 复用各自领域 codec，MCP、permission、sandbox、tool authorization、sync、automation 和 Scenario 在特权 IO 前完成校验。不存在直接 payload 强转或 delegated payload reader。

2. **Platform access**
   - R3.9 已删除 `PlatformServices`、其 browser implementation 和未被消费的 storage/runtime/download/file-picker ports，没有建立替代 facade。
   - 环境访问仍保留在真实 composition/controller consumers；本批次没有新增零消费者 broad facade，新增 ports 均由生产路径使用。

3. **Skill import**
   - GitHub/local importers 分别维护 parsed document、大小限制、命名冲突和资源 policy。
   - `MAX_SKILL_BYTES` 等边界在 browser/native paths 重复。

4. **Sandbox validation**
   - Tool schema、background、offscreen、runner 分别手写 request/result validation。

5. **MCP UI policy**
   - Origin permission、allowlist、provider 与 transport form policy 由 Side Panel controller 调用 core contract；页面只渲染状态和派发 intent。

6. **DeepSeek protocol**
   - R3.3/R3.4 已把主动与被动 route/request/SSE 收敛到纯 codec + 单一 network policy。被动 Fetch/XHR 只保留浏览器拦截、prompt 增强和可见流重写，不再维护 substring router、SSE framing/parser 或 token metrics facade。

7. **Persistence**
   - Floating chat key 和状态投影由 `core/floating-chat` + launcher adapter 共享，不再存在第二份 enabled/default truth。
   - R3.6 已让 Artifact 只以 IndexedDB 为运行时真相；legacy Chrome storage 仅作严格、可重试、可验证清理的一次性迁移输入。
   - Usage 与 Tool History 保持 released whole-array shape，但相邻未观察 mutation 通过 store-local FIFO coalescing，读/clear 是明确 barrier；Sync 不参与 coalescing。
   - Project、Saved Items、Scenario 共用窄 storage slot/versioned repository；Scenario mutation 由 Background 跨 realm 集中，旧 refresh notification 仍兼容。Memory/Artifact、tool execution blocks、inline-agent traces 均各有唯一 codec/store truth。

## Hotspot Details

### `entrypoints/background.ts`

- **Responsibility**：Extension composition root、runtime command registry、剩余跨域 application service 和 Chrome lifecycle。
- **Public API**：121 个 live runtime commands 的单一入口；121 个 typed handlers，零 legacy case。
- **Internal dependencies**：Memory、Skill、MCP、tool、sync、automation、DeepSeek、export、sandbox、browser control 等几乎全部领域。
- **Transformation note**：R4.4 已完成最后 17 个 command cutover 并删除旧 switch；剩余收口只允许缩减 composition/lifecycle root，不得恢复第二套路由或 validator。
- **S.U.P.E.R issue**：command ownership 已收口；根文件仍组合多域 lifecycle/IO，后续 changed-path audit 继续检查是否存在可删除的 application-service 残留。

### `entrypoints/content.ts`

- **Responsibility**：DeepSeek 页面隔离世界内的所有长期运行能力。
- **Public API**：MAIN bridge handler、runtime listener、DOM controllers、tool/agent render/restore。
- **Internal dependencies**：34 个直接 imports，横跨 16 个 core 领域。
- **Transformation note**：R4.5–R4.7 已建立单一 epoch kernel、MAIN/isolated bridge、DOM capability controller、mutation hub 和 strict persistence codecs；显式 peer-disconnect handshake 使 MAIN 或 isolated 单侧重启都能释放旧 session 后重新连接；R6.1 删除两条常驻 500ms route poller，并把共享全页 mutation delivery 从固定 trace 的 126 次降到 21 次。
- **S.U.P.E.R issue**：资源 ownership、reinjection/BFCache 和 teardown 已显式化；根文件仍承载较多 domain state/DOM implementation，是后续局部维护热点，但不能再绕过 lifecycle scope 新增长期资源。

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
- **Current state**：15-key PC capability matrix 与 generated manifests 保持契约；Side Panel runtime request 仅通过一个 typed client，floating-chat 以四态模型表达权限/invalidated degradation。
- **Transformation note**：R3.9 已删除零消费者的 broad facade。后续只允许在 storage/runtime/permission/identity/download 的真实生产 consumer 同一任务中引入窄 port。

### `core/sync`

- **Responsibility**：远端 backend、OAuth、schema validation 和快照同步。
- **Public API**：`StorageBackend`, `createStorageBackend`, generation publisher/reader, snapshot serializer, schema validators。
- **Transformation note**：T2.4/T2.5 的 generation pointer、local journal 和 recovery barrier 保持唯一 commit protocol；R3.5–R3.10 统一领域 codec/mutation authority。R6.5 只 coalesce Usage/Tool History 的相邻未观察 whole-key writes，Sync config/status、journal 与 confirmed-target 顺序完全不变。

### `core/skill`

- **Responsibility**：Skill registry、import、bundled resources 和 creator tool。
- **Transformation note**：R3.10 的唯一 Skill/Source codec、local-only sync policy 与 recovery journal 保持不变。R6.3 将 28 个官方资源移出启动 bundle，以 strict manifest + extension URL 按需 fetch/cache；默认启动只读取 manifest 与 `deep-discuss`，15 个最终 Skill 对象 hash 和既有 library 顺序不变。

### `core/preset` and History Organizer

- **Responsibility**：Preset/active-ID 持久化、History 标签 codec 与 content controller。
- **Transformation note**：R3.10 的 released shapes、Preset journal、domain-first response 与 History FIFO 保持不变；R4.7 将 History controller 纳入 Content lifecycle，仍明确只有 content realm 写该 key，没有新增 runtime writer 或第二 persistence truth。

### `packages/shell-host`

- **Responsibility**：Native protocol、Shell/Python/session/file/Skill/picker/OS path/logging。
- **Transformation note**：R4.12–R4.13 已将 framing、router、session/process/file/Skill/picker/OS/logger 与 installer adapters 拆开；Native root 只组合 provider，12-tool order、framing、path/env 和 npm package surface 保持兼容。

## Healthy Reference Modules

- `core/export`：transport port、schema、normalizer、renderer 分层完整。
- `core/tool-loop`：纯 engine，通过 callback 注入外部行为。
- `core/shell`：协议与 policy 独立于 native host 实现。
- `core/token`、`automation/schedule.ts`：纯函数、低替换成本。
- `core/mcp/transports`：JSON-RPC/transport contract 相对清晰。

这些模块应作为重构风格参考：contract 独立、依赖单向、外部 IO 通过窄 port 注入。
