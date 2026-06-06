# DeepSeek++ Privacy Policy

Effective date: 2026-06-06

DeepSeek++ is a browser extension that enhances the DeepSeek web app with user-controlled memory, skills, prompt presets, MCP tools, inline tool execution, conversation export, and automation.

This Privacy Policy explains what data the extension handles, how that data is used, when it may be transferred, and what controls users have.

## 1. Single Purpose

DeepSeek++ has one purpose: to enhance the DeepSeek web chat experience on `chat.deepseek.com` with memory, skills, presets, tools, conversation export, and automation that the user controls.

## 2. Data Handled by the Extension

DeepSeek++ may handle the following data only when needed for its user-facing features:

- DeepSeek conversation content, including prompts, model responses, and tool-call text shown on `chat.deepseek.com`.
- User-created extension data, including memories, skills, prompt presets, MCP server settings, automation tasks, theme settings, background settings, pet settings, and tool execution history.
- Optional WebDAV sync settings, including server URL, username, password, remote path, and sync state, when the user configures WebDAV sync.
- Optional MCP configuration, including endpoint URLs, request headers, environment variables, native host names, discovered tool metadata, and tool results, when the user configures MCP tools.
- DeepSeek session data available to the web page, only when needed to submit user-requested automation or continuation prompts.
- DeepSeek conversation history and attachment metadata when the user explicitly starts a local conversation export.

DeepSeek++ does not intentionally collect financial information, health information, precise location, payment information, or browsing history.

## 3. How Data Is Used

DeepSeek++ uses handled data only to provide its disclosed features:

- Store and retrieve local memories, skills, presets, settings, tasks, MCP configuration, and tool history.
- Select relevant memories, skills, presets, and tool definitions for injection into DeepSeek prompts.
- Detect tool-call markup in DeepSeek responses, execute enabled tools, and render readable tool results.
- Return selected tool results to the active DeepSeek conversation when the user enables tool execution.
- Run automation tasks created by the user.
- Export the user's DeepSeek conversation history into local files when the user starts an export from the side panel.
- Sync memories, custom skills, and presets to a user-configured WebDAV server when sync is enabled.
- Connect to user-configured MCP endpoints or Native Messaging hosts when the user tests or executes those tools.

The extension does not use handled data for advertising, user profiling for advertising, credit decisions, or unrelated analytics.

## 4. Local Storage

Most extension data is stored locally in the user's browser using extension storage and IndexedDB. This includes memories, custom skills, presets, settings, automation tasks, MCP configuration, and tool execution history.

Conversation export artifacts are created only after the user starts an export and are saved through the browser's local download flow. DeepSeek++ does not upload exported conversation files.

Local data remains in the browser until the user edits or deletes it, clears browser extension data, or uninstalls the extension.

## 5. Data Transfer and Sharing

DeepSeek++ does not operate a backend service for collecting extension data. The extension does not sell user data.

Data may be transferred only as part of user-facing features:

- To DeepSeek, when the user sends a chat message, runs an automation task, or allows the extension to return selected context or tool results to a DeepSeek conversation.
- To a WebDAV server selected and configured by the user, when the user enables sync.
- To MCP endpoints selected and configured by the user, when the user tests or executes MCP tools.
- To a local Native Messaging host configured by the user, when local/native MCP tooling is enabled.

The extension does not transfer user data to advertising platforms, data brokers, information resellers, or unrelated third parties.

## 6. Permissions

DeepSeek++ requests these Chrome permissions for the following purposes:

- `storage`: store local memories, skills, presets, settings, automation tasks, MCP configuration, and tool history.
- `alarms`: schedule and wake user-created automation tasks.
- `nativeMessaging`: connect to user-configured local MCP/native hosts.
- `sidePanel`: provide the extension management UI in Chrome's side panel.
- `*://chat.deepseek.com/*`: run on the DeepSeek web app so the extension can inject selected context, detect tool-call markup, render tool results, export user-requested conversation history, and support automation inside DeepSeek conversations.
- Optional `http://*/*` and `https://*/*` host permissions: connect to user-configured WebDAV or MCP endpoints. These permissions are requested for specific origins when needed.

