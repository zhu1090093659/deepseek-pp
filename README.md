# DeepSeek++

为 [DeepSeek](https://chat.deepseek.com) 网页版注入 **类原生工具调用**、**MCP 工具系统**、**Agentic 记忆系统**、**Skill 技能系统**、**系统提示词预设** 和 **自动化任务** 的 Chrome / Edge / Firefox 扩展。

让 DeepSeek 像支持原生 tools 一样自动执行记忆保存、更新、删除和 MCP 工具调用，拥有跨对话长期记忆，并通过 `/skill` 指令一键切换专家模式；也可以像 Codex 自动化一样，把固定 prompt 放进独立会话里立即运行或按计划重复执行。

## 核心功能

### 类原生工具调用

- **XML 工具协议** — 在 prompt 中向模型注入 `memory_save`、`memory_update`、`memory_delete` 等工具 schema，模型按 `<tool_name>{JSON}</tool_name>` 输出调用请求
- **流式拦截执行** — 扩展在 SSE 响应流中实时识别工具调用，自动转发给 Content Script 执行，不需要用户复制或手动确认
- **隐藏原始调用** — 页面不会暴露 XML/JSON 工具块；工具调用会从正文、历史消息和 IndexedDB 缓存中清理
- **DeepSeek 原生观感** — 执行结果渲染成类似「已思考」的折叠区块，例如「已执行工具（2次）」并逐条展示 `memory_save 已保存 · 宠物信息`
- **多工具连续执行** — 同一条回复可以执行多次工具调用，适合把多个独立事实分别保存为多条记忆
- **刷新后恢复** — 工具执行记录会短期持久化，并在刷新会话后恢复展示，避免刚执行完的工具状态消失
- **历史兼容** — 新 XML 协议和旧 DSML 工具调用历史都能被解析、清理和恢复

<p align="center">
  <img src="assets/yuansheng.jpg" width="300" alt="记忆管理侧边栏">
</p>

### MCP 工具系统

- **支持多种 MCP 传输** — 支持 Streamable HTTP、HTTP POST、旧版 SSE、本地 stdio bridge 和浏览器 Native Messaging；浏览器不能直接启动 stdio 进程，因此 stdio 服务器需要通过本地 bridge 或 native host 转接
- **标准 MCP 生命周期** — 连接时执行 `initialize` / `notifications/initialized`，发现工具走 `tools/list`，调用工具走 `tools/call`
- **默认自动执行** — 新增 MCP 服务默认 `auto`，可在侧边栏按服务或单个工具禁用；禁用或手动策略的工具不会注入 DeepSeek prompt
- **权限清晰可见** — HTTP/SSE/bridge 传输会请求对应 origin 的浏览器 host permission，侧边栏可直接授权、测试连接、刷新工具和查看延迟/错误
- **结果 continuation** — DeepSeek 输出 MCP XML 工具块后，扩展会自动执行工具、隐藏原始 XML、展示折叠结果，并把 `<tool_results>` 发回同一会话继续生成
- **自动化兼容** — 自动化任务复用同一套 MCP 工具 schema、执行循环和历史记录，最多连续 3 轮工具结果 continuation
- **本地安全边界** — MCP 配置和密钥保存在浏览器本地存储；WebDAV 同步仍只同步记忆、Skill 和预设，不同步 MCP secret
- **默认限制** — 连接超时 10s，请求超时 60s，发现超时 20s，单次结果上限 64KB，单服务工具上限 128 个，均可在 MCP 服务编辑器中调整

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP 管理侧边栏">
</p>

### 记忆系统

- **自动记忆** — AI 在对话中识别到关键信息时，通过 `memory_save` 工具自动保存为长期记忆
- **智能注入** — 每次对话时，根据关键词匹配、置顶权重、访问频率等维度，自动筛选相关记忆注入 prompt
- **四种类型** — 用户画像 (`user`)、行为反馈 (`feedback`)、话题上下文 (`topic`)、参考资料 (`reference`)
- **侧边栏管理** — 查看、编辑、置顶、删除记忆，支持按类型筛选和标签管理
- **导入/导出** — JSON 格式批量备份和恢复

<p align="center">
  <img src="assets/screenshot-sidepanel-memory.png" width="300" alt="记忆管理侧边栏">
</p>

### Skill 技能系统

- **内置技能** — 预设 9 个开箱即用的技能：极致深度思考、前端设计、文档协作、品牌指南、算法艺术、PPT 设计等
- **自定义技能** — 在侧边栏创建专属技能，定义系统指令和参数
- **`/` 触发** — 在聊天框输入 `/` 弹出自动补全面板，选择技能后自动注入对应的 system prompt
- **记忆联动** — 技能可选择是否同时注入记忆上下文

<p align="center">
  <img src="assets/screenshot-skill-popup.png" width="600" alt="技能自动补全弹窗">
  <br>
  <img src="assets/screenshot-sidepanel-skill.png" width="300" alt="技能管理侧边栏">
</p>

### 系统提示词预设

- **自定义预设** — 在侧边栏创建多个系统提示词预设，定义全局角色设定或行为指令
- **一键激活** — 同一时间只有一个预设处于激活状态，激活后自动生效
- **首条注入** — 每次新对话的首条消息前自动注入激活预设的内容，后续消息不重复注入
- **与技能/记忆共存** — 预设内容作为前缀注入，与 Skill 指令和记忆上下文叠加生效

### 自动化任务

- **像 Codex 自动化一样运行** — 在侧边栏「自动化」页创建任务，点击「立即运行」即可把 prompt 发送到 DeepSeek，也可以启用定时频率自动触发
- **每个任务独立会话** — 首次运行会创建独立 DeepSeek 会话，后续运行保存并复用该任务自己的 `chat_session_id` 和最新父消息，适合连续追踪同一主题
- **支持 cron / RRULE** — 支持手动、5 字段 cron（如 `0 9 * * *`）和简化 RRULE（如 `FREQ=HOURLY;INTERVAL=1`），最小间隔默认为 15 分钟
- **可暂停、编辑和删除** — 任务卡片支持暂停/启用、编辑 prompt 与频率、删除任务，以及打开对应 DeepSeek 会话
- **运行状态可追踪** — 展示下次运行、上次运行、会话 ID、最近状态和错误信息，失败时可直接在卡片中查看原因
- **复用现有增强能力** — 自动化 prompt 仍会经过 DeepSeek++ 的预设、记忆、`/skill` 和工具调用链路，不需要单独维护第二套 prompt 逻辑
- **DeepSeek 官方网页链路** — 在 DeepSeek 页面同源上下文调用 `/api/v0/chat_session/create`、`/api/v0/chat/completion` 和 `/api/v0/chat/history_messages`，并处理登录 token、PoW challenge、模型类型和父消息 ID 兼容

<p align="center">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="自动化任务侧边栏">
</p>

#### 自动化运行说明

- 自动化依赖浏览器扩展后台定时器；浏览器关闭或休眠期间错过的触发会在下次唤醒时合并为一次执行，不会补跑多次
- DeepSeek 网页需要保持已登录状态；任务执行时扩展会复用已有 DeepSeek 标签页，找不到时会打开 `https://chat.deepseek.com/`
- cron/RRULE 的最小执行间隔为 15 分钟，避免页面接口、PoW 和账号风控被高频触发
- 自动化 prompt 会走现有 DeepSeek++ 请求拦截链路，因此激活的系统预设、记忆注入、`/skill` 指令和工具调用能力仍然生效
- 运行超时后不会自动重复发送同一条 prompt，避免 DeepSeek 页面仍在执行时产生重复消息
- 从源码更新后需要在对应浏览器扩展管理页重新加载当前目标目录，再验证侧边栏「自动化」页

## 0.2.0 变更回顾

0.2.0 汇总了 0.1.0 以来的所有主要增量，重点是把 DeepSeek++ 从“记忆 + Skill”扩展升级为完整的浏览器端工具平台。

| 方向 | 主要变化 |
|------|----------|
| MCP 工具系统 | 新增 MCP 服务配置、工具发现、健康检查、调用历史、结果大小限制和超时控制；支持 Streamable HTTP、HTTP POST、SSE、stdio bridge、浏览器 Native Messaging；手动聊天和自动化任务都能自动执行 MCP 工具并把结果 continuation 回同一会话。 |
| 工具调用内核 | 从固定记忆工具重构为 provider-neutral 工具契约；工具 schema、XML 解析、流式过滤、历史清理和 prompt 注入都改为动态 descriptor 驱动，同时保留旧 DSML 历史兼容。 |
| 自动化任务 | 新增侧边栏自动化页、任务编辑器、立即运行、cron/RRULE 调度、暂停/恢复、独立 DeepSeek 会话、运行历史、PoW/auth 兼容、错过运行合并和失败状态展示。 |
| 记忆系统 | 新增记忆更新/删除工具，优化相关记忆筛选、思考模式、自动清理和工具执行折叠展示，刷新页面后能恢复刚执行过的工具状态。 |
| Skill 与预设 | 新增 `/skill` 自动补全面板、内置/自定义技能管理、系统提示词预设、预设导入，以及 DeepSeek Expert 模式切换。 |
| 同步与个性化 | 新增 WebDAV 同步记忆、Skill 和预设；新增 DeepSeek 页面自定义背景、动态透明度和模糊控制。 |
| 文档与发布 | 增补侧边栏截图、MCP 操作说明、mock 验证脚本、TypeScript 修复、release workflow 和构建打包流程。 |

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP 管理侧边栏">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="自动化任务侧边栏">
</p>

## 工作原理

扩展在 main world 中拦截 `fetch` 和 `XMLHttpRequest`，在请求发送到 DeepSeek API 前修改 prompt（注入预设、记忆、技能指令和内置/MCP 工具 schema），并解析 SSE 响应流以提取、隐藏和执行工具调用。

```
用户输入 → 拦截请求 → 注入预设 + 记忆 + 技能指令 + 内置/MCP tools schema → DeepSeek API
                                                                        ↓
页面折叠区块 ← 执行结果持久化 ← 工具运行时 ← SSE 流式解析/隐藏工具调用
       ↓                         ↓
侧边栏 ← IndexedDB/Storage ← 内置记忆工具 / MCP 服务
```

工具调用链路分为三层：

1. **Main World**：拦截网络请求和响应流，收集完整回复，识别 XML 工具块，过滤页面可见文本。
2. **Content Script**：接收工具调用，路由到统一工具运行时，渲染「已执行工具」折叠区块，并恢复刷新后的执行状态。
3. **Background**：统一处理记忆、MCP 配置、工具发现/调用、自动化调度、数据持久化和状态广播。

## 安装

### 从源码构建

```bash
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build
```

默认 `npm run build` 生成 Chrome MV3 产物。跨浏览器构建可使用：

```bash
npm run build:chrome
npm run build:edge
npm run build:firefox
npm run build:all
```

| 浏览器 | 加载入口 | 构建目录 |
|--------|----------|----------|
| Chrome | `chrome://extensions/` → 加载已解压的扩展程序 | `dist/chrome-mv3/` |
| Edge | `edge://extensions/` → 加载解压缩的扩展 | `dist/edge-mv3/` |
| Firefox | `about:debugging#/runtime/this-firefox` → 临时载入附加组件 | `dist/firefox-mv3/manifest.json` |

Firefox 使用浏览器侧栏承载 DeepSeek++ 面板；Chrome 和 Edge 使用 `sidePanel`。Native Messaging host manifest 需要按浏览器分别安装。

Chrome 手动加载示例：

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目下的 `dist/chrome-mv3/` 目录

### 开发模式

```bash
npm run dev    # 启动开发服务器，支持热重载
npm run build  # 生产构建
npm run build:all # 生成 Chrome / Edge / Firefox 产物
npm run zip    # 打包为 .zip（用于发布）
npm run zip:all # 打包 Chrome / Edge / Firefox 产物
npm run compile # TypeScript 类型检查
npm run smoke:mcp # 本地 MCP 协议/解析 smoke 检查
npm run verify:mcp:mock # live mock MCP 手动/自动化 continuation 验证
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 框架 | [WXT](https://wxt.dev) (Chrome / Edge / Firefox MV3) |
| UI | React 19 + Tailwind CSS 4 |
| 存储 | Dexie (IndexedDB) + WebExtension Storage API |
| 语言 | TypeScript |

## 项目结构

```
core/
├── constants.ts          # API 地址、token 预算、系统模板
├── types.ts              # 类型定义
├── interceptor/          # 网络拦截（fetch/XHR hook、SSE 解析、工具调用提取/清理）
├── memory/               # 记忆系统（存储、评分筛选、prompt 注入）
├── skill/                # 技能系统（内置技能、解析器、注册表）
├── preset/               # 系统提示词预设（存储、激活管理）
├── automation/           # 自动化任务（存储、调度、DeepSeek runner、桥接协议）
├── mcp/                  # MCP 配置、协议、传输、发现缓存和执行
├── prompt/               # 共享 prompt 增强与工具 schema 渲染
├── tool/                 # provider-neutral 工具契约、内置记忆工具和运行时
└── ui/                   # 技能自动补全弹窗

entrypoints/
├── background.ts         # Service Worker（消息路由、数据持久化）
├── content.ts            # Content Script（DOM 集成、工具执行、结果区块恢复）
├── main-world.content.ts # Main World 脚本（网络拦截、工具调用桥接）
└── sidepanel/            # 侧边栏 React 应用（记忆/技能/预设/自动化/MCP/设置页面）
```

## 友情链接

- [Awesome-Prompts 角色扮演](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) — 精选角色扮演 Prompt 合集
- [LINUX DO](https://linux.do) — 新一代开源技术社区

## License

MIT
