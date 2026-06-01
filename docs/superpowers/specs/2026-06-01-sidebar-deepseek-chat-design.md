# 侧边栏 DeepSeek 对话 + 右键菜单发送

## 概述

在 DeepSeek++ 侧边栏新增「对话」标签页（放在第一个位置），用户可直接在侧边栏内与 DeepSeek 对话。对话通过 `core/deepseek/adapter.ts` 调用 chat.deepseek.com 网页端后端 API，无需 iframe 嵌入。对话自动携带插件的记忆、MCP 工具、Preset 等增强能力。

新增右键菜单功能：选中文本 → 右键 → DeepSeek++ → 选择场景发送到侧边栏。内置场景（总结/解释/翻译），支持自定义场景和 Prompt 模板。

## 架构

```
Sidepanel (React)          Background (service worker)      Content Script
┌─────────────────┐       ┌──────────────────────┐       ┌─────────────────┐
│ ChatPage         │       │                      │       │ fetch-hook      │
│  sendMessage     │──────▶│ onMessage            │       │ 捕获 token      │
│  ← stream chunks │◀──────│  CHAT_SUBMIT_PROMPT  │       │ 存 storage      │
│  ← OPEN_CHAT_    │       │                      │       │                 │
│     WITH_TEXT    │       │  contextMenus        │       │                 │
│                 │       │  onClicked            │       │                 │
│ SettingsPage    │       │                      │       │                 │
│ 场景管理         │       │                      │       │                 │
└─────────────────┘       └──────────────────────┘       └─────────────────┘
```

**关键数据流**：

1. **Token 捕获**：content script 拦截 DeepSeek 的 fetch 请求 → `rememberDeepSeekClientHeaders` → 将 headers 写入 `chrome.storage.local`
2. **对话发送**：ChatPage → `chrome.runtime.sendMessage({type:'CHAT_SUBMIT_PROMPT', text})` → background
3. **API 调用**：background 从 storage 读取 headers → `createChatSession()` → `solvePow()` → `submitPromptStreaming()`
4. **流式返回**：background 每收到 SSE chunk → `chrome.runtime.sendMessage({type:'CHAT_STREAM_CHUNK', text, done})` → ChatPage 实时渲染
5. **工具循环**：检测到 `<tool_call>` → 执行工具 → 提交 continuation → 循环直到对话结束
6. **右键发送**：contextMenus.onClicked → 打开侧边栏 → `sendMessage({type:'OPEN_CHAT_WITH_TEXT', text})` → ChatPage 填入输入框

## 主要决策

### 1. 认证方案：Content Script 捕获 + Storage 缓存

content script 在 `fetch-hook.ts` 中已调用 `rememberDeepSeekClientHeaders`，在此基础上增加一步：将完整 headers 对象写入 `chrome.storage.local`。background 在需要时从 storage 读取。

备选方案（方案 B：offscreen document、方案 C：content script 直调）因复杂度高或依赖标签页存活而被排除。

### 2. API 调用位置：Background

所有 DeepSeek API 调用在 background service worker 中执行。Sidepanel 通过消息传递交互。background 生命周期长，可缓存 token 和 session 状态。

### 3. 流式传输：Message Channel

Background 使用 `chrome.runtime.sendMessage` 广播 `CHAT_STREAM_CHUNK` 消息。这是最简单的 WXT 兼容方案。

### 4. 记忆/MCP/Preset 自动注入

复用 `buildPromptAugmentation`（`core/prompt` 中的函数），在 background 提交 prompt 前增强。过程与 `fetch-hook.ts` 的 `modifyRequestBody` 一致。

### 5. 工具调用执行

参考 `core/inline-agent/loop.ts` 的工具循环逻辑。Background 在流式接收过程中检测 `<tool_call>` XML，调用 `executeRuntimeToolCall` 执行，然后将结果作为 continuation prompt 提交给 DeepSeek。

### 6. 右键场景模型

