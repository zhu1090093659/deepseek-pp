<p align="center">
  <img src="assets/readme-header.png" width="860" alt="DeepSeek++ DeepSeek 浏览器插件和 AI Agent 工作台">
</p>

<h1 align="center">DeepSeek++</h1>

<p align="center">
  <strong>DeepSeek++：把 DeepSeek 网页版扩展成支持中英文体验、记忆、项目、Skill、MCP、多模态媒体、浏览器控制、保存项、产物下载、对话导出和自动化的 AI Agent 工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/zhu1090093659/deepseek-pp/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/watchers"><img alt="Watchers" src="https://img.shields.io/github/watchers/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/zhu1090093659/deepseek-pp?style=flat-square"></a>
  <a href="https://github.com/zhu1090093659/deepseek-pp/issues"><img alt="Issues" src="https://img.shields.io/github/issues/zhu1090093659/deepseek-pp?style=flat-square"></a>
</p>

<p align="center">
  <a href="https://github.com/zhu1090093659/deepseek-pp/releases"><img alt="Release" src="https://img.shields.io/github/v/release/zhu1090093659/deepseek-pp?style=flat-square&label=release"></a>
  <a href="https://chromewebstore.google.com/detail/deepseek++/kdmpkkahkhdmdhfkdihkopikgcocbpbf?hl=zh-CN"><img alt="Chrome Web Store" src="https://img.shields.io/badge/Chrome%20Web%20Store-available-16a34a?style=flat-square"></a>
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-2563eb?style=flat-square"></a>
  <a href="https://chat.deepseek.com"><img alt="DeepSeek" src="https://img.shields.io/badge/DeepSeek-web-4f46e5?style=flat-square"></a>
  <a href="https://linux.do"><img alt="LINUX DO" src="https://img.shields.io/badge/LINUX-DO-f59e0b?style=flat-square"></a>
</p>

<p align="center">
  <a href="README_EN.md">English README</a> ·
  <a href="#产品定位">产品定位</a> ·
  <a href="#功能速览">功能速览</a> ·
  <a href="#适合场景">适合场景</a> ·
  <a href="#安装">安装</a> ·
  <a href="#1100-变更回顾">1.10.0 变更</a>
</p>

## 产品定位

