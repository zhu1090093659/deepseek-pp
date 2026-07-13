# DeepSeek++ Project Overview

## Preliminary Direction

在保留现有用户数据、功能表面和跨版本契约的前提下，对 DeepSeek++ 做结构性重构，系统提升浏览器插件的性能、稳定性、兼容性、可维护性与向后兼容性。具体范围和优先级将在 Phase 2 基于本分析确认。

## Confirmed Task Definition

用户于 2026-07-13 确认本轮任务名为 **DeepSeek++ Reliability and Compatibility Refactor**，并确定以下执行边界：

1. **Scope**：主范围包含 PC 端 Chrome/Edge/Firefox 扩展、Shell Native Host、同步、持久化和自动化；Android、移动 WebView 和移动安装包不再属于产品范围。
2. **Strategy**：采用 compatibility-contract-first 的渐进式重构。先固定历史数据和行为合同，再修安全/数据/取消语义，之后建立有真实消费者的 ports、拆分大型入口，最后依据测量结果优化性能。
3. **Compatibility**：保留全部现有用户功能、prompt 输出、storage keys、IndexedDB、sync/MCP/runtime message/Native Host 契约和 Chrome/Edge/Firefox 支持；任何 schema 变化必须有显式 migration，不允许静默丢弃旧数据。
4. **Testing policy**：不把建设完整 E2E、coverage 或 performance 基础设施作为独立项目目标；但任何行为、数据、安全、schema、routing、permission、persistence 或 caching 变更都必须增加或更新相应自动化测试，并通过现有相关质量门。
5. **Tracking**：使用 `GITHUB_STANDARD` 的 Issues + Milestones + PR；不创建 Project board。安全敏感任务的公开 Issue 只描述修复目标和可公开验收条件，详细信任边界证据保留在本地分析中。
6. **Governance**：`AGENTS.md` 是唯一 agent instruction truth source。根 `CLAUDE.md` 不再使用；若存在则先把仍有效内容合并进 `AGENTS.md` 后删除。当前根 `CLAUDE.md` 已不存在；`videos/deepseek-pp-promo/CLAUDE.md` 与同目录 `AGENTS.md` 完全相同，已保留后者并删除重复文件。
7. **Deferred**：任意全局 coverage 数字、独立的大型测试平台建设，以及没有现有消费者的预留 abstraction。

