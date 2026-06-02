## Why

DeepSeek++ 目前侧边栏仅有管理功能（记忆、Skill、MCP 等），缺少直接对话 DeepSeek 的入口。用户需要额外打开 DeepSeek 网页标签页才能与 AI 对话。同时，DeepSeek 网页端的对话无法直接利用插件的记忆、Skill、MCP 等增强能力。将对话入口内建到侧边栏，并使其与插件能力深度集成，可以显著提升使用体验。

## What Changes

- 侧边栏新增「对话」标签页，放在第一个位置。对话页直接使用 `core/deepseek/adapter.ts` 调用 DeepSeek API（而非 iframe），展示独立的聊天界面
- 对话页与插件的记忆（Memory）、Skill、MCP 工具深度集成：自动注入记忆上下文、可选用 Skill 指令、自动附加工具描述符使 DeepSeek 能调用 MCP 工具
- 新增右键菜单：选中文本 → 右键 → DeepSeek++ → 选择场景发送到侧边栏对话。内置场景：总结、解释、翻译；用户可自定义场景名称和 Prompt 模板（借鉴 AI-Side-Panel-Extension 的 Custom Service 设计）
- 右键发送的文本自动填入对话页的输入框，并可选择立即发送
- 对话页支持流式输出显示

## Capabilities

### New Capabilities

- `sidebar-chat`: 侧边栏内建 DeepSeek 对话界面，使用 adapter 直接调用 API，与记忆/Skill/MCP 深度集成
- `context-menu-send`: 右键菜单快捷发送选中文本到侧边栏对话，支持多场景（总结/解释/翻译/自定义）

### Modified Capabilities

<!-- 无现有 spec 需要修改 -->

## Impact

- `entrypoints/sidepanel/App.tsx`：新增「对话」Tab（放第一个），调整 Tab 排序
- `entrypoints/sidepanel/pages/`：新增 ChatPage.tsx（聊天界面）、ChatMessage.tsx（消息组件）
- `entrypoints/background.ts`：
  - 新增 contextMenus 创建（onInstalled），含多场景菜单项
  - 新增 contextMenus onClicked 处理
  - 新增消息转发处理：接收 content script 缓存的 DeepSeek 认证信息
- `core/deepseek/adapter.ts`：可能需要暴露 token 缓存接口，支持 background 直接使用
- `core/content/`：content script 保存 DeepSeek auth token 到 storage，供 background 使用
- `wxt.config.ts`：manifest 添加 `contextMenus` 权限
- 新增组件：ChatPage、ChatMessage、SendToSidebarPicker
- 新增配置：场景模板配置（存储）
