## Context

DeepSeek++ 当前架构中：
- `core/deepseek/adapter.ts` 已封装 DeepSeek API（创建会话、提交 Prompt、流式输出、PoW 挑战），可直接在 content script 或 background 中使用
- `core/inline-agent/loop.ts` 展示了如何将记忆/Skill/MCP 工具与 DeepSeek API 结合
- `core/interceptor/fetch-hook.ts` 通过 `rememberDeepSeekClientHeaders()` 拦截并缓存 DeepSeek 认证头
- 侧边栏使用 React + WXT 框架

关键限制：`createClientHeaders()` 需要读取 `localStorage.getItem('userToken')`，这仅在 `chat.deepseek.com` 页面上下文中可用。

## Goals / Non-Goals

**Goals:**
- 侧边栏第一个标签页为「对话」，使用 adapter 直连 DeepSeek API，构建独立聊天界面
- 对话自动应用插件的记忆注入（Memory）、预设（Preset）、MCP 工具描述符
- 对话页支持流式输出、消息列表展示
- 右键菜单支持多场景发送：总结、解释、翻译 + 自定义场景（用户可配 Prompt 模板）
- 右键发来的文本进入对话页输入框，可手动/自动发送

**Non-Goals:**
- 不嵌入 iframe（使用 adapter API 直连）
- 不实现跨 AI 服务的导航栏
- 不改动插件的 prompt augmentation 核心逻辑（运行时 hook 已有一套，侧边栏复用）
- 不改动已存在的记忆/Skill/MCP 管理功能

## Decisions

### 1. 认证 Token 获取策略：Content Script 存 Storage
**问题**：`createClientHeaders()` 依赖 `localStorage`（仅在 chat.deepseek.com 可用），适配器无法在 background/sidepanel 上下文中直接调用。

**方案**：在 `entrypoints/content.ts` 中监听 `rememberDeepSeekClientHeaders` 调用，将 token 同步保存到 `chrome.storage.local`。background 在需要时从 storage 读取并构造 `createClientHeaders()` 的等价对象。

**备选方案**：让 background 向 content script 发送消息索取 token。缺点是需要 DeepSeek 页签处于激活状态，不可靠。

### 2. 对话 API 调用位置：Background
所有 DeepSeek API 调用（创建 session、提交 prompt、流式读取）在 background 中执行。sidepanel 通过 `chrome.runtime.sendMessage` 发送 prompt，background 通过 message channel 返回流式数据。

**优势**：background 生命周期长，可缓存 token；sidepanel 关闭后对话不中断（后续可扩展）。

### 3. 流式传输方案：Message Channel
Background 使用 `chrome.runtime.onMessage` 返回 `[PENDING]`，然后通过 `chrome.runtime.sendMessage`（广播）将文本块推送到 sidepanel。每次新块广播 `{type: 'CHAT_STREAM_CHUNK', text, fullText, done}`。

### 4. 记忆/Skill/MCP 集成
对话页发送消息时，background 读取当前记忆、活跃 Preset、工具描述符，调用 `buildPromptAugmentation` 构造增强后的 prompt，再提交给 DeepSeek API。过程与 `fetch-hook.ts` 中的 `modifyRequestBody` 一致，但不需要 hook fetch。

### 5. 右键菜单场景模型
借鉴 AI-Side-Panel-Extension 的 `ACTION_PRESETS` 设计：
- 内置场景：总结（summarize）、解释（explain）、翻译（translate）
- 每个场景关联一个 Prompt 模板，使用 `{text}` 占位符
- 自定义场景：用户可添加名称 + Prompt 模板
- 存储在 `chrome.storage.local`，支持启用/禁用

### 6. 右键菜单结构
```
DeepSeek++
├── 发送到对话
├── 总结选中内容
├── 解释选中内容
├── 翻译选中内容
└── 自定义场景...
```

点击任一菜单项：打开侧边栏 → 切换到对话标签页 → 填入处理后的文本。

## Risks / Trade-offs

- **Token 过期**：用户 logout 或 token 刷新后，content script 存的 token 可能失效 → 对话时检查错误，提示用户打开 chat.deepseek.com 刷新认证
- **PoW 挑战**：提交 prompt 前需要求解 PoW，有一定计算开销 → 使用已有 WASM 求解器，后台处理
- **对话历史管理**：侧边栏会话与网页端会话独立，用户可能感到困惑 → 在对话页展示独立的 Session 标识，或与网页端共享 session
- **长对话性能**：多轮对话累积 prompt 较大 → 使用已有的 prompt augmentation 控制上下文窗口