2026-07-13 范围修订：Issue [#345](https://github.com/zhu1090093659/deepseek-pp/issues/345) 取代此前的 Android 最小兼容计划，删除 Android 模板、桥接、构建、CI 和测试支持面。T1.5/T2.3 的 Android 记录仅保留为历史执行证据。

## Analysis Snapshot

- 分支：`codex/345-remove-android-template`
- 基线 HEAD：`6daa2a2`（T2.3 merge），本快照包含 #345 的 PC-only 范围变更
- 日期：2026-07-13
- 当前工作树包含用户已有、未提交的浮窗兼容性改动：
  - `core/platform/chrome-api.ts`
  - `entrypoints/content/adapters/chat-launcher.ts`
  - `tests/chat-launcher.test.ts`（未跟踪）
- 本轮没有改动上述文件；源码统计和验证包含当前工作树状态。
- 当前规模（排除 `node_modules/`、`dist/`、归档和生成资产）：
  - `core/`：178 个 TypeScript/TSX 文件，约 32,878 行
  - `entrypoints/`：54 个 TypeScript/TSX 文件，约 24,423 行
  - `packages/shell-host/`：3 个脚本，约 2,762 行
  - `tests/`：97 个测试/fixture 源文件，约 16,487 行
  - `scripts/`：16 个脚本，约 3,109 行

## Current Architecture

DeepSeek++ 是一个面向 PC 浏览器的多运行时 WebExtension 系统，而不是单一 React 页面。它包含 MV3 service worker、DeepSeek 页面隔离世界与 MAIN world 脚本、React Side Panel/Sidebar、全网页悬浮聊天入口、浏览器沙箱和 Native Messaging Host。

```mermaid
flowchart LR
    Page["chat.deepseek.com"] --> Main["MAIN world\nfetch/XHR/IndexedDB hooks"]
    Main <--> |"MessageChannel"| Content["Isolated content runtime\nDOM + tool/agent UI"]
    Content <--> |"runtime messages"| BG["MV3 background\ncommand router + orchestration"]
    Side["React Side Panel / Sidebar"] <--> |"runtime messages"| BG
    Floating["All-sites floating chat"] --> Side
    BG --> Core["core domain modules"]
    Core --> Local["IndexedDB + storage.local/session"]
    Core --> DeepSeek["DeepSeek Web + Official API"]
    Core --> MCP["MCP transports + Native Host"]
    Core --> Sync["WebDAV + Google Drive + OneDrive"]
    BG --> Offscreen["Offscreen sandbox relay"]
    Offscreen --> Runner["Sandbox iframe + Worker"]
    Runner --> Pyodide["Bundled Pyodide"]
```

### Runtime Flow

1. `entrypoints/main-world.content.ts` 和 `entrypoints/content.ts` 在 `document_start` 启动，通过 `window.postMessage` 交换 `MessagePort`。
2. MAIN world 的 `core/interceptor/fetch-hook.ts` patch `fetch`、XHR 和部分 IndexedDB 读取，拦截 DeepSeek 请求/响应。
3. 请求增强经隔离世界读取 memory、Skill、preset、project context 和 tool descriptors，再返回修改后的请求体。
4. 流式响应中的 tool XML 在 MAIN world 解析，经过 content runtime 转发到 background，再由 `core/tool/runtime.ts` 分派到内置工具、MCP 或 browser control。
5. Side Panel 通过 runtime messages 访问 background；background 还负责自动化、同步、会话导出、官方 API、权限、沙箱和生命周期恢复。
6. 沙箱采用 `background -> offscreen document -> sandbox iframe -> Worker`，Python 运行时由 Pyodide 提供。

## Technology Stack

| Layer | Current | Transformation Position |
|:--|:--|:--|
| Language | TypeScript 5.9 / ESM | 保留；是否调整 target 由兼容性合同决定 |
| Extension framework | WXT 0.20，MV3 | 保留，强化平台适配边界 |
| UI | React 19、Tailwind CSS 4、React Markdown | 保留，按 feature/controller 拆分 |
| Local persistence | Chrome storage、Dexie/IndexedDB | 保留 key/DB identity，补迁移和事务合同 |
| Tool/runtime | XML tool calls、MCP、browser control、sandbox | 保留用户功能，收敛消息与执行策略 |
| Sandbox | Worker、Sucrase、Pyodide | 保留能力，建立体积和按需加载目标 |
| Test | Vitest 4 + jsdom | 保留并增加真实浏览器、迁移和 fault-path 验证 |
| Build/release | npm workspaces、WXT、GitHub Actions | 保留三浏览器与 release gate |
| Native integration | Node Native Messaging Host | 保留协议，拆分单体实现 |

## Entry Points

| Entry Point | Responsibility | Current Structural Signal |
|:--|:--|:--|
| `entrypoints/background.ts` | Service worker bootstrap、119 类消息、chat/sync/automation/tool/export/sandbox orchestration | 2,601 行，65 个静态内部依赖，单一 dispatcher 承担多域职责 |
| `entrypoints/content.ts` | DeepSeek DOM、bridge、工具卡、inline agent、导出、多模态、主题、宠物、token speed、恢复状态 | 6,713 行，约 364 个函数、多个 observer/timer 和模块级可变状态 |
| `entrypoints/main-world.content.ts` | MAIN world bridge 和网络拦截器装配 | 238 行；信任边界和 payload contract 需要加强 |
| `entrypoints/floating-chat.content.ts` | `<all_urls>` 悬浮聊天启动 | 入口薄，但默认全站加载与权限状态需统一 |
| `entrypoints/sidepanel/main.tsx` / `App.tsx` | React Side Panel/Firefox Sidebar | 顶层页面已 `React.lazy`；页面内部仍有多个千行级热点 |
| `entrypoints/sandbox-offscreen/` | Offscreen 到 sandbox iframe 中继 | Chromium API 依赖，需要明确降级合同 |
| `entrypoints/sandbox-runner/` | JS/TS/Python/HTML 运行 | 多层重复校验，合同尚未单一化 |
| `packages/shell-host/` | Native Host 安装和 MCP 工具 | 主 host 文件约 2,141 行、跨平台安全边界集中 |

## Persistence and Backward-Compatibility Surface

| Surface | Current Contract |
|:--|:--|
| IndexedDB `DeepSeekPP` | Memory store，Dexie v1 -> v2 -> v3 migration |
| IndexedDB `DeepSeekPPArtifacts` | Artifact store v1，兼容 legacy `storage.local` |
| `chrome.storage.local` | Skills、presets、MCP、project、saved items、sync、automation、usage、settings、tool history 等 |
| `chrome.storage.session` | Side Panel active chat loop recovery marker |
| DeepSeek page `localStorage` | Web 登录 token 的读取入口 |
| Sync JSON | Memories、skills、skill sources、presets、project、saved items |
| Runtime contracts | Side Panel/background messages、MAIN/content bridge、tool call/result、stream events |
| Prompt/output contracts | Prompt freeze、tool XML、inline-agent prompt、历史恢复文本 |

重构期间不得无迁移地重命名 `deepseek_pp_*` keys、IndexedDB 名称/表、schema version、message type、MCP transport 配置或 tool XML。当前兼容机制并不统一：部分 store 有版本化 migration，部分只做读取时 normalize，`project` 对旧 schema 会直接清空，artifact 又同时维护 IndexedDB 与 legacy storage fallback。

完整、带稳定 ID 的兼容性清单见 [`docs/compatibility/README.md`](../compatibility/README.md)。T1.1 只登记当前合同和缺口；T1.2-T1.5 负责把这些清单转成可执行 fixtures。

## Performance Baseline

- 当前本地单浏览器产物约 17 MB；其中 `pyodide/` 约 13 MB。
- Chrome 产物中：
  - `background.js` 约 1.19 MB
  - `content.js` 约 509 KB
  - `main-world.js` 约 326 KB
  - Side Panel 主 chunk 约 359 KB
- `entrypoints/content.ts` 启动时装配主题、token speed、tool blocks、多模态、导出、history/project adapters、inline agent、pet/background 等长期能力。
- 源码静态可见至少 9 个 `MutationObserver`、两个 500ms route watcher，以及大量 timer/listener；需要浏览器 profiler 才能量化稳态 CPU 和 DOM 成本。
- `entrypoints/floating-chat.content.ts` 匹配 `<all_urls>`；即使功能关闭，脚本仍需启动后读取状态。
- 多个 storage store 采用“读取整个 state/array -> 修改 -> 重写整个 key”，存在写放大、并发覆盖和 quota 风险。

## Build & Run

| Purpose | Command |
|:--|:--|
| Install | `npm ci` |
| Development | `npm run dev` |
| Type check | `npm run compile` |
| Unit/contract tests | `npm test` |
| Browser builds | `npm run build:chrome` / `build:edge` / `build:firefox` |
| All browser builds | `npm run build:all` |
| Prompt compatibility | `npm run prompt:freeze` |
| Manifest/asset policy | `npm run verify:manifest-policy` / `verify:extension-utf8` |
| Full quality gate | `npm run ci:quality` |

## Testing Baseline

本轮在当前工作树上实际验证：

| Check | Result |
|:--|:--|
| `npm test -- --reporter=dot` | 63 files / 359 tests passed，约 7.2s |
| `npm run compile` | passed，约 6.7s |
| `npm run prompt:freeze` | 10 cases passed |
| `npm run build:all` | Chrome、Edge、Firefox MV3 均构建通过 |
| `npm run verify:manifest-policy` | passed |
| `npm run verify:extension-utf8` | 78 files passed |
| `npm run audit:prod` | 0 production vulnerabilities at configured severity |

测试基线的主要缺口：

- 全部 Vitest 都在 jsdom 中运行，没有真实加载 Chrome/Edge/Firefox 扩展的 E2E。
- 没有 coverage gate、bundle budget、DOM performance budget 或 background cold-start budget。
- 没有真实 Dexie/IndexedDB 历史 migration 测试；artifact tests 明确禁用了 IndexedDB。
- 没有 sync partial-failure/rollback fault injection。
- `ci:quality` 只在 Ubuntu/Node 22 执行，未做浏览器运行时矩阵。

## Project Governance Baseline and Resolution

| Surface | Current Status |
|:--|:--|
| `AGENTS.md` | 存在，但文件头声明它由同步脚本自动生成，不应直接编辑 |
| Root `CLAUDE.md` | 不存在 |
| Claude project memory | `AGENTS.md` 引用的 `/Users/zcl/.claude/projects/-Users-zcl-code-deepseek-pp/memory` 当前不存在 |
| `.claude/settings.local.json` | 仅包含本机命令权限，不是工程规则真相源 |
| Cursor/Windsurf/Cline/Codex repo rules | 未发现现有等价规则文件 |
| Repo-local memory fallback | 未声明；本轮不会擅自创建 |
| Active `docs/progress/MASTER.md` | 不存在；这是新 spec-driven run |

分析开始时，共享规则的 canonical source 已断裂：`AGENTS.md` 声称来自一个不存在的上游。用户在 Phase 2 确认停止这条生成关系，并指定 `AGENTS.md` 为唯一项目级 agent instruction truth source。Phase 4 已将它改为可直接维护的 Codex-first 规则面；根 `CLAUDE.md` 继续保持不存在，且不创建 repo-local memory fallback。完整决议见 `docs/progress/governance-resolution.md`。

## External Integrations

| Integration | Main Boundary |
|:--|:--|
| DeepSeek Web chat/history/upload/PoW | `core/deepseek/adapter.ts`, `core/deepseek/pow.ts` |
| DeepSeek Official API | `core/deepseek/official-api.ts` |
| DeepSeek page interception | `core/interceptor/` |
| Bing web search | `core/tool/web-search.ts` |
| GitHub/local Skill import | `core/skill/` |
| MCP HTTP/SSE/Streamable HTTP/bridge/native | `core/mcp/` |
| Shell/OfficeCLI Native Host | `packages/shell-host/` |
| WebDAV/GDrive/OneDrive sync | `core/sync/` |
| Chrome Debugger Protocol | `core/browser-control/` |
| OpenAI/Gemini multimodal provider settings | `core/multimodal/` |
| Pyodide | `core/sandbox/python-worker.ts` |

## Architectural Starting Point

仓库中已有三个可复用的正向范式：

- `core/export/`：transport port、schema、normalize、render 分层清楚。
- `core/tool-loop/engine.ts`：通过 callback 注入边界，可独立测试。
- `core/mcp/transports/` 与 `core/shell/`：协议/策略相对独立于具体调用者。

后续重构应沿这些模式建立单一合同与 composition root，而不是在旧入口旁再造第二套 dispatcher、storage abstraction 或 validation path。