DeepSeek++ 是面向 [DeepSeek](https://chat.deepseek.com) 网页版的开源浏览器扩展，支持 Chrome、Edge 和 Firefox。它把 DeepSeek Web 扩展成 AI agent workspace，让用户在同一浏览器工作流里使用中英文界面、MCP 工具、图片/视频多模态分析、长期记忆、Skill、系统提示词预设、联网搜索、网页读取、对话导出和定时自动化。

如果你在寻找 DeepSeek Chrome extension、DeepSeek MCP tools、DeepSeek memory plugin、DeepSeek conversation export 或 DeepSeek AI agent，DeepSeek++ 对应的是同一个本地优先的 DeepSeek 浏览器增强工作台。

语言可设为跟随浏览器、简体中文或 English。DeepSeek++ 会让侧边栏、右键菜单、工具结果、内置 Skill 行为和自动续跑提示保持一致语言，同时保留用户自己写的记忆、预设、自定义 Skill、自动化任务和同步数据原文。

## 目录

- [产品定位](#产品定位)
- [功能速览](#功能速览)
- [适合场景](#适合场景)
- [核心功能](#核心功能)
- [1.10.0 变更回顾](#1100-变更回顾)
- [安装](#安装)
- [友情链接](#友情链接)

## 功能速览

| 需求 | DeepSeek++ 提供 |
|------|----------------|
| AI agent browser extension / AI Agent 工作台 | 把 DeepSeek Web 扩展成可以持续执行任务、调用工具、复用记忆和调度自动化的浏览器内工作台。 |
| DeepSeek browser extension / DeepSeek Chrome extension | 在 DeepSeek 网页版中加入侧边栏对话、普通网页悬浮聊天入口、右键发送文本、工具执行结果展示和 Chrome / Edge / Firefox 支持。 |
| Multilingual DeepSeek extension / 中英文体验 | 可在简体中文和 English 之间切换，界面、内置工具说明和模型续跑行为保持同一语言。 |
| DeepSeek MCP tools | 在侧边栏管理 MCP 服务、工具权限和执行状态，并把工具结果带回同一会话继续生成。 |
| DeepSeek multimodal media / 图片视频分析 | 可在侧边栏网页登录对话的识图模式附加图片；安装多模态 Native Host 后，也可在 DeepSeek 输入框附加图片或视频，让 DeepSeek++ 先完成媒体分析再带着结果继续对话。 |
| DeepSeek browser control / 浏览器控制 | 在侧边栏选择受控标签页，让 DeepSeek++ 按用户开启的边界读取页面结构并执行可见网页操作。 |
| DeepSeek memory / 长期记忆 | 自动保存、筛选和注入长期记忆，让不同对话可以复用用户偏好、项目背景和常用信息。 |
| DeepSeek Skills / `/skill` 工作流 | 通过内置、自定义或 GitHub 导入的 Skill 快速切换专家模式和任务模板。 |
| DeepSeek project context / 项目上下文 | 将项目指令、项目记忆和相关 DeepSeek 对话组织在一起，并在对应对话中自动加入上下文。 |
| DeepSeek artifact downloads / 可下载产物 | 生成单文件或项目包下载产物，适合保存脚本、Markdown、JSON、HTML 或小型项目结构。 |
| DeepSeek conversation export / 对话导出 | 在 DeepSeek 回复工具栏里选择格式导出当前对话，支持 HTML、Markdown、PDF 和图片附件清单，并保留附件引用和元数据。 |
| DeepSeek saved snippets / 保存项 | 保存片段、书签和常用 prompt，可搜索、插入到对话，也可导出为 Markdown 或 JSON。 |
| DeepSeek prompt controls / 提示词控制 | 控制记忆、系统提示词、预设注入频率和回复语言，适合在不同任务之间快速切换。 |
| DeepSeek automation / 自动化任务 | 把固定任务放入独立 DeepSeek 会话，支持立即运行、定时触发、状态追踪和手动停止。 |
| DeepSeek web search / 网页获取 | 在需要实时信息或指定网页内容时搜索互联网、读取网页文本，并继续生成最终回答。 |

## 适合场景

- 希望把 DeepSeek 网页版扩展成带工具调用、MCP、记忆和自动化能力的 AI agent 工作台。
- 希望 DeepSeek++ 的界面、工具提示和模型续跑提示能跟随中文或英文使用环境。
- 希望在 Chrome、Edge 或 Firefox 中直接使用 DeepSeek 侧边栏对话、普通网页悬浮聊天入口、网页文本发送和固定场景 prompt。
- 希望在 DeepSeek 对话中加入图片或视频，让模型基于媒体分析结果继续完成解释、总结、对比或文档任务。
- 希望在 Chrome 或 Edge 中让 AI 操作用户选定的标签页，同时保留明确的启用、切换和断开控制。
- 希望把项目背景、个人偏好、常用工作流和文档处理能力沉淀为长期记忆与可复用 Skill。
- 希望把自己的 DeepSeek 对话记录本地备份为可读文件，便于归档、迁移或后续检索。
- 希望让 DeepSeek 处理需要多步工具执行、联网搜索、网页读取或定时跟踪的任务。

## 核心功能

### 侧边栏对话

- **可选对话入口** — 在设置页启用后，侧边栏会显示「对话」页，可直接向 DeepSeek 发消息
- **普通网页悬浮聊天** — 在非 DeepSeek 网页可通过可拖动的 DS++ Chat 悬浮入口打开轻量聊天窗口；可在设置页外观区域关闭
- **主动发送边界** — 悬浮入口本身不会自动读取或发送当前页面正文，只有用户主动输入、发送或使用选中文本场景时内容才进入聊天流程
- **右键发送文本** — 在网页中选中文本后右键发送到侧边栏对话，适合快速解释、总结或改写页面内容
- **右键场景** — 可以配置常用场景模板，把选中文本套入固定 prompt 后送入对话
- **官方 API Key** — 配置 Key 后，侧边栏对话和右键场景可在普通网页使用；未配置时右键场景仅在 DeepSeek 网页可用
- **网页模型模式** — 使用网页登录对话时，可在默认、专家和识图模式之间切换
- **识图图片附件** — 识图模式下可主动选择或粘贴图片，图片只会在用户发送本次消息时进入 DeepSeek 对话
- **独立新会话** — 侧边栏对话支持新建会话，减少和当前页面已有对话互相干扰
- **流式展示** — 回复会在侧边栏内持续渲染，登录状态缺失时会提示先回到 DeepSeek 页面完成登录

### 中英文体验

- **语言选择** — 可选择跟随浏览器、简体中文或 English
- **一致的运行时语言** — 侧边栏、右键菜单、工具结果、内置工具说明和自动续跑提示会跟随所选语言
- **模型行为同步** — 内置 Skill、工具调用说明、联网搜索提示和长任务续跑提示会使用当前语言
- **保留用户原文** — 用户创建的记忆、预设、自定义 Skill、自动化 prompt、MCP 配置和同步数据不会因为切换语言被翻译或改写

### 项目上下文与可下载产物

- **项目上下文** — 在侧边栏维护项目名称、说明和项目指令，并把相关 DeepSeek 对话加入同一项目
- **按项目加入对话** — 已加入项目的对话会自动带入项目指令和项目记忆，减少重复粘贴背景信息
- **项目记忆管理** — 可在项目页新增、编辑、置顶或删除只属于当前项目的记忆
- **单文件产物** — 让 DeepSeek++ 生成脚本、Markdown、JSON、HTML 等可下载文件
- **项目包产物** — 多文件结果可打包下载，适合原型、小工具或文档集合
- **本地优先** — 项目上下文、项目记忆和生成产物由用户主动维护和下载，不需要 DeepSeek++ 托管后台

### 类原生工具调用

- **自动识别与执行** — 模型输出工具调用请求后，扩展自动识别并执行，不需要用户复制或手动确认
- **隐藏原始调用** — 页面不会暴露工具调用的技术细节，只展示简洁的执行结果
- **原生观感** — 执行结果渲染成类似「已思考」的折叠区块，例如「已执行工具（2次）」并逐条展示结果
- **多工具连续执行** — 同一条回复可以执行多次工具调用，适合把多个独立事实分别保存为多条记忆
- **刷新后恢复** — 工具执行记录在刷新会话后仍能恢复展示
- **速度显示** — 回复生成时在输入框旁显示实时 `tok/s`，便于判断当前会话是否仍在高速输出

<p align="center">
  <img src="assets/yuansheng.jpg" width="300" alt="工具调用效果">
</p>

### 对话导出

- **当前对话导出** — 在 DeepSeek 回复下方的复制、分享等官方按钮同一排，导出当前对话
- **格式可选** — 默认导出 HTML，也可选择 Markdown 或 PDF 文件
- **可读模式** — 默认隐藏扩展内部提示和工具调用标记，导出文件更适合直接阅读和检索
- **附件清单** — 导出消息中的文件引用、文件名、大小、状态和引用关系；文件正文导出会在下载链路验证完成后再启用
- **图片清单** — 可单独导出图片附件清单，便于整理含截图、图表或图片附件的对话
- **单消息导出** — 页面中的单条消息可保存为 Markdown，适合摘录回答片段
- **本地保存** — 导出文件通过浏览器本地下载保存，DeepSeek++ 不运营用于收集导出数据的后台服务

### 保存项与会话整理

- **保存片段与书签** — 将常用 prompt、回答片段、网页线索或参考内容保存到侧边栏
- **快速插入** — 保存项可一键插入侧边栏对话，适合复用固定说明或工作流
- **搜索与标签** — 保存项支持搜索和标签；DeepSeek 会话历史可添加标签并按标题或标签过滤
- **批量导出** — 保存项可导出为 Markdown 或 JSON，便于迁移、备份和复盘
- **代码块下载** — DeepSeek 页面里的代码块可直接保存为对应类型的本地文件
- **新功能提示** — 设置页会显示本地版本的新功能摘要，用户可自行关闭

### 内置网络工具

- **联网搜索** — 模型可在需要实时信息、事实核验或引用来源时调用 `web_search` 搜索互联网
- **网页获取** — 模型可通过 `web_fetch` 获取用户指定网页的可视文本内容，用于进一步总结和分析
- **自动续跑** — 搜索或网页获取完成后，结果会回传到同一会话，模型继续生成最终回答
- **工具开关** — 侧边栏「工具」页可单独启用或关闭内置网络工具
- **权限管理** — 获取网页时可在侧边栏为指定站点授权，搜索工具内置常用搜索源权限
- **诊断入口** — 侧边栏提供搜索诊断，便于确认当前网络与权限状态

### Agent 式持续执行

- **持续推进任务** — 像 Claude Code / Codex 一样，模型可以根据工具结果继续决定下一步，而不是只执行一次工具后停住
- **分步续跑** — MCP 工具结果会回传到同一会话继续生成，直到任务完成或不再需要调用工具
- **节奏控制** — 多步续跑会在连续请求之间自动留出间隔，减少长任务被平台校验打断的情况
- **Step 折叠区** — 连续执行过程按 Step 展示，已完成步骤自动折叠，长任务不会淹没正文
- **刷新后恢复** — 页面刷新后仍能恢复最近的工具执行过程和最终状态
- **可手动停止** — 长任务执行中可以直接停止后续续跑

<p align="center">
  <img src="assets/screenshot-inline-tools.png" width="720" alt="工具续跑与速度显示">
</p>

### 浏览器控制

- **按需启用** — 在侧边栏「能力 > 浏览器」中开启，选择目标标签页后才会把浏览器工具加入新会话
- **可见网页操作** — 支持导航、点击、悬停、输入、按键、等待页面内容、处理对话框和上传文件等常见浏览器动作
- **文本快照** — 提供给模型的是页面结构和可见文本摘要，不是截图；可调整快照节点和文本预算
- **目标可控** — 可查看当前附着状态，随时刷新目标列表、切换受控标签页或断开浏览器控制
- **平台边界** — 浏览器控制仅在支持相关浏览器能力的 Chrome / Edge 环境中可用，关闭后不会向新会话注入浏览器工具

### 交互式工具与提示词控制

- **沙箱确认** — 高风险或需要明确授权的代码执行会先展示确认卡片，用户确认后才继续
- **Skill 草稿** — AI 可辅助生成 Skill 草稿，保存前由用户预览、修改和确认
- **记忆导入** — 支持从其他 AI 工作流导入记忆，先预览再选择接受或拒绝
- **保存项复用** — 片段和书签可作为 prompt 素材反复插入对话
- **语音输入与朗读** — 在浏览器支持时，可使用语音输入和回复朗读；不支持的平台会显示明确状态
- **提示词开关** — 可按任务关闭记忆、系统提示词或预设注入，也可强制回复语言

### 悬浮宠物

- **状态联动** — DeepSeek 页面可显示「DeepSeek 小鲸鱼」，会跟随思考、输出、工具执行、成功和失败状态切换反馈
- **台词气泡** — 小鲸鱼会按当前状态显示简短台词，长时间思考、输出或工具执行时自动轮播
- **位置可调** — 支持固定在左下或右下，也可以直接拖动到自定义位置
- **外观可调** — 设置页可调整尺寸、透明度和动态漂浮效果
- **本地保存** — 开关、位置和外观配置保存在浏览器本地，刷新后继续生效

<p align="center">
  <img src="public/pet/deepseek-whale-pet-states.png" width="420" alt="DeepSeek 小鲸鱼状态">
</p>

### MCP 工具系统

- **灵活接入** — 可添加远程或本机 MCP 服务，适合连接浏览器侧工具、本机命令和团队已有工具
- **默认自动执行** — 新增 MCP 服务默认自动执行，可在侧边栏按服务或单个工具切换为手动
- **权限管理** — 侧边栏可直接授权、测试连接、刷新工具和查看状态
- **结果自动回传** — 工具执行完成后，结果自动发回同一会话继续生成，实现多轮工具调用
- **支持 Agent 式续跑** — MCP 工具结果可以回传到原会话继续生成，支撑长任务里的多步工具执行
- **内置多模态预设** — 可创建 `多模态` 预设，让 DeepSeek 通过 OpenAI 分析多张图片，通过 Gemini 分析视频
- **输入框媒体附件** — 安装并启用多模态预设后，可在 DeepSeek 输入框添加图片或视频，分析结果会并入本次消息继续生成
- **用户可控边界** — OpenAI / Gemini Key、模型和请求地址由用户在设置页配置；媒体文件只在用户主动附加并发送时进入多模态分析流程
- **本地安全** — MCP 配置和密钥保存在浏览器本地，同步功能不会同步敏感信息

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.png" width="300" alt="MCP 管理侧边栏">
</p>

安装多模态 Native Host：

```bash
npx deepseek-pp-multimodal-mcp install --browser chrome --extension-id <扩展ID>
```

侧边栏 `MCP` 页会自动填入当前扩展 ID。安装后在设置页的「多模态 API」配置 OpenAI / Gemini Key、模型和请求地址，然后启用 `多模态` 预设、点击测试和刷新工具。

从源码开发时也可以使用：

```bash
npm run multimodal:install -- --browser chrome --extension-id <扩展ID>
```

### OfficeCLI 文档工具

- **内置 `/officecli` skill** — 面向 `.docx`、`.xlsx`、`.pptx` 的检查、问题定位、验证和受控修改流程，默认停用，需在 Skill 页手动启用
- **第三方 Skill 库** — 内置 OfficeCLI 的 DOCX、XLSX、PPTX、Pitch Deck、Academic Paper、Financial Model、Dashboard、Morph PPT 等场景技能
- **第三方样式库** — 内置 OfficeCLI PPT styles 索引和样式说明，可用 `/officecli-pptx /officecli-styles ...` 链式加载完整视觉风格
- **通过 Shell MCP 执行** — 侧边栏创建 `Shell` 预设后，模型通过 `shell_exec` 调用本机命令版 OfficeCLI
- **自动安装命令版** — `deepseek-pp-shell-host` 会按系统和 CPU 架构从 iOfficeAI/OfficeCLI 发布资产安装单二进制
- **命令版优先** — skill 会先检查 `officecli --help` 是否包含 `view/get/set/batch` 等脚本化命令
- **拒绝额度生成路径** — 如果当前二进制只有 `new --prompt` 这类 hosted AI 生成能力，skill 会停止并提示切换 OfficeCLI 二进制
- **真实本机路径** — 文档路径由用户提供或通过 Shell MCP 查询，不猜测占位目录

安装 Shell Native Host：

```bash
npx deepseek-pp-shell-host install --browser chrome --extension-id <扩展ID>
```

侧边栏 `MCP` 页会自动填入当前扩展 ID。这个命令会同时安装 Shell Native Host 和命令版 OfficeCLI；Shell MCP 会启用本机命令执行能力。安装后重启浏览器，然后在侧边栏 `MCP` 页点击 `Shell` 创建预设，点击测试和刷新工具。命令版 OfficeCLI 可继续使用 `create/get/set/view/batch/validate` 等脚本化命令，不走 `new --prompt` 的 hosted 生成额度。

从源码开发时也可以继续使用：

```bash
npm run shell:install -- --browser chrome --extension-id <扩展ID>
```

### 记忆系统

- **自动记忆** — AI 在对话中识别到关键信息时，自动保存为长期记忆
- **智能注入** — 每次对话时，根据关键词匹配、置顶权重、访问频率等维度，自动筛选相关记忆注入上下文
- **四种类型** — 用户画像 (`user`)、行为反馈 (`feedback`)、话题上下文 (`topic`)、参考资料 (`reference`)
- **侧边栏管理** — 查看、编辑、置顶、删除记忆，支持按类型筛选和标签管理
- **导入/导出** — JSON 格式批量备份和恢复

<p align="center">
  <img src="assets/screenshot-sidepanel-memory.png" width="300" alt="记忆管理侧边栏">
</p>

### Skill 技能系统

- **内置技能** — 预设多组开箱即用的技能，包含通用协作技能和可手动启用的 OfficeCLI 第三方文档技能
- **自定义技能** — 在侧边栏创建专属技能，定义系统指令和参数
- **GitHub 导入** — 支持从 GitHub 仓库、目录或单个 `SKILL.md` 链接预览并导入第三方 Skill
- **本地导入** — 支持从本机 Skill 文件夹预览、导入和同步本地 Skill，便于复用个人工作流
- **来源与更新** — GitHub 导入的 Skill 会显示来源仓库、版本、license、同步时间，并支持检查和同步上游更新
- **启用控制** — 自定义、本地导入和 GitHub 导入的 Skill 可以单独启用、停用或删除，不影响其他 Skill
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
- **首条注入** — 每次新对话的首条消息前自动注入激活预设的内容
- **与技能/记忆共存** — 预设内容与 Skill 指令和记忆上下文叠加生效

### 自动化任务

- **手动或定时触发** — 在侧边栏「自动化」页创建任务，点击「立即运行」或设置 cron/RRULE 后，由扩展自动把任务发送到 DeepSeek
- **每个任务独立会话** — 首次运行自动创建独立会话，后续运行复用该会话，适合连续追踪同一主题
- **灵活调度** — 支持手动触发、cron 表达式（如 `0 9 * * *`）和 RRULE（如 `FREQ=HOURLY;INTERVAL=1`），最小间隔 15 分钟
- **可暂停、编辑和删除** — 任务卡片支持暂停/启用、编辑 prompt 与频率、删除任务，以及打开对应会话
- **运行状态可追踪** — 展示下次运行、上次运行、最近状态和错误信息
- **复用增强链路** — 自动化负责触发任务；触发后的 prompt 仍可经过预设、记忆、MCP 工具和 Agent 式续跑链路

<p align="center">
  <img src="assets/screenshot-sidepanel-automation.png" width="300" alt="自动化任务侧边栏">
</p>

## 1.10.0 变更回顾

1.10.0 改进本地 Skill 的资源导入与按需读取体验，让大型 Skill 的文件状态、读取条件和失败修复更清楚，同时提升 MCP 代理工具的参数准确性。

| 方向 | 主要变化 |
|------|----------|
| 本地 Skill 资源状态 | 预览会明确区分已内嵌文件和保留在原目录、可按需读取的支持文件，避免把上下文预算外的文件误解为丢失。 |
| 读取能力校验 | 导入前会确认 Shell MCP 是否真的能读取按需资源；不可用时提供更新 Native Host、调整执行模式或检查连接的明确提示。 |
| 混合目录导入 | 单个 Skill 因读取器不可用而受阻时，同目录中不依赖该能力的其他 Skill 仍可继续选择和导入。 |
| MCP 参数约束 | MCP 工具输入参数的可选值会在发现、缓存和提示链路中完整保留，代理 MCP 工具调用更准确。 |
| 权限边界 | 本次更新不新增浏览器权限；按需资源仍保留在用户选择的本地 Skill 目录中。 |

感谢 [@zhangweildlh](https://github.com/zhangweildlh) 反馈本地 Skill 资源说明问题并提供复现材料。

<details>
<summary>展开历史版本变更回顾（1.0.9 - 0.2.0）</summary>

<details>
<summary>展开 1.0.9 变更回顾</summary>

### 1.0.9 变更回顾

1.0.9 把侧边栏聊天入口扩展到普通网页，并修复自动化任务在后台运行时的登录和会话恢复问题，重点让跨页面使用和定时任务更稳定。

| 方向 | 主要变化 |
|------|----------|
| 全局悬浮聊天入口 | 非 DeepSeek 网页会显示可拖动的 DS++ Chat 悬浮入口，点击即可打开轻量聊天窗口，适合在浏览网页时直接向 DeepSeek++ 提问。 |
| 可控与隐私边界 | 悬浮聊天可在设置页外观区域关闭；入口本身不会自动读取或发送页面正文，只有用户主动输入、发送或使用选中文本场景时内容才进入聊天流程。 |
| 自动化登录稳定性 | 自动化任务在后台运行时会使用可用的 DeepSeek 登录信息，已登录用户不再因为后台环境拿不到页面 token 而误报需要重新登录。 |
| 自动化会话恢复 | 自动化结果里的会话链接和历史快照在后台运行时会指向正确的 DeepSeek 会话，便于打开和追踪任务结果。 |
| 回归覆盖 | 发布验证继续覆盖编译、测试、自动化契约、MCP/Shell/PoW smoke、多浏览器构建和发布资产检查。 |

</details>

<details>
<summary>展开 1.0.8 变更回顾</summary>

## 1.0.8 变更回顾

1.0.8 修复本地 Skill 导入、长内容写入配额、以及 Agent 并发三个用户反馈强烈的问题，重点让长时间任务更稳、错误提示更可操作。

| 方向 | 主要变化 |
|------|----------|
| 本地 Skill 导入兼容中文与 BOM | 导入带 UTF-8 BOM 的 `SKILL.md` 不再丢失 frontmatter，中文名/中文目录也能导入（自动生成稳定 slug 兜底，之后可在 Skills 界面改名）；Windows 反斜杠路径正确解析。 |
| 工具记录存储配额治理 | 工具调用历史改用预算式写入，写满前自动裁剪最旧记录，不再每次工具调用都刷配额告警；单条记录的详情/输出快照收紧，历史上限从 200 降到 100。 |
| 本机写入大小对齐真实上限 | 本机消息和 `local_file_write` 上限对齐 Chrome native messaging 的 ~1 MB 真实天花板，过大的写入会在插件侧和本机 host 两侧都被提前拦截，并明确提示分块写入；本机 host 响应接近上限时记录诊断日志。 |
| Agent 并发保护 | Agent 运行期间，用户在对话框发送的新消息不再触发第二个重复 Agent；旧 Agent 面板在切换时同步移除，避免两个面板同时出现；新增「Agent 正在执行中」的状态提示。 |
| 回归覆盖 | 新增 BOM 导入、中文 slug 兜底、历史预算裁剪、本机 900 KB 边界、Agent 并发守卫相关测试。 |

</details>

<details>
<summary>展开 1.0.7 变更回顾</summary>

## 1.0.7 变更回顾

1.0.7 是 Shell Native Host 和 MCP stdio 桥接的诊断与稳定性更新，重点让本机工具问题更容易排查，并防止超大本机载荷导致桥接失败。

| 方向 | 主要变化 |
|------|----------|
| Shell Native Host 日志 | 安装器新增 `--log-file <path>` 选项，把本机 host 运行日志写到指定文件，方便排查 `local_file_write` 等本机工具问题；状态页可识别日志路径，路径含空格或特殊字符也能正确解析。 |
| 本机 host 启动日志 | 本机 host 启动时自动创建日志目录并写入启动行，日志写入失败会在 stderr 提示一次，不再静默吞掉。 |
| 本机载荷大小保护 | Shell Host 通道新增本机载荷大小校验，在打开本机端口前拒绝过大的 `local_file_write` 内容或整体信封，避免超大写入导致桥接失败；多模态图片/视频分析不受该上限影响。 |
| stdio 桥接 UI | MCP 服务表单里 stdio_bridge 的 URL 字段改名为「桥接端点 URL」并增加提示，引导本地可执行程序用户改用 Shell Native Host 预设，减少误填本地 exe 路径导致的连接失败。 |
| 回归覆盖 | 新增 installer 日志路径往返、本机载荷大小校验、信封超限分支、通知路径、多模态回归、日志目录创建和 stderr 诊断测试。 |

</details>

<details>
<summary>展开 1.0.6 变更回顾</summary>

### 1.0.6 变更回顾

1.0.6 是 Skill 和本机工具稳定性更新，重点内置 spec-driven-develop 工作流，改善 GitHub/本机 Skill 导入体验，并让产物、Shell 工具结果和 DeepSeek 推理页面识别更可靠。

| 方向 | 主要变化 |
|------|----------|
| 内置 Skill 库 | 新增 spec-driven-develop、deep-discuss 和 review-spd 工作流，支持从 Skill 页启用结构化需求分析、深度讨论和代码审查模板。 |
| Skill 导入稳定性 | GitHub Skill 导入减少请求次数，本机 Skill 导入支持嵌套目录和预览，降低导入大型 Skill 库时的失败率。 |
| 产物与工具结果 | 生成产物会持久保存，刷新后仍可恢复；大体积工具结果改用外部化载荷，减少长任务中消息过大或续跑中断。 |
| Shell Native Host | Shell 工具对本机 Skill 预览、stdio 桥接和权限策略的处理更稳，命令型本机工作流更容易接入。 |
| DeepSeek 页面兼容 | 更准确识别 DeepSeek 推理页面，让工具块样式和增强能力在更多 DeepSeek 页面形态下保持可用。 |
| 回归覆盖 | 新增 Skill 导入、Shell host、本机 Skill 预览、产物恢复、外部化工具载荷、流式工具解析和桥接传输回归测试。 |

</details>

<details>
<summary>展开 1.0.5 变更回顾</summary>

### 1.0.5 变更回顾

1.0.5 是项目上下文和 Agent 续跑稳定性更新，重点让项目里的新对话启动更直接、项目对话标题更准确，同时减少 inline agent 重复续跑、内部续跑消息外露、识图上传误判和代码块下载按钮遮挡内容的问题。

| 方向 | 主要变化 |
|------|----------|
| 项目对话组织 | 项目侧边栏新增「在项目中开启新对话」入口，新会话会直接继承所选项目上下文。 |
| 项目标题刷新 | 项目对话会优先使用真实历史标题，默认 DeepSeek 标题或未命名占位不会覆盖已经保存的有效标题。 |
| Agent 续跑稳定性 | inline agent 在已经给出完整答案时减少重复续跑，并隐藏内部续跑消息，让最终回答和历史记录更干净。 |
| 识图与代码块体验 | 识图图片上传对 DeepSeek 返回的成功但待定审核状态更兼容；代码块下载按钮改为浮动定位，减少对代码内容布局的影响。 |
| 开源许可证 | 项目许可证和包元数据同步为 Apache-2.0，README 徽章与源码包信息保持一致。 |
| 回归覆盖 | 新增项目对话标题、项目侧边栏、inline agent 续跑、历史清理、识图上传和代码块下载回归测试。 |

</details>

<details>
<summary>展开 1.0.4 变更回顾</summary>

### 1.0.4 变更回顾

1.0.4 是侧边栏对话和 Skill 管理体验更新，重点让网页对话可以在默认、专家和识图模式之间切换，识图模式可主动附加图片，同时让记忆/Skill 注入、Agent 停止反馈和批量 Skill 开关更稳定。

| 方向 | 主要变化 |
|------|----------|
| 网页模型模式 | 设置页和侧边栏对话可选择默认、专家或识图模式；侧边栏 API 对话继续使用对话页里的模型设置。 |
| 识图图片附件 | 侧边栏网页登录对话在识图模式下可选择或粘贴图片，发送前展示上传状态；图片只会在用户主动发送本次消息时进入 DeepSeek 对话。 |
| 记忆与 Skill 注入 | 侧边栏输入、记忆、Skill、项目上下文和保存项插入之间的组合更稳定，减少上下文互相覆盖或顺序不清的问题。 |
| Agent 停止反馈 | 自动工具续跑达到轮次边界时会明确显示暂停提示，避免把仍待续跑的中间文本当作最终答案。 |
| Skill 批量开关 | 第三方或导入 Skill 分组支持一次性批量启用/停用，减少多次保存带来的状态不一致。 |
| 回归覆盖 | 新增网页模型模式、识图图片附件、侧边栏 prompt 组合、inline agent 停止边界和 Skill 批量开关测试。 |

</details>

<details>
<summary>展开 1.0.3 变更回顾</summary>

### 1.0.3 变更回顾

1.0.3 是云同步、提示词复用和 MCP 连接增强版本，重点让保存项可以更快进入对话，让同步来源扩展到 Google Drive / OneDrive，并提升本机 Shell 与 Streamable HTTP MCP 的可靠性。

| 方向 | 主要变化 |
|------|----------|
| 保存项插入 | 保存页和资料库中的常用 prompt、片段和书签可直接插入当前聊天输入框，复用固定指令和工作流更顺手。 |
| 云同步来源 | 同步设置新增 Google Drive 和 OneDrive，继续保留 WebDAV；Drive / OneDrive 使用用户自己的 OAuth 应用配置，数据只在用户启用同步后写入对应云端应用空间。 |
| MCP 连接 | MCP HTTP 传输支持 Streamable HTTP 会话，远程工具服务的发现、连接和执行状态更稳定。 |
| Shell 安全边界 | Shell MCP 执行环境改为最小环境变量集，减少主机进程里的敏感变量被本机命令继承；Windows PowerShell 持久会话也更稳定。 |
| 同步兼容性 | GitHub Skill 从仓库根目录导入后，跨设备同步下载不再因为空 rootPath 校验失败。 |
| 回归覆盖 | 新增保存项插入、云同步后端、MCP 传输策略、GitHub Skill 同步校验和 Shell 环境隔离测试。 |

感谢本版本贡献者：[@maoxin1234](https://github.com/maoxin1234) 改进 Shell MCP 环境隔离与 Windows 会话稳定性。

</details>

<details>
<summary>展开 1.0.2 变更回顾</summary>

### 1.0.2 变更回顾

1.0.2 是 Shell MCP 和工具结果体验增强版本，重点让本机命令可以在连续会话中保留上下文，并让中英文工具反馈、命令结果和发布校验更稳定。

| 方向 | 主要变化 |
|------|----------|
| Shell 持久会话 | Shell MCP 新增持久会话工具，可开启、复用和结束同一个本机 shell 会话，适合需要保留当前目录、环境变量或交互状态的连续任务。 |
| 命令结果反馈 | 当 shell 命令自行结束会话时，仍会返回本次命令的输出、退出码和状态，减少长命令或一次性命令结束后的信息丢失。 |
| 工具结果语言 | Skill 草稿、记忆导入和产物相关工具结果卡片继续补齐中英文文案，侧边栏语言切换后可读性更一致。 |
| 发布脚本可靠性 | 发布、自动化、i18n、manifest 和资产校验脚本在不同运行目录下更稳定，降低跨平台执行时找错项目根目录的风险。 |
| 回归覆盖 | 补强 Shell 持久会话、命令退出结果、工具结果渲染、shell policy 和发布脚本路径相关测试。 |

</details>

<details>
<summary>展开 1.0.1 变更回顾</summary>

### 1.0.1 变更回顾

1.0.1 是 1.0.0 之后的体验和可靠性补丁，重点让用户更容易看懂会话速度、管理项目会话，并让 MCP 与多模态任务在浏览器工作流里执行得更可控。

| 方向 | 主要变化 |
|------|----------|
| 用量与速度可见性 | 设置页新增用量统计入口，可查看 token、请求、耗时和速度等本地统计，帮助用户理解当前 DeepSeek++ 会话的执行节奏。 |
| 工具执行边界 | MCP 工具执行和多模态能力检查更严格，减少未启用、未配置或不适合当前环境的工具被误触发。 |
| 项目会话体验 | 项目侧栏里的会话链接和主题样式继续打磨，深色/浅色主题下的列表、链接和状态更清楚。 |
| 商店素材 | 补充 Chrome Web Store 使用的图标和宣传图，让商店页面能更准确展示当前产品界面。 |
| 回归覆盖 | 新增 token 速度、用量统计、MCP 执行策略、多模态策略、侧边栏导航和项目侧栏整理测试。 |

</details>

<details>
<summary>展开 1.0.0 变更回顾</summary>

### 1.0.0 变更回顾

1.0.0 是多模态媒体与侧边栏工作台成熟版本，重点让 DeepSeek++ 可以把图片、视频、MCP、本机工具和更清晰的管理界面放进同一条浏览器任务流。

| 方向 | 主要变化 |
|------|----------|
| 多模态媒体 | 安装多模态 Native Host 后，可在 DeepSeek 输入框添加图片或视频，先通过用户配置的 OpenAI / Gemini 分析媒体，再把分析结果带回当前消息继续生成。 |
| 多模态配置 | 侧边栏新增多模态 API 设置，可配置 OpenAI / Gemini Key、模型和请求地址，并通过 MCP 页创建、测试和启用 `多模态` 预设。 |
| 媒体任务稳定性 | 多模态请求会按图片和视频数量扩展等待时间，减少较大媒体或多文件分析在返回前被过早中断的情况。 |
| Artifact 展示 | 生成的 artifact 结果会显示在折叠工具块外部，正文和可下载产物更容易区分和查看。 |
| 侧边栏整理 | 设置页拆分为通用、API、外观、数据、提示词、语音和关于等子页，MCP、工具、Skill、自动化等页面补强加载状态和确认反馈。 |
| UI 一致性 | 工具卡片、Skill 弹窗、注入样式和侧边栏控件继续统一视觉密度、状态反馈和可访问性。 |
| 回归覆盖 | 新增多模态媒体、Native Host 环境、MCP 折叠状态、工具块样式、侧边栏导航和注入主题测试。 |

</details>

<details>
<summary>展开 0.7.5 变更回顾</summary>

### 0.7.5 变更回顾

0.7.5 是 Skill 本地工作流与 Agent 输出稳定性版本，重点让用户可以更稳地导入本机 Skill、整理历史回复，并在自动化和 inline agent 任务里减少重复收尾和认证中断。

| 方向 | 主要变化 |
|------|----------|
| 本地 Skill 管理 | Skill 页新增本机 Skill 预览、导入和同步能力，可把个人或团队本地 Skill 文件夹纳入 DeepSeek++ 工作流。 |
| Skill 预览体验 | 导入前会展示 Skill 名称、说明、来源和可用状态，帮助用户确认内容后再启用。 |
| 历史回复整理 | 已保存历史中的 `task_complete` 工具块会恢复为更自然的摘要，减少旧对话里的技术标记干扰。 |
| 自动化稳定性 | PoW header 改为按需创建，降低自动化任务在运行时因为请求准备时机不一致而中断的概率。 |
| Inline agent 收尾 | inline agent 会复用已有完成摘要，避免任务结束时重复生成最终总结。 |
| 产品资产 | README 和商店素材更新为新的产品截图，侧边栏、工具执行、自动化和项目能力展示更贴近当前界面。 |
| 回归覆盖 | 新增本地 Skill 导入、同步合并、Shell Host 本地预览、历史清理、PoW、inline agent 和注入样式测试。 |

</details>

<details>
<summary>展开 0.7.4 变更回顾</summary>

### 0.7.4 变更回顾

0.7.4 是项目侧边栏与语言体验增强版本，重点让项目对话可以直接在 DeepSeek 历史侧栏中管理，并让中英文界面选择更清晰、更稳定。

| 方向 | 主要变化 |
|------|----------|
| 项目侧边栏 | DeepSeek 历史侧栏新增项目分组入口，可展开项目、查看关联对话，并从侧栏直接打开项目对话。 |
| 对话归档 | 可把当前对话加入项目、从项目移除，或指定下一条新会话使用某个项目上下文，减少整理项目任务时来回切换。 |
| 原生菜单协作 | DeepSeek 原生会话菜单中增加项目操作，选中历史对话后可快速加入或移出项目。 |
| 语言设置 | 设置页新增界面语言区域，可选择跟随浏览器、简体中文或 English，并显示当前生效语言。 |
| 稳定性 | 项目侧栏渲染、菜单点击、历史标题提取和重复刷新处理更稳，降低项目入口闪烁、误隐藏或标题混入时间文本的概率。 |
| 回归覆盖 | 新增项目侧栏管理、原生菜单项目操作、语言文案和历史标题提取测试。 |

</details>

<details>
<summary>展开 0.7.3 变更回顾</summary>

### 0.7.3 变更回顾

0.7.3 是项目上下文和权限收敛稳定性版本，重点让项目指令、项目记忆和相关 DeepSeek 对话更稳定地协作，同时减少 Browser Control 的权限负担，并补强记忆、自动化和长任务续跑的回归覆盖。

| 方向 | 主要变化 |
|------|----------|
| 项目上下文 | 项目指令、项目记忆和已关联对话的上下文使用更稳定，处理项目任务时更少需要重复粘贴背景。 |
| 浏览器控制权限 | Browser Control 不再依赖额外的标签组权限；仍然只有用户启用并选择目标标签页后，才会提供页面文本快照和可见浏览器动作。 |
| 记忆与上下文 | 记忆筛选、项目记忆和提示词准备链路继续收紧，减少上下文缺失、重复或进入错误任务范围的情况。 |
| 自动化与续跑 | 自动化任务状态、长任务续跑和工具结果回传更稳，适合需要多步推进或定时跟踪的工作流。 |
| 流式输出 | 长回复里的工具调用和上下文注入处理更干净，降低技术标记残留到正文或打断正常输出的概率。 |
| 回归覆盖 | 新增和补强项目上下文、项目记忆作用域、浏览器控制权限、同步数据、自动化状态和流式工具文本测试。 |

</details>

<details>
<summary>展开 0.7.2 变更回顾</summary>

### 0.7.2 变更回顾

0.7.2 是浏览器控制和侧边栏体验增强版本，重点让 DeepSeek++ 可以在用户选定的标签页中执行可见网页操作，同时把新权限、第三方 Skill 管理和侧边栏状态反馈讲清楚。

| 方向 | 主要变化 |
|------|----------|
| 浏览器控制 | 可在侧边栏开启 Browser Control、选择目标标签页，并让模型执行导航、点击、输入、等待、上传文件和对话框处理等网页动作。 |
| 权限和隐私边界 | Chrome / Edge 包新增浏览器控制所需权限；功能默认关闭，只有用户启用并选择目标标签页后才会提供页面文本快照和浏览器动作工具。 |
| 侧边栏反馈 | 保存项、项目上下文和提示词控制补强成功、失败、后端不可用等状态提示，操作结果更明确。 |
| Skill 管理 | 第三方 Skill 按来源分组展示，并支持独立启用、停用、检查更新和同步，降低大型 Skill 库的管理成本。 |
| 平台能力 | 当时的能力页会区分浏览器扩展、实验性移动端外壳和不支持平台；移动端外壳现已移除，当前仅支持 PC 端 Chrome、Edge 和 Firefox。 |
| 回归覆盖 | 新增浏览器控制、侧边栏交互、运行时广播、平台能力和 Skill 本地化测试，发布前继续覆盖多浏览器构建与资产校验。 |

</details>

<details>
<summary>展开 0.7.1 变更回顾</summary>

### 0.7.1 变更回顾

0.7.1 是工具调用和上下文注入稳定性版本，重点让长回复、可下载产物、记忆和 Skill 在同一条任务链里更稳地协作，减少流式输出中的卡顿、残留和误判。

| 方向 | 主要变化 |
|------|----------|
| 工具执行稳定性 | 更稳地识别和执行长回复里的工具调用，减少工具块残留在正文、重复触发或等待到完整回复结束才处理的情况。 |
| 可下载产物 | 单文件和项目包产物生成过程更适合流式执行，长内容生成时页面更容易保持可交互。 |
| 记忆与 Skill | 记忆、Skill 和系统提示词在多步续跑和历史整理中更准确地进入任务上下文，减少上下文丢失或重复注入。 |
| 输出观感 | 工具调用内容与普通 Markdown 输出分离更清楚，用户看到的是更干净的回复正文和工具执行结果。 |
| 回归覆盖 | 新增和补强工具解析、流式文本、历史清理、页面执行和产品表面的自动化覆盖，降低长任务回归风险。 |
| 发布质量 | 构建工具依赖归回开发依赖，生产依赖审计恢复为 0 漏洞；发布资产校验继续覆盖 Chrome、Edge、Firefox 和源码包。 |

</details>

<details>
<summary>展开 0.7.0 变更回顾</summary>

### 0.7.0 变更回顾

0.7.0 的主线是把 DeepSeek++ 从 DeepSeek 网页增强，推进到可持续工作的浏览器内 AI Agent 工作台：上下文可以沉淀，输出可以下载，工具执行可以被用户审查、接管和复盘。

| 方向 | 主要变化 |
|------|----------|
| 项目上下文 | 将项目指令、项目记忆和相关 DeepSeek 对话组织在一起，让对应对话自动带入项目背景。 |
| 可下载产物 | 生成单文件或项目包下载产物，适合保存脚本、Markdown、JSON、HTML、小型原型或文档集合。 |
| 交互式工具 | 沙箱确认、Skill 草稿、记忆导入预览、保存片段和提示词控制集中收口，多步任务更容易检查、修改和接管。 |
| 工作台体验 | 侧边栏对话、右键场景、官方 API Key 配置、工具结果恢复和页面导航继续打磨，刷新后工具块和 Agent 运行块仍会回到对应回复下方。 |
| Agent 反馈 | Agent 步骤内容支持流式 Markdown 渲染，表格、标题和重点内容会在生成过程中逐步成形，长输出会自动跟随最新进展。 |
| 复盘整理 | 保存项、历史标签/搜索、代码块下载、单消息导出和图片附件清单让对话材料更容易整理、迁移和复用。 |
| 发布质量 | 新版本提示按版本记忆关闭状态；发布前继续覆盖中英文、本地工具、MCP、自动化、多浏览器打包和 release 资产校验。 |

</details>

<details>
<summary>展开 0.6.5 变更回顾</summary>

### 0.6.5 变更回顾

0.6.5 是中英文运行体验和输出反馈校准版本，重点让 DeepSeek++ 在中文或英文环境下保持一致的操作语言，并让实时输出速度显示更贴近实际生成状态。

| 方向 | 主要变化 |
|------|----------|
| 中英文体验 | 设置页语言选择继续扩展到侧边栏、右键菜单、工具结果、内置 Skill 和模型续跑提示，让中文或英文工作流保持一致。 |
| 语言保持 | 用户创建的记忆、预设、自定义 Skill、自动化任务和同步数据继续保留原文，不会因为切换界面语言被改写。 |
| 输出速度 | `tok/s` 估算按更贴近 DeepSeek 输出特征的方式校准，并从首个流式内容后开始计速，减少排队和预填充延迟造成的偏差。 |
| 商店安装体验 | README 和商店材料同步 Chrome Web Store 可用状态，并保持 Shell MCP 与本机工具安装说明清晰可见。 |
| 发布保障 | 新增多语言覆盖校验，发布前继续覆盖编译、单测、MCP、自动化、提示词冻结、多浏览器打包、workflow 和资产校验。 |

感谢本版本贡献者：[@mekos2772](https://github.com/mekos2772) 修复 Token 输出速度估算偏差。

</details>

<details>
<summary>展开 0.6.4 变更回顾</summary>

### 0.6.4 变更回顾

0.6.4 是侧边栏对话和本机工具增强版本，重点让普通网页里的 DeepSeek++ 对话入口更独立，也让 Shell MCP 支持 Python 解释器工作流。

| 方向 | 主要变化 |
|------|----------|
| 官方 API Key 对话 | 配置 API Key 后，侧边栏对话和右键场景可以在普通网页使用，不再只依赖 DeepSeek 页面登录态。 |
| 右键场景 | 选中文本后可直接发送到侧边栏对话或套用自定义场景，适合跨网页总结、解释和改写。 |
| Python 解释器工具 | Shell MCP 新增 `python_exec` 能力，并在侧边栏工具页提供更清晰的启用、权限和状态管理。 |
| 本机工具稳定性 | Shell Host 的工具协议、执行策略和烟测覆盖同步增强，减少本机命令与解释器工具的状态差异。 |
| 中英文体验 | 设置页新增语言选择，侧边栏、右键菜单、工具结果、内置 Skill 和模型续跑提示可跟随中文或英文环境。 |
| 发布保障 | 开发依赖漏洞完成修复，发布前继续覆盖多浏览器打包、MCP、自动化、多语言校验、workflow 和资产校验。 |

感谢本版本贡献者：[@IjalG](https://github.com/IjalG) 贡献 Python interpreter / `python_exec` 能力。

</details>

<details>
<summary>展开 0.6.3 变更回顾</summary>

### 0.6.3 变更回顾

0.6.3 是对话导出入口收口版本，重点把导出操作放回 DeepSeek 回复工具栏，让归档当前对话更贴近日常阅读和整理流程。

| 方向 | 主要变化 |
|------|----------|
| 回复工具栏导出 | 在 DeepSeek 回复下方的官方操作按钮同一排选择导出格式，不再需要切到单独侧边栏页面。 |
| 导出格式 | 当前对话可导出为 HTML、Markdown 或 PDF 文件，适合阅读、归档和分享前整理。 |
| 归档质量 | 文件名、附件引用、消息元数据和可读模式继续收敛，导出内容更容易检索和长期保存。 |
| 隐私说明 | 商店文案和隐私说明同步到本地下载口径，明确导出文件通过浏览器本地保存。 |
| 测试保障 | 对话导出测试覆盖回复工具栏入口、格式选择、命名和 PDF 导出路径。 |

</details>

<details>
<summary>展开 0.6.2 变更回顾</summary>

### 0.6.2 变更回顾

0.6.2 是对话导出和跨平台 Shell 体验增强版本，重点让用户可以本地归档 DeepSeek 对话，并提升 Windows 本机命令链路的稳定性。

| 方向 | 主要变化 |
|------|----------|
| 对话导出 | 可把当前 DeepSeek 对话导出为 HTML、Markdown 或 PDF 文件。 |
| 归档质量 | 导出内容支持可读模式和原始模式，并记录附件引用、文件名、大小、状态和消息关联。 |
| Shell MCP | Windows Shell Host 的路径解析和中文输出更可靠，减少本机命令执行时的乱码和找不到命令问题。 |
| 测试保障 | 新增 Vitest 单元测试覆盖请求增强、MCP 传输、记忆工具、同步 schema、Shell policy 和导出流程。 |
| 发布保障 | Release workflow 会在发布前校验版本一致性，并确认 Shell Host npm 包可见后再上传浏览器扩展资产。 |

</details>

<details>
<summary>展开 0.6.1 变更回顾</summary>

### 0.6.1 变更回顾

0.6.1 是自动化、Shell MCP 和侧边栏整理版本，重点提升定时任务可靠性、本机命令执行体验，以及侧边栏能力入口的可发现性。

| 方向 | 主要变化 |
|------|----------|
| 自动化任务 | 定时任务现在会接入浏览器后台调度，适合持续追踪主题、固定提醒和周期性检查。 |
| Shell MCP | Windows 环境下的命令执行和 OfficeCLI / Shell 技能提示更一致，减少跨平台使用时的路径与命令差异。 |
| 侧边栏导航 | 能力相关入口整合到统一页面，侧边栏结构更清晰，查找 MCP、工具、Skill 和自动化能力更直接。 |
| 多语言文档 | README 增加英文入口，便于英文用户快速了解安装方式和核心能力。 |
| 发布保障 | 多浏览器发布包和源码包的校验更完整，降低缺包或版本不一致的发布风险。 |

</details>

<details>
<summary>展开 0.6.0 变更回顾</summary>

### 0.6.0 变更回顾

0.6.0 是侧边栏对话和 Skill 工作流增强版本，重点让 DeepSeek++ 从增强网页对话，推进到可在侧边栏直接发起任务、管理自定义 Skill 并从 GitHub 导入 Skill。

| 方向 | 主要变化 |
|------|----------|
| 侧边栏对话 | 设置页启用后，侧边栏新增「对话」页，可直接发消息、新建会话并流式查看回复。 |
| 右键场景 | 选中网页文本后可右键发送到侧边栏对话，也可套用自定义场景模板。 |
| Skill 管理 | 自定义 Skill 支持编辑、启用、停用和删除，便于持续维护本地技能库。 |
| GitHub 导入 | 支持从 GitHub 仓库、目录或单个 `SKILL.md` 预览并导入第三方 Skill。 |
| 网页获取权限 | `web_fetch` 支持在需要时按站点授权，也可以在工具页批量授权网页来源。 |
| 工具结果展示 | 修复工具输出归属到错误回复节点的问题，减少续跑过程中的结果错位。 |

感谢本版本贡献者：[@todayzhou](https://github.com/todayzhou) 贡献侧边栏对话与右键场景，[@IjalG](https://github.com/IjalG) 贡献 `web_fetch` 授权体验。

</details>

<details>
<summary>展开 0.5.1 变更回顾</summary>

### 0.5.1 变更回顾

0.5.1 是内置网络工具版本，重点让 DeepSeek 在需要实时信息或网页内容时能直接搜索、获取并继续生成。

| 方向 | 主要变化 |
|------|----------|
| 内置网络工具 | 新增 `web_search` 和 `web_fetch`，支持联网搜索与网页文本获取。 |
| Agent 式续跑 | 网络工具结果会回传到同一会话继续生成，搜索后可自动整理最终回答。 |
| 工具管理 | 侧边栏新增「工具」页，可开关网络工具、授权网页来源并运行搜索诊断。 |
| 搜索稳定性 | 搜索结果为空时会继续尝试可用搜索源，避免把不可解析页面误判为成功。 |
| 提示一致性 | 只有启用 `web_search` 时才注入搜索规则，关闭工具后不会继续诱导模型调用。 |
| 输出展示 | 修复工具续跑完成后的重复正文渲染，保留步骤记录并只展示一次最终回答。 |

</details>

<details>
<summary>展开 0.5.0 变更回顾</summary>

### 0.5.0 变更回顾

0.5.0 是自动化与工具续跑稳定版本，重点提升长任务承接、历史展示清洁度和侧边栏加载体验。

| 方向 | 主要变化 |
|------|----------|
| 自动化任务 | 自动化运行完成后会保存更可靠的会话链接、父消息和历史快照，后续继续运行更稳。 |
| 工具续跑 | 自动化任务和手动 Agent 式续跑使用一致的工具执行与结果回传节奏，减少长任务中的状态差异。 |
| 历史展示 | 会话历史和本地缓存会统一隐藏内部提示词与原始工具调用标记，同时保留可恢复的工具执行记录。 |
| 响应反馈 | 输出速度显示在流式回复和兼容请求路径中保持一致，减少速度状态残留。 |
| 侧边栏性能 | 记忆、Skill、预设、自动化、MCP 和设置页面按需加载，侧边栏初次打开更轻。 |
| 发布保障 | 新增提示词冻结检查，发布前确认关键系统提示、工具格式和续跑提示没有被无意改写。 |

</details>

<details>
<summary>展开 0.4.4 变更回顾</summary>

### 0.4.4 变更回顾

0.4.4 是 Shell MCP 商店安装体验修复版本，重点让通过浏览器商店安装的用户也能按侧边栏提示完成本机 Shell Host 配置。

| 方向 | 主要变化 |
|------|----------|
| Shell MCP 安装 | 新增 `deepseek-pp-shell-host` npm installer，用户可通过 `npx deepseek-pp-shell-host install ...` 安装 Shell Native Host。 |
| 商店用户路径 | Shell Host 安装到用户目录，不再依赖插件源码目录；Chrome、Edge、Chromium 和 Firefox 都有对应安装命令。 |
| 侧边栏提示 | MCP 页会自动填入当前扩展 ID，并对 Native Host 已安装但扩展 ID 未授权的情况给出明确提示。 |
| 文档与发布 | README、Chrome Web Store 文案和 MCP 操作说明同步为用户安装路径，源码安装命令仅作为开发者入口保留。 |

</details>

<details>
<summary>展开 0.4.3 变更回顾</summary>

### 0.4.3 变更回顾

0.4.3 是长任务稳定性和互动反馈增强版本，重点改善 DeepSeek 校验兼容、Agent 式持续执行节奏和悬浮宠物状态反馈。

| 方向 | 主要变化 |
|------|----------|
| DeepSeek 校验兼容 | 更新本地校验计算方式，减少长任务、自动化和工具续跑过程中因平台校验失败而中断的情况。 |
| Agent 式持续执行 | 多步续跑会在连续请求之间自动留出间隔；空续跑会显式失败并保留已有步骤状态，长任务更可控。 |
| 悬浮宠物 | DeepSeek 小鲸鱼新增状态台词气泡，会在思考、输出、工具执行和空闲状态展示并轮播反馈。 |
| Issue 入口 | 新增标准 issue 表单和模板检查，未填写必要信息的问题会自动关闭并提示补充。 |
| 发布文档 | README 新增 0.4.3 变更回顾，并将 0.4.2 / 0.4.1 / 0.4.0 / 0.3.0 / 0.2.0 继续保留为折叠历史。 |

</details>

<details>
<summary>展开 0.4.2 变更回顾</summary>

### 0.4.2 变更回顾

0.4.2 是发布准备和隐私展示增强版本，重点补齐 Chrome Web Store 提交材料，并收口内部提示词在页面与历史记录中的可见性。

| 方向 | 主要变化 |
|------|----------|
| Chrome Web Store | 新增商店上架文案、隐私政策、提交流程、截图资产和 Chrome 包上传 workflow，为正式提交审核做准备。 |
| 隐私展示 | 页面和历史记录只保留用户可见提示与工具结果，避免内部提示词、工具格式提醒等扩展指令被回显。 |
| 工具解析 | 流式回复解析更严格区分真实回复文本和非回复事件，减少内部上下文误参与工具调用解析的情况。 |
| 发布文档 | README 新增 0.4.2 变更回顾，并将 0.4.1 / 0.4.0 / 0.3.0 / 0.2.0 继续保留为折叠历史。 |

</details>

<details>
<summary>展开 0.4.1 变更回顾</summary>

### 0.4.1 变更回顾

0.4.1 是基于 0.4.0 的体验增强版本，重点引入 DeepSeek 页面悬浮宠物，并把 README 的版本历史继续保持为可折叠回顾。

| 方向 | 主要变化 |
|------|----------|
| 悬浮宠物 | 新增「DeepSeek 小鲸鱼」悬浮宠物，可在 DeepSeek 页面跟随思考、输出、工具执行、成功和失败状态展示不同反馈。 |
| 个性化设置 | 设置页新增宠物开关、左下/右下位置、拖动自定义位置、尺寸、透明度和动态漂浮控制。 |
| 状态持久化 | 宠物开关、位置和外观配置保存在浏览器本地，刷新页面后保持用户选择。 |
| 发布文档 | README 新增悬浮宠物功能介绍和 0.4.1 变更回顾，并保留 0.4.0 / 0.3.0 / 0.2.0 的折叠历史。 |

</details>

<details>
<summary>展开 0.4.0 变更回顾</summary>

### 0.4.0 变更回顾

0.4.0 延续 0.3.0 的多浏览器发布基线，重点补齐本机 Shell / Office 文档工具、Agent 式持续执行、自动化任务触发、速度显示和稳定性修复。

| 方向 | 主要变化 |
|------|----------|
| OfficeCLI 文档工具 | 内置 OfficeCLI 第三方 Skill 与样式库，新增 Shell MCP 预设和安装脚本，让 DeepSeek 可以通过本机命令版 OfficeCLI 检查、读取、修改和验证 Office 文件。 |
| Agent 式持续执行 | MCP 工具结果可以回传到同一会话继续生成，让 DeepSeek 像 Claude Code / Codex 一样根据执行结果持续决定下一步；页面按 Step 折叠展示连续执行过程，并支持停止与刷新恢复。 |
| 输出速度显示 | 回复生成时显示实时 `tok/s`，更容易判断当前会话的输出状态。 |
| 自动化任务 | 自动化负责手动或定时触发任务，继续支持独立会话、立即运行、cron/RRULE 调度、暂停/编辑/删除，并可复用 Agent 式续跑链路。 |
| 稳定性修复 | 修复流式取消、计时器清理、工具解析计数、多片段偏移和工具记录恢复等问题，减少长任务中的重复执行和状态丢失。 |
| 验证脚本 | 补充 Shell MCP smoke check、MCP mock 验证和工具续跑契约检查，发布前覆盖编译、构建、打包和本机工具链路。 |

</details>

<details>
<summary>展开 0.3.0 变更回顾</summary>

### 0.3.0 变更回顾

0.3.0 以 0.2.0 的 MCP 和自动化平台为基线，重点把扩展从 Chrome 单目标发布推进到 Chrome / Edge / Firefox 多浏览器交付，并补齐主题一致性、版本展示和发布资产链路。

| 方向 | 主要变化 |
|------|----------|
| 跨浏览器支持 | 新增 Chrome、Edge、Firefox MV3 构建与打包脚本；manifest 会按目标浏览器生成权限、侧栏入口和 Firefox 标识，避免把 Chromium-only 能力发到 Firefox。 |
| 发布流程 | Release workflow 改为一次上传 Chrome / Edge / Firefox / sources 多个 zip；安装文档、MCP 操作说明和 mock 验证说明也改成浏览器中立口径。 |
| 侧边栏体验 | 侧边栏顶部导航改为稳定 tab 组件，补齐图标、当前页语义和紧凑布局，适配更多浏览器侧栏宽度。 |
| 深浅色一致性 | DeepSeek 页面主题会同步到侧边栏；记忆、MCP、设置、Skill 弹窗、工具执行卡片和自定义背景遮罩都适配明暗主题。 |
| 版本一致性 | `package.json`、lockfile、manifest 和运行时展示同步到 0.3.0；侧边栏右上角、设置页底部和 MCP clientInfo 都从扩展 manifest 读取版本。 |
| 文档归档 | 将 MCP rollout 文档迁入归档目录，新增 Edge/Firefox 支持归档，保留验证记录和后续手动测试线索。 |

</details>

<details>
<summary>展开 0.2.0 变更回顾</summary>

### 0.2.0 变更回顾

0.2.0 汇总了 0.1.0 以来的主要增量，重点是把 DeepSeek++ 从“记忆 + Skill”扩展升级为完整的浏览器端工具平台。

| 方向 | 主要变化 |
|------|----------|
| MCP 工具系统 | 新增 MCP 服务配置、工具发现、健康检查、调用历史、结果大小限制和超时控制；手动聊天和自动化任务都能自动执行 MCP 工具并把结果回传到同一会话。 |
| 工具调用内核 | 从固定记忆工具扩展为动态工具契约；工具 schema、解析、流式过滤、历史清理和 prompt 注入都支持内置工具与 MCP 工具。 |
| 自动化任务 | 新增侧边栏自动化页、任务编辑器、立即运行、cron/RRULE 调度、暂停/恢复、独立 DeepSeek 会话、运行历史和失败状态展示。 |
| 记忆系统 | 新增记忆更新/删除工具，优化相关记忆筛选、思考模式、自动清理和工具执行折叠展示，刷新页面后能恢复刚执行过的工具状态。 |
| Skill 与预设 | 新增 `/skill` 自动补全面板、内置/自定义技能管理、系统提示词预设、预设导入，以及 DeepSeek Expert 模式切换。 |
| 同步与个性化 | 新增 WebDAV 同步记忆、Skill 和预设；新增 DeepSeek 页面自定义背景、动态透明度和模糊控制。 |
| 文档与发布 | 增补侧边栏截图、MCP 操作说明、mock 验证脚本、TypeScript 修复、release workflow 和构建打包流程。 |

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.png" width="300" alt="MCP 管理侧边栏">
  <img src="assets/screenshot-sidepanel-automation.png" width="300" alt="自动化任务侧边栏">
</p>

</details>

</details>

## 安装

### 从 Chrome Web Store 安装

Chrome 用户可以直接从 [Chrome Web Store](https://chromewebstore.google.com/detail/deepseek++/kdmpkkahkhdmdhfkdihkopikgcocbpbf?hl=zh-CN) 安装 DeepSeek++。安装后打开 [DeepSeek 网页版](https://chat.deepseek.com)，即可在侧边栏中按需启用记忆、Skill、MCP、联网工具、对话导出和自动化能力。

如果需要 Shell MCP 或本机文件工具，再按侧边栏 `MCP` 页提示安装 Shell Native Host。

### 从源码构建

```bash
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build
```

默认 `npm run build` 生成 Chrome MV3 产物。跨浏览器构建：

```bash
npm run build:chrome
npm run build:edge
npm run build:firefox
npm run build:all
```

当前产品仅支持 PC 端 Chrome、Edge 和 Firefox，不提供 Android 或其他移动端安装包。

Shell MCP host 的 smoke check：

```bash
npm run smoke:shell
```

| 浏览器 | 加载入口 | 构建目录 |
|--------|----------|----------|
| Chrome | `chrome://extensions/` → 加载已解压的扩展程序 | `dist/chrome-mv3/` |
| Edge | `edge://extensions/` → 加载解压缩的扩展 | `dist/edge-mv3/` |
| Firefox | `about:debugging#/runtime/this-firefox` → 临时载入附加组件 | `dist/firefox-mv3/manifest.json` |

## 友情链接

- [OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) — AI-friendly CLI for Office 文档处理
- [1flowbase](https://github.com/taichuy/1flowbase) — 开源虚拟模型网关，可将多模型工作流发布为 OpenAI / Claude 兼容端点
- [FrontAgent](https://github.com/FrontAgent/FrontAgent) — 面向前端工程的 AI Agent 平台，支持 RAG、Skills、SDD、MCP、CLI 和 VS Code 插件等能力
- [MuseAI](https://github.com/yejiming/MuseAI) — AI 角色与故事互动项目，可创建角色、进入故事世界并持续互动
- [Spec Driven Develop](https://github.com/zhu1090093659/spec_driven_develop) — 面向 AI 编程代理的规范驱动开发方法
- [Awesome-Prompts 角色扮演](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) — 精选角色扮演 Prompt 合集
- [LINUX DO](https://linux.do) — 新一代开源技术社区

## License

Apache-2.0
