# DeepSeek++ - DeepSeek 浏览器插件与 AI Agent 工具平台

DeepSeek++ 是面向 [DeepSeek](https://chat.deepseek.com) 网页版的 Chrome / Edge / Firefox 浏览器扩展，为 DeepSeek 注入 **侧边栏对话**、**类原生工具调用**、**内置网络工具**、**MCP 工具系统**、**Agentic 记忆系统**、**Skill 技能系统**、**系统提示词预设**、**Agent 式持续执行** 和 **自动化任务**。

English: DeepSeek++ is a DeepSeek browser extension for AI agent workflows, long-term memory, MCP tools, web search, Skills, system prompts, automation, and side-panel chat.

让 DeepSeek 像支持原生 tools 一样自动执行记忆保存、更新、删除、网络搜索、网页获取和 MCP 工具调用，拥有跨对话长期记忆，并通过 `/skill` 指令一键切换专家模式。侧边栏可以直接发起对话，也可以把网页选中文本送入对话；Agent 式持续执行让模型像 Claude Code / Codex 一样，在工具调用、结果回传和下一步生成之间持续推进任务；自动化任务则负责把固定任务放进独立会话里立即触发或按计划触发。

## 目录

- [功能速览](#功能速览)
- [适合场景](#适合场景)
- [核心功能](#核心功能)
- [0.6.0 变更回顾](#060-变更回顾)
- [安装](#安装)
- [友情链接](#友情链接)

## 功能速览

| 需求 | DeepSeek++ 提供 |
|------|----------------|
| DeepSeek Chrome extension / DeepSeek 浏览器插件 | 在 DeepSeek 网页版中加入侧边栏对话、右键发送文本、工具执行结果展示和多浏览器支持。 |
| DeepSeek MCP tools | 在侧边栏管理 MCP 服务、工具权限和执行状态，并把工具结果带回同一会话继续生成。 |
| DeepSeek memory / 长期记忆 | 自动保存、筛选和注入长期记忆，让不同对话可以复用用户偏好、项目背景和常用信息。 |
| DeepSeek Skills / `/skill` 工作流 | 通过内置、自定义或 GitHub 导入的 Skill 快速切换专家模式和任务模板。 |
| DeepSeek automation / 自动化任务 | 把固定任务放入独立 DeepSeek 会话，支持立即运行、定时触发、状态追踪和手动停止。 |
| DeepSeek web search / 网页获取 | 在需要实时信息或指定网页内容时搜索互联网、读取网页文本，并继续生成最终回答。 |

## 适合场景

- 希望把 DeepSeek 网页版扩展成带工具调用、MCP、记忆和自动化能力的 AI agent 工作台。
- 希望在 Chrome、Edge 或 Firefox 中直接使用 DeepSeek 侧边栏对话、网页文本发送和固定场景 prompt。
- 希望把项目背景、个人偏好、常用工作流和文档处理能力沉淀为长期记忆与可复用 Skill。
- 希望让 DeepSeek 处理需要多步工具执行、联网搜索、网页读取或定时跟踪的任务。

## 核心功能

### 侧边栏对话

- **可选对话入口** — 在设置页启用后，侧边栏会显示「对话」页，可直接向 DeepSeek 发消息
- **右键发送文本** — 在网页中选中文本后右键发送到侧边栏对话，适合快速解释、总结或改写页面内容
- **右键场景** — 可以配置常用场景模板，把选中文本套入固定 prompt 后送入对话
- **独立新会话** — 侧边栏对话支持新建会话，减少和当前页面已有对话互相干扰
- **流式展示** — 回复会在侧边栏内持续渲染，登录状态缺失时会提示先回到 DeepSeek 页面完成登录

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
  <img src="assets/screenshot-inline-tools.svg" width="720" alt="工具续跑与速度显示">
</p>

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
- **本地安全** — MCP 配置和密钥保存在浏览器本地，WebDAV 同步不会同步敏感信息

<p align="center">
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP 管理侧边栏">
</p>

### OfficeCLI 文档工具

- **内置 `/officecli` skill** — 面向 `.docx`、`.xlsx`、`.pptx` 的检查、问题定位、验证和受控修改流程
- **官方 Skill 库** — 内置 OfficeCLI 官方的 DOCX、XLSX、PPTX、Pitch Deck、Academic Paper、Financial Model、Dashboard、Morph PPT 等场景技能
- **官方样式库** — 内置 OfficeCLI 官方 PPT styles 索引和样式说明，可用 `/officecli-pptx /officecli-styles ...` 链式加载完整视觉风格
- **通过 Shell MCP 执行** — 侧边栏创建 `Shell` 预设后，模型通过 `shell_exec` 调用本机命令版 OfficeCLI
- **自动安装命令版** — `deepseek-pp-shell-host` 会按系统和 CPU 架构从 iOfficeAI/OfficeCLI 官方发布资产安装单二进制
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

- **内置技能** — 预设多组开箱即用的技能，包含通用协作技能和 OfficeCLI 官方文档技能
- **自定义技能** — 在侧边栏创建专属技能，定义系统指令和参数
- **GitHub 导入** — 支持从 GitHub 仓库、目录或单个 `SKILL.md` 链接预览并导入第三方 Skill
- **来源与更新** — GitHub 导入的 Skill 会显示来源仓库、版本、license、同步时间，并支持检查和同步上游更新
- **启用控制** — 自定义和 GitHub 导入的 Skill 可以单独启用、停用或删除，不影响本地其他 Skill
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
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="自动化任务侧边栏">
</p>

## 0.6.0 变更回顾

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
| OfficeCLI 文档工具 | 内置 OfficeCLI 官方 Skill 与样式库，新增 Shell MCP 预设和安装脚本，让 DeepSeek 可以通过本机命令版 OfficeCLI 检查、读取、修改和验证 Office 文件。 |
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
  <img src="assets/screenshot-sidepanel-mcp.svg" width="300" alt="MCP 管理侧边栏">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="自动化任务侧边栏">
</p>

</details>

## 安装

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
- [Spec Driven Develop](https://github.com/zhu1090093659/spec_driven_develop) — 面向 AI 编程代理的规范驱动开发方法
- [Awesome-Prompts 角色扮演](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) — 精选角色扮演 Prompt 合集
- [LINUX DO](https://linux.do) — 新一代开源技术社区

## License

MIT