## 7. User Controls

Users can manage extension data from the DeepSeek++ side panel. Users can:

- View, create, edit, export, import, and delete memories.
- Export DeepSeek conversation history as local JSON, Markdown, or print-ready HTML files.
- Create, edit, and delete custom skills and prompt presets.
- Enable, disable, test, edit, and delete MCP servers.
- Create, pause, run, edit, and delete automation tasks.
- Configure or remove WebDAV sync settings.
- Clear or change visual settings such as background and pet preferences.
- Remove the extension or clear browser extension data through Chrome.

## 8. Security

DeepSeek++ stores extension data locally in the browser by default. Users should only configure trusted WebDAV servers, MCP endpoints, and Native Messaging hosts. HTTPS endpoints are recommended for remote WebDAV and MCP connections.

The extension does not hardcode third-party credentials. Optional credentials are provided by the user and stored for the features the user configures.

## 9. Chrome Web Store Limited Use

DeepSeek++ complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data handled by the extension is used only for the extension's disclosed, user-facing features.

DeepSeek++ does not:

- Sell user data.
- Use user data for personalized advertising.
- Transfer user data to advertising platforms, data brokers, or information resellers.
- Use user data for purposes unrelated to memory, skills, tools, automation, sync, or extension settings.

## 10. Children

DeepSeek++ is not directed to children and does not knowingly collect personal information from children.

## 11. Changes to This Policy

This Privacy Policy may be updated when extension features, permissions, or data practices change. The effective date at the top of this document will be updated when material changes are made.

## 12. Contact

For privacy or support questions, open an issue at:

`https://github.com/zhu1090093659/deepseek-pp/issues`

---

# DeepSeek++ 隐私政策（中文参考）

生效日期：2026-06-06

DeepSeek++ 是一个浏览器扩展，用于在 DeepSeek 网页版中提供用户可控的长期记忆、技能、提示词预设、MCP 工具、内联工具执行、对话导出和自动化任务。

本隐私政策说明扩展会处理哪些数据、如何使用这些数据、何时可能传输数据，以及用户可以如何控制自己的数据。

## 1. 单一用途

DeepSeek++ 的单一用途是在 `chat.deepseek.com` 上增强 DeepSeek 网页聊天体验，提供由用户控制的记忆、技能、预设、工具、对话导出和自动化能力。

## 2. 扩展处理的数据

DeepSeek++ 只会在提供用户可见功能所需时处理以下数据：

- DeepSeek 对话内容，包括 `chat.deepseek.com` 上的提示词、模型回复和工具调用文本。
- 用户创建的扩展数据，包括记忆、技能、提示词预设、MCP 服务设置、自动化任务、主题设置、背景设置、宠物设置和工具执行历史。
- 用户配置 WebDAV 同步时提供的同步设置，包括服务器地址、用户名、密码、远程路径和同步状态。
- 用户配置 MCP 工具时提供的 MCP 配置，包括端点地址、请求头、环境变量、本机 host 名称、工具元数据和工具结果。
- DeepSeek 网页会话中可用的会话数据，仅在执行用户请求的自动化任务或续跑提示词时使用。
- 用户明确开始本地对话导出时读取的 DeepSeek 对话历史和附件元数据。

DeepSeek++ 不会有意收集金融信息、健康信息、精确位置、支付信息或浏览历史。

## 3. 数据用途

DeepSeek++ 只会将数据用于已经披露的功能：

- 保存和读取本地记忆、技能、预设、设置、任务、MCP 配置和工具历史。
- 为 DeepSeek 提示词选择并注入相关记忆、技能、预设和工具定义。
- 识别 DeepSeek 回复中的工具调用标记，执行已启用的工具，并展示可读的工具结果。
- 在用户启用工具执行时，将选定工具结果回传到当前 DeepSeek 对话。
- 运行用户创建的自动化任务。
- 在用户从侧边栏主动开始导出时，将 DeepSeek 对话历史导出为本地文件。
- 在用户启用同步时，将记忆、自定义技能和预设同步到用户配置的 WebDAV 服务器。
- 在用户测试或执行工具时，连接用户配置的 MCP 端点或 Native Messaging host。