借鉴 AI-Side-Panel-Extension 的 `ACTION_PRESETS` 设计。每个场景有 ID、名称、Prompt 模板（含 `{text}` 占位符）。内置三个场景，自定义场景存储在 `chrome.storage.local`。

## 组件清单

| 组件 | 文件路径 | 说明 |
|---|---|---|
| ChatPage | `entrypoints/sidepanel/pages/ChatPage.tsx` | 消息列表 + 输入框 + 新建按钮 |
| ChatMessage | `entrypoints/sidepanel/components/ChatMessage.tsx` | 单条消息气泡 |
| ScenarioManager | `entrypoints/sidepanel/components/ScenarioManager.tsx` | 设置在设置页中的场景管理区域 |
| ScenarioStore | `core/scenario/store.ts` | 场景配置的 CRUD 和存储 |

## 消息类型

```
CHAT_SUBMIT_PROMPT    ChatPage → Bg    提交用户消息
CHAT_NEW_SESSION      ChatPage → Bg    新建会话
CHAT_STREAM_CHUNK     Bg → ChatPage    流式文本块
CHAT_STREAM_ERROR     Bg → ChatPage    流式错误
OPEN_CHAT_WITH_TEXT   Bg → ChatPage    填入输入框（右键触发）
AUTH_STATUS           Bg → ChatPage    认证状态通知
```

## ChatPage 内部状态

```typescript
interface ChatState {
  messages: ChatMessage[];    // [{role:'user'|'assistant', text:string}]
  streamingText: string;     // 当前流式文本
  isStreaming: boolean;      // 是否接收中
  inputText: string;         // 输入框内容
  hasToken: boolean;         // 是否有 DeepSeek token
}
```

## 右键菜单结构

```
DeepSeek++
├── 发送到对话              ← 原始文本
├───────────────
├── 总结选中内容
├── 解释选中内容
├── 翻译选中内容
├───────────────              (有自定义场景时显示)
├── [自定义场景 1]
├── [自定义场景 2]
```

## 场景配置

```typescript
interface ScenarioConfig {
  id: string;          // 'summarize' | 'explain' | 'translate' | custom UUID
  label: string;       // 展示名
  template: string;    // Prompt 模板，"请总结：{text}"
  builtIn: boolean;    // 是否内置
  enabled: boolean;    // 是否启用
}
```

内置场景（不可删除，可编辑模板和启用/禁用）：
- `summarize`：模板 `"请用简洁的语言总结以下内容：{text}"`
- `explain`：模板 `"请解释以下内容：{text}"`
- `translate`：模板 `"请将以下内容翻译成中文：{text}"`

## 设置页场景管理 UI

在 SettingsPage 底部新增区域：

```
┌─ 右键场景 ─────────────────────────────────────┐
│                                                  │
│  内置场景                                        │
│  ☑ 总结    模板: "请总结：{text}"          [编辑] │
│  ☑ 解释    模板: "请解释：{text}"          [编辑] │
│  ☑ 翻译    模板: "请翻译：{text}"          [编辑] │
│                                                  │
│  自定义场景                          [+ 添加]     │
│  (空)                                            │
└──────────────────────────────────────────────────┘
```

## 错误处理

| 场景 | 用户看到 |
|---|---|
| Token 未捕获 | 提示"请先在 chat.deepseek.com 登录并发送一条消息" |
| Token 过期 | 提示"认证已过期，请刷新 chat.deepseek.com" |
| API 错误 | 消息列表中显示红色错误提示 |
| 流式中断 | 显示"连接中断，请重试" |
| 工具调用失败 | 执行结果中显示失败原因，继续对话 |

## 非目标

- 不持久化对话消息（关闭即清空）
- 不实现消息编辑/删除/复制等增强交互
- 不实现多 AI 服务切换
- 不改动已有的记忆/Skill/MCP 管理功能

## 实现顺序

1. Manifest 权限 + Content script token 存储
2. Background 右键菜单 + 场景 store
3. Sidepanel 对话页（ChatPage + ChatMessage）
4. Background 对话 API 路由（含工具循环）
5. 设置页场景管理 UI
6. 右键 → 输入框预填集成
