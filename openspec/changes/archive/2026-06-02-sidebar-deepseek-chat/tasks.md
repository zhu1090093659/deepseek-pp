## 1. Manifest 与权限

- [x] 1.1 在 `wxt.config.ts` manifest 中添加 `contextMenus` 到 permissions
- [x] 1.2 在 content script 中添加 DeepSeek auth token 保存逻辑：拦截 `rememberDeepSeekClientHeaders`，将 token 写入 `chrome.storage.local`

## 2. Background：认证与 API 路由

- [x] 2.1 在 `entrypoints/background.ts` 中添加 `contextMenus` 创建逻辑（含内置场景 + 自定义场景菜单）
- [x] 2.2 处理 `contextMenus.onClicked`：根据场景模板处理文本，打开侧边栏，发送 `OPEN_CHAT_WITH_TEXT` 消息
- [x] 2.3 添加 `CHAT_SUBMIT_PROMPT` 消息处理：从 storage 获取 token，调用 adapter 创建 session、求解 PoW、提交 prompt
- [x] 2.4 实现流式响应广播：通过 `chrome.runtime.sendMessage` 广播 `CHAT_STREAM_CHUNK` 消息
- [x] 2.5 处理 `CHAT_GET_AUTH_STATUS` 消息：检查 storage 中是否有有效 token

## 3. Core：Token 缓存与场景配置

- [x] 3.1 在 `core/deepseek/adapter.ts` 中暴露 `saveClientHeadersToStorage` / `loadClientHeadersFromStorage` 函数
- [x] 3.2 在 `core/` 下创建场景配置 store（`core/scenario/store.ts`），支持内置 + 自定义场景的 CRUD
- [x] 3.3 场景配置类型定义（`core/types.ts` 中新增 `ScenarioConfig` 类型）

## 4. Sidepanel：对话页面

- [x] 4.1 创建 `entrypoints/sidepanel/pages/ChatPage.tsx`：消息列表 + 输入框 + 新建会话按钮
- [x] 4.2 创建 `entrypoints/sidepanel/components/ChatMessage.tsx`：消息气泡组件（区分用户/AI 消息，流式更新）
- [x] 4.3 将「对话」Tab 添加到 `entrypoints/sidepanel/App.tsx` 第一个位置
- [x] 4.4 实现流式消息接收：监听 `CHAT_STREAM_CHUNK` 消息并实时更新消息UI
- [x] 4.5 实现发送逻辑：通过 `chrome.runtime.sendMessage` 发送 prompt，展示 loading 状态

## 5. Sidepanel：设置页场景管理

- [x] 5.1 在 SettingsPage 中新增场景管理区域
- [x] 5.2 场景列表展示（内置 + 自定义），支持编辑 Prompt 模板
- [x] 5.3 支持添加/删除自定义场景
- [x] 5.4 场景变更时通知 background 重建右键菜单

## 6. Right-Click：输入框预填

- [x] 6.1 在 ChatPage 中监听 `OPEN_CHAT_WITH_TEXT` 消息，将文本填入输入框
- [x] 6.2 输入框支持回车发送 + Shift+Enter 换行

## 7. 验证

- [x] 7.1 构建扩展，确认对话页正常显示并可发送消息
- [x] 7.2 确认记忆/Skill/MCP 自动注入生效
- [x] 7.3 测试右键菜单各场景发送到侧边栏
- [x] 7.4 测试自定义场景的添加/删除/启用/禁用
- [x] 7.5 测试 token 缺失时的提示逻辑
