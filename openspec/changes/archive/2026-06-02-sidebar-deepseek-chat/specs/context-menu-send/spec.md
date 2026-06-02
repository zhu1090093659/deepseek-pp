## ADDED Requirements

### Requirement: 右键菜单创建
扩展 SHALL 在安装和启动时创建右键菜单项。顶级菜单为 `DeepSeek++`，子菜单包含预设场景和自定义场景。

#### Scenario: 右键菜单初始化
- **WHEN** 扩展安装或浏览器启动
- **THEN** 创建右键菜单 `DeepSeek++`
- **THEN** 子菜单包含「发送到对话」、分隔线、预设场景（总结、解释、翻译）以及用户自定义场景

### Requirement: 内置场景配置
扩展 SHALL 内置三个预设场景，每个场景有固定的 ID 和默认 Prompt 模板：
- 总结（summarize）："请用简洁的语言总结以下内容：{text}"
- 解释（explain）："请解释以下内容：{text}"
- 翻译（translate）："请将以下内容翻译成中文：{text}"

模板中使用 `{text}` 占位符，发送时替换为选中的文本。

#### Scenario: 默认场景可用
- **WHEN** 用户安装扩展
- **THEN** 三个内置场景（总结、解释、翻译）默认启用

### Requirement: 自定义场景
用户 SHALL 能添加自定义场景。每个自定义场景包含：名称（如"写邮件"）和 Prompt 模板（如"请将以下内容改写为正式邮件：{text}"）。

#### Scenario: 添加自定义场景
- **WHEN** 用户在设置页面添加自定义场景
- **THEN** 输入名称和 Prompt 模板
- **THEN** 场景保存到 `chrome.storage.local`
- **THEN** 右键菜单实时更新

#### Scenario: 删除/禁用自定义场景
- **WHEN** 用户删除或禁用自定义场景
- **THEN** 场景从 `chrome.storage.local` 移除或标记
- **THEN** 右键菜单实时更新

### Requirement: 右键点击发送到侧边栏
当用户点击右键菜单项时，background SHALL 处理选中文本：
1. 用对应场景的 Prompt 模板处理文本（替换 `{text}`）
2. 打开侧边栏
3. 发送 `{type: 'OPEN_CHAT_WITH_TEXT', text: <处理后的文本>}` 到 sidepanel
4. sidepanel 切换到对话标签页并将文本填入输入框

#### Scenario: 总结选中文本
- **WHEN** 用户选中文本 → 右键 → DeepSeek++ → 总结
- **THEN** background 用"总结"模板处理选中文本
- **THEN** 打开侧边栏并切换到对话标签页
- **THEN** 处理后的文本填入输入框，可手动点击发送

#### Scenario: 直接发送到对话
- **WHEN** 用户选中文本 → 右键 → DeepSeek++ → 发送到对话
- **THEN** 打开侧边栏并切换到对话标签页
- **THEN** 原始选中文本直接填入输入框

### Requirement: 场景设置页面
侧边栏的「设置」页面 SHALL 新增场景管理区域，支持：
- 查看/编辑内置场景的 Prompt 模板
- 添加、编辑、删除自定义场景
- 启用/禁用特定场景
- 设置场景在右键菜单中的显示顺序

#### Scenario: 管理场景
- **WHEN** 用户在设置页面管理场景
- **THEN** 可以修改内置场景的 Prompt 模板
- **THEN** 可以添加/编辑/删除自定义场景
- **THEN** 右键菜单自动重建以反映更改

### Requirement: manifest 包含 contextMenus 权限
扩展的 manifest SHALL 在 permissions 中包含 `contextMenus` 以支持右键菜单功能。

#### Scenario: manifest 权限检查
- **WHEN** 扩展加载
- **THEN** permissions 数组中包含 `contextMenus`