扩展不会将数据用于广告、广告画像、信用决策或无关分析。

## 4. 本地存储

大多数扩展数据默认通过浏览器扩展存储和 IndexedDB 保存在用户浏览器本地，包括记忆、自定义技能、预设、设置、自动化任务、MCP 配置和工具执行历史。

对话导出文件只会在用户主动开始导出后生成，并通过浏览器本地下载流程保存。DeepSeek++ 不会上传导出的对话文件。

本地数据会保留到用户编辑或删除、清除浏览器扩展数据，或卸载扩展为止。

## 5. 数据传输与共享

DeepSeek++ 不运营用于收集扩展数据的后台服务。扩展不会出售用户数据。

数据只会在用户可见功能需要时传输：

- 当用户发送聊天消息、运行自动化任务，或允许扩展将选定上下文/工具结果回传到 DeepSeek 对话时，传输给 DeepSeek。
- 当用户启用同步时，传输给用户选择并配置的 WebDAV 服务器。
- 当用户测试或执行 MCP 工具时，传输给用户选择并配置的 MCP 端点。
- 当用户启用本机/Native MCP 工具时，传输给用户配置的本地 Native Messaging host。

扩展不会将用户数据传输给广告平台、数据经纪商、信息转售商或无关第三方。

## 6. 权限说明

DeepSeek++ 请求以下 Chrome 权限：

- `storage`：保存本地记忆、技能、预设、设置、自动化任务、MCP 配置和工具历史。
- `alarms`：调度和唤醒用户创建的自动化任务。
- `nativeMessaging`：连接用户配置的本地 MCP/native host。
- `sidePanel`：在 Chrome 侧边栏中提供扩展管理界面。
- `*://chat.deepseek.com/*`：在 DeepSeek 网页版中运行，用于注入用户选择的上下文、识别工具调用标记、展示工具结果、导出用户主动请求的对话历史，并支持 DeepSeek 对话内的自动化。
- 可选的 `http://*/*` 和 `https://*/*` 主机权限：连接用户配置的 WebDAV 或 MCP 端点。扩展只会在需要时针对具体来源请求权限。

## 7. 用户控制

用户可以在 DeepSeek++ 侧边栏中管理扩展数据，包括：

- 查看、创建、编辑、导出、导入和删除记忆。
- 将 DeepSeek 对话历史导出为本地 JSON、Markdown 或可打印 HTML 文件。
- 创建、编辑和删除自定义技能和提示词预设。
- 启用、禁用、测试、编辑和删除 MCP 服务。
- 创建、暂停、运行、编辑和删除自动化任务。
- 配置或移除 WebDAV 同步设置。
- 清除或修改背景、宠物等视觉设置。
- 通过 Chrome 卸载扩展或清除浏览器扩展数据。

## 8. 安全

DeepSeek++ 默认将扩展数据保存在用户浏览器本地。用户应只配置可信的 WebDAV 服务器、MCP 端点和 Native Messaging host。远程 WebDAV 和 MCP 连接建议使用 HTTPS。

扩展不会硬编码第三方凭据。可选凭据由用户提供，并仅用于用户配置的功能。

## 9. Chrome Web Store Limited Use

DeepSeek++ 遵守 Chrome Web Store 用户数据政策，包括 Limited Use 要求。扩展处理的数据只会用于已经披露的用户可见功能。

DeepSeek++ 不会：

- 出售用户数据。
- 将用户数据用于个性化广告。
- 将用户数据传输给广告平台、数据经纪商或信息转售商。
- 将用户数据用于与记忆、技能、工具、自动化、同步或扩展设置无关的用途。

## 10. 儿童

DeepSeek++ 不面向儿童，也不会有意收集儿童个人信息。

## 11. 政策变更

当扩展功能、权限或数据处理方式发生变化时，本隐私政策可能会更新。发生重大变更时，文档顶部的生效日期会同步更新。

## 12. 联系方式

如有隐私或支持问题，请在以下地址提交 issue：

`https://github.com/zhu1090093659/deepseek-pp/issues`
