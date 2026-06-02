## ADDED Requirements

### Requirement: 对话标签页为侧边栏首个标签
DeepSeek++ 侧边栏 SHALL 将「对话」（Chat）标签页放在标签栏第一个位置。聊天标签页的图标和名称应与其他标签风格统一。

#### Scenario: 打开侧边栏
- **WHEN** 用户打开侧边栏
- **THEN** 默认显示「对话」标签页

### Requirement: 对话页使用 DeepSeek API 而非 iframe
对话页 SHALL 使用 `core/deepseek/adapter.ts` 的 `submitPromptStreaming` 或 `submitPrompt` 调用 DeepSeek 的 API，而不是通过 iframe 加载 chat.deepseek.com。

#### Scenario: 用户发送消息
- **WHEN** 用户在输入框中输入文本并发送
- **THEN** 系统调用 DeepSeek API 提交 prompt
- **THEN** 系统以流式方式逐块显示 AI 回复

### Requirement: 流式消息输出
对话页 SHALL 支持流式 SSE 输出展示，消息逐字渲染，显示实时回复。

#### Scenario: 流式显示回复
- **WHEN** DeepSeek 返回流式响应
- **THEN** AI 回复文本逐字/逐段在消息气泡中实时更新
- **THEN** 用户可以看到打字机效果

### Requirement: 对话历史展示
对话页 SHALL 以消息列表形式展示用户和 AI 的对话，用户消息右对齐，AI 消息左对齐。

#### Scenario: 多轮对话展示
- **WHEN** 多轮对话后
- **THEN** 所有历史消息按时间顺序在列表中展示
- **THEN** 用户消息和 AI 消息通过不同样式区分

### Requirement: 记忆自动注入
侧边栏对话 SHALL 自动读取插件的记忆数据，构建记忆上下文注入到 prompt 中。用户不需要手动指定记忆即可获得基于记忆的增强回复。

#### Scenario: 对话时应用记忆
- **WHEN** 用户发送消息
- **THEN** 系统读取 `getAllMemories()` 获取活跃记忆
- **THEN** 通过 `buildPromptAugmentation` 将记忆上下文注入到系统提示中
- **THEN** DeepSeek 基于记忆上下文产生回复

### Requirement: MCP 工具描述符注入
侧边栏对话 SHALL 自动注入已启用的 MCP 工具描述符，使 DeepSeek 能够在对话中调用工具。

#### Scenario: 对话时使用 MCP 工具
- **WHEN** 用户发送消息且 MCP 工具已配置
- **THEN** 系统读取工具描述符并注入 prompt
- **THEN** DeepSeek 可以在回复中通过 XML 格式调用工具

### Requirement: 活跃 Preset 注入
侧边栏对话 SHALL 自动应用用户当前激活的系统提示预设（Preset）。

#### Scenario: 对话时应用 Preset
- **WHEN** 用户发送消息且存在活跃 Preset
- **THEN** 活跃 Preset 的内容被注入到系统提示中
- **THEN** DeepSeek 按照预设指令产生回复

### Requirement: 认证 Token 从 Storage 获取
对话页 SHALL 通过 background 从 `chrome.storage.local` 获取 DeepSeek 认证 token，不直接依赖 `localStorage`。

#### Scenario: 发起对话时获取 Token
- **WHEN** 用户发送第一条消息
- **THEN** background 从 chrome.storage 读取缓存的 token 和 headers
- **THEN** 使用 token 创建 DeepSeek 会话和 PoW 挑战
- **THEN** 提交 prompt 到 DeepSeek API

#### Scenario: Token 缺失
- **WHEN** token 在 storage 中不存在或已过期
- **THEN** 对话页显示提示：请先在 chat.deepseek.com 登录并发送一条消息

### Requirement: 对话页清空/新建会话
对话页 SHALL 支持「新建会话」功能，清空当前消息列表并创建新的 DeepSeek 会话。

#### Scenario: 新建会话
- **WHEN** 用户点击「新建会话」按钮
- **THEN** 当前消息列表被清空
- **THEN** 系统创建一个新的 DeepSeek chat session
