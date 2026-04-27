# DeepSeek++

为 [DeepSeek](https://chat.deepseek.com) 网页版注入 **Agentic 记忆系统**、**Skill 技能系统** 和 **系统提示词预设** 的 Chrome 扩展。

让 DeepSeek 拥有跨对话的长期记忆，通过 `/skill` 指令一键切换专家模式，并支持自定义系统提示词全局生效。

## 核心功能

### 记忆系统

- **自动记忆** — AI 在对话中识别到关键信息时，通过 tool_call 自动保存为长期记忆
- **智能注入** — 每次对话时，根据关键词匹配、置顶权重、访问频率等维度，自动筛选相关记忆注入 prompt
- **四种类型** — 用户画像 (`user`)、行为反馈 (`feedback`)、话题上下文 (`topic`)、参考资料 (`reference`)
- **侧边栏管理** — 查看、编辑、置顶、删除记忆，支持按类型筛选和标签管理
- **导入/导出** — JSON 格式批量备份和恢复

<p align="center">
  <img src="assets/screenshot-sidepanel-memory.png" width="300" alt="记忆管理侧边栏">
</p>

### Skill 技能系统

- **内置技能** — 预设 9 个开箱即用的技能：极致深度思考、前端设计、文档协作、品牌指南、算法艺术、PPT 设计等
- **自定义技能** — 在侧边栏创建专属技能，定义系统指令和参数
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
- **首条注入** — 每次新对话的首条消息前自动注入激活预设的内容，后续消息不重复注入
- **与技能/记忆共存** — 预设内容作为前缀注入，与 Skill 指令和记忆上下文叠加生效

### 工作原理

扩展在 main world 中拦截 `fetch` 和 `XMLHttpRequest`，在请求发送到 DeepSeek API 前修改 prompt（注入记忆/技能指令），并解析 SSE 响应流以提取和处理 tool_call 指令。

```
用户输入 → 拦截请求 → 注入预设 + 记忆 + 技能指令 → DeepSeek API
                                                        ↓
侧边栏 ← IndexedDB/Storage ← 提取 tool_call ← 解析 SSE 响应
```

## 安装

### 从源码构建

```bash
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目下的 `dist/chrome-mv3/` 目录

### 开发模式

```bash
npm run dev    # 启动开发服务器，支持热重载
npm run build  # 生产构建
npm run zip    # 打包为 .zip（用于发布）
npm run compile # TypeScript 类型检查
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 框架 | [WXT](https://wxt.dev) (Chrome MV3) |
| UI | React 19 + Tailwind CSS 4 |
| 存储 | Dexie (IndexedDB) + Chrome Storage API |
| 语言 | TypeScript |

## 项目结构

```
core/
├── constants.ts          # API 地址、token 预算、系统模板
├── types.ts              # 类型定义
├── interceptor/          # 网络拦截（fetch hook、SSE 解析、tool_call 提取）
├── memory/               # 记忆系统（存储、评分筛选、prompt 注入）
├── skill/                # 技能系统（内置技能、解析器、注册表）
├── preset/               # 系统提示词预设（存储、激活管理）
└── ui/                   # 技能自动补全弹窗

entrypoints/
├── background.ts         # Service Worker（消息路由、数据持久化）
├── content.ts            # Content Script（DOM 集成、tool_call 处理）
├── main-world.content.ts # Main World 脚本（网络拦截）
└── sidepanel/            # 侧边栏 React 应用（记忆/技能/设置页面）
```

## License

MIT
