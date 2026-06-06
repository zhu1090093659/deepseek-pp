# Chrome Web Store Listing Draft

Last updated: 2026-06-06

## Package

- Current version: `0.5.1`
- Upload package: `dist/deepseek-plus-plus-0.5.1-chrome.zip`
- Category: Productivity
- Default language: English (United States)
- Homepage URL: `https://github.com/zhu1090093659/deepseek-pp`
- Support URL: `https://github.com/zhu1090093659/deepseek-pp/issues`
- Privacy policy URL: publish `docs/chrome-web-store/privacy-policy.md` and use its public URL.

## Store Listing

### Name

DeepSeek++

### Short Description

Agentic memory, skills, MCP tools, automation, and inline tool execution for DeepSeek.

### Detailed Description

DeepSeek++ enhances the DeepSeek web app with persistent memory, reusable skills, built-in web search and page fetch tools, system prompt presets, MCP tool execution, local conversation export, and scheduled automation.

Use it to keep useful facts across conversations, search the web when current information is needed, fetch page text for summarization, trigger custom skills with slash commands, connect user-configured MCP tools, and let DeepSeek continue a task after tool results are returned. The extension runs on chat.deepseek.com and provides a side panel for managing memories, skills, presets, built-in tools, MCP servers, automation tasks, sync settings, and visual preferences.

Key features:

- Long-term memory for user profile, feedback, topic context, and references.
- Built-in web search and page fetch tools for current information and page summarization.
- Skill system with slash-command activation and user-defined prompts.
- MCP tool management for Streamable HTTP, SSE, local bridge, and user-installed native messaging transports.
- Inline tool execution UI that hides raw tool-call markup and shows readable results.
- Agent-style continuation that can pass tool results back into the same conversation.
- Local export for DeepSeek conversation history, with readable JSON, Markdown, and print-ready HTML outputs.
- Scheduled automation tasks that can run manually or on a timer.
- Optional WebDAV sync for memories, skills, and presets.
- Local customization, including DeepSeek page background and a small floating DeepSeek pet.

DeepSeek++ does not operate a backend service for extension data. User configuration and extension data are stored locally in the browser unless the user explicitly enables WebDAV sync or connects a user-configured MCP endpoint/native host.

## zh-CN Localization Draft

### Name

DeepSeek++

### Short Description

为 DeepSeek 增加长期记忆、技能、MCP 工具调用、自动化任务和类原生工具执行体验。

### Detailed Description

DeepSeek++ 为 DeepSeek 网页版增加长期记忆、Skill 技能、内置网络搜索和网页获取工具、系统提示词预设、MCP 工具调用、本地对话导出和自动化任务。

你可以用它跨对话保存有用信息，在需要实时信息时搜索互联网，获取网页文本用于总结，通过 `/skill` 快速切换工作模式，连接自己配置的 MCP 工具，并让 DeepSeek 在工具结果返回后继续推进任务。扩展只在 chat.deepseek.com 运行，侧边栏用于管理记忆、技能、预设、内置工具、MCP 服务、自动化任务、同步设置和个性化选项。

核心功能：

- 长期记忆：保存用户画像、行为反馈、话题上下文和参考资料。
- 内置网络工具：支持联网搜索和网页文本获取。
- Skill 系统：支持斜杠命令触发内置或自定义技能。
- MCP 工具：支持 Streamable HTTP、SSE、本地 bridge 和用户安装的 Native Messaging。
- 工具执行展示：隐藏原始调用格式，展示清晰的执行结果。
- Agent 式续跑：工具结果可回传到同一会话继续生成。
- 本地对话导出：支持将 DeepSeek 对话记录导出为 JSON、Markdown 和可打印 HTML。
- 自动化任务：支持手动触发和定时触发。
- 可选 WebDAV 同步：同步记忆、技能和预设。
- 个性化设置：支持 DeepSeek 页面背景和悬浮小鲸鱼。

DeepSeek++ 不运营用于收集扩展数据的后台服务。除非用户主动开启 WebDAV 同步或配置 MCP 端点/本机 host，否则扩展数据保存在浏览器本地。

## Assets

Mandatory assets prepared in this repo:

- Extension icon: `public/icon/128.png` (`128x128`)
- Small promotional image: `docs/chrome-web-store/assets/small-promo.png` (`440x280`)
- Screenshot: `docs/chrome-web-store/assets/screenshot-inline-tools-1280x800.png` (`1280x800`)

Optional existing screenshots for future store-gallery polish:

- `assets/screenshot-sidepanel-memory.png`
- `assets/screenshot-sidepanel-skill.png`
- `assets/screenshot-sidepanel-mcp.svg`
- `assets/screenshot-sidepanel-automation.svg`
- `assets/screenshot-inline-tools.svg`
