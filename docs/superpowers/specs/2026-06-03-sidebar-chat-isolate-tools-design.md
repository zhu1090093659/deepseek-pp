# 侧边栏对话隔离 MCP/工具设计方案

## 背景

侧边栏（side panel）的对话功能目前会自动将 MCP 工具和联网搜索/记忆管理工具的 schema 注入到发送给 DeepSeek 的 prompt 中，并支持工具调用循环（AI 回复含工具标签时自动执行并继续对话）。用户希望侧边栏对话保持纯净，不受这些功能影响 —— 与 Skill 功能一样完全隔离。

## 改动范围

只改一个文件：`entrypoints/background.ts`

## 改动内容

### 1. 不再获取工具描述符

`handleChatSubmitPrompt()` 函数中，`Promise.all` 不再获取 `getRuntimeToolDescriptors()`。

### 2. 不传工具给 prompt 构建

调用 `buildPromptAugmentation()` 时传入 `toolDescriptors: []`，使 system template 中 `{{tools}}` 部分为空。

### 3. 跳过工具调用循环

不再调用 `runSidepanelToolLoop()`，直接用 `submitPromptStreaming` 做单次流式调用，完成后广播 `done` 信号。

### 4. 清理不再使用的 import

移除不再使用的导入：`getRuntimeToolDescriptors`、`extractToolCalls`。

## 不改什么

- `buildPromptAugmentation()` 函数不修改（传空数组即可）
- `runSidepanelToolLoop()` 函数保留（未来可恢复）
- MCP / Tools 页面管理 UI 不动
- 官网对话的注入逻辑不动
- 记忆 / 预设注入逻辑不动

## 效果

侧边栏对话发送给 DeepSeek 的 prompt 变为：

```
[预设内容] → [系统模板(记忆注入, 工具区为空)] → [用户消息]
```

模型不会在回复中插入工具调用标签，流式结果直接回显，不触发工具循环。
