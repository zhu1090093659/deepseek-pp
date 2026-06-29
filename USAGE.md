# DeepSeek++ 使用手册

> 面向 AI Agent 工作台和编码助手的完整使用指南
> 版本: 1.0.5+

---

## 目录

1. [快速开始](#1-快速开始)
2. [编码能力](#2-编码能力)
3. [工具系统](#3-工具系统)
4. [提示词架构](#4-提示词架构)
5. [Shell 原生宿主](#5-shell-原生宿主)
6. [代码索引宿主](#6-代码索引宿主)
7. [高级模式](#7-高级模式)
8. [故障排除](#8-故障排除)

---

## 1. 快速开始

### 1.1 安装

```bash
# 从 Chrome Web Store 安装
# 打开 https://chromewebstore.google.com/detail/deepseek++/...

# 或从源码构建
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build:chrome
```

### 1.2 安装编码能力所需原生宿主

文件操作、代码搜索和 git 功能需要安装两个原生消息宿主：

```bash
# 1. Shell 原生宿主（提供文件读写、git、shell 命令）
npx deepseek-pp-shell-host install --browser chrome --extension-id <你的扩展ID>

# 2. 代码索引原生宿主（提供代码搜索、符号查找、代码结构分析）
npx deepseek-pp-code-index install --browser chrome --extension-id <你的扩展ID>
```

扩展 ID 可在侧边栏「MCP」页找到，会自动填入。

安装后重启浏览器，然后在侧边栏「MCP」页分别创建 `Shell` 和 `Code Index` 预设。

### 1.3 验证安装

```bash
# 验证 Shell 宿主
npm run smoke:shell

# 验证编译和测试
npm run compile
npm test
```

---

## 2. 编码能力

DeepSeek++ 在最近的更新中获得了完整的编码能力，覆盖文件操作、代码理解、git 工作流和上下文管理。

### 2.1 文件系统工具

| 工具 | 用途 | 风险 |
|------|------|------|
| `file_read` | 读取文件，支持行偏移/限制、二进制检测 | low |
| `file_write` | 写入文件，自动创建父目录，覆盖前备份到 `.deepseek-pp/backups/` | high |
| `file_edit` | 搜索-替换式编辑，多 hunk 支持，干运行模式 | high |
| `file_list` | 递归目录列表，支持 glob 过滤，跳过 `.git` 和 `node_modules` | low |
| `file_search` | 全文正则搜索，优先 ripgrep，回退 Node.js | low |

**最佳实践**：

- **先读后写**：修改前先用 `file_read` 了解当前状态
- **偏好 `file_edit`**：比 `file_write` 更适合小范围修改，因为只会改动指定部分
- **利用偏移读取大文件**：`file_read` 支持 `offset` 和 `limit` 参数，适合只查看文件的一部分
- **自动备份**：`file_write` 覆盖前会备份到 `.deepseek-pp/backups/` 目录

### 2.2 代码理解工具

这些工具由独立的 `code-index` 原生宿主提供：

| 工具 | 用途 |
|------|------|
| `code_search` | 全文本正则搜索（优先 ripgrep），支持上下文行和 glob 过滤 |
| `code_symbol` | 符号定义查找（函数、类、接口），支持 TS/JS/Python/Go/Rust/Java 等 |
| `code_structure` | 文件大纲：导入、导出、类、函数、变量及其行号 |
| `code_glob` | Glob 文件匹配搜索，`.gitignore` 感知，30 秒缓存 |
| `code_batch_read` | 单次调用批量读取多个文件（最多 20 个，512KB 上限） |

**最佳实践**：

- `code_search` 优先于 `file_search`（ripgrep 更快的搜索）
- `code_symbol` 在重构或理解新代码库时最有用
- `code_glob` 支持标准 glob 语法：`src/**/*.ts`、`**/*.py`
- `code_batch_read` 适合一次读取一个模块的多个相关文件

### 2.3 Git 工具

| 工具 | 用途 | 风险 |
|------|------|------|
| `git_status` | 显示工作树状态（已暂存/已修改/未跟踪/冲突） | low |
| `git_diff` | 显示差异，支持已暂存/未暂存、上下文行数控制 | low |
| `git_log` | 提交历史（结构化 JSON） | low |
| `git_commit` | 暂存所有更改并提交 | high |
| `git_branch` | 列出/创建/切换分支 | medium |
| `git_push` | 推送到远程 | high |

**工作流**：

```
git_status → file_read → file_edit → python_exec(验证) → git_diff → git_commit
```

1. 先用 `git_status` 了解当前状态
2. 用 `file_read` 阅读需要修改的文件
3. 用 `file_edit` 做小范围修改
4. 用 `python_exec` 或 `shell_exec` 验证语法/编译
5. 用 `git_diff` 审查更改
6. 用 `git_commit` 提交

### 2.4 编码智能体循环

当 DeepSeek++ 检测到你正在执行编码任务时，会激活编码优化智能体循环：

- **预执行规划**：在生成 `<edit_plan>` 后执行工具
- **只读工具并行**：多个 `file_read` 或 `code_search` 可以同时执行
- **编辑后验证**：每次 `file_edit` 后自动触发验证
- **迭代优化**：主编辑循环后自动检查和修复问题
- **最大步骤**：从通用模式的 12 步增加到编码模式的 30 步

### 2.5 上下文预算管理

编码会话的上下文由预算系统自动管理，避免达到 128K 上下文限制：

| 组件 | 预算比例 | 说明 |
|------|---------|------|
| 系统提示 | 15-20% | ~2,500 tokens，缓存稳定的前缀 |
| 工具定义 | 10-15% | ~1,500 tokens，仅首次注入 |
| 指令+上下文 | 10% | ~1,200 tokens |
| 工具结果 | 35-40% | ~5,000 tokens，按优先级修剪 |
| 对话历史 | 15-20% | ~2,500 tokens，最近 N 轮 |

**修剪策略**：
- **65% 软阈值**：成功的结果被压缩为摘要
- **80% 硬阈值**：只保留错误输出和编辑结果

---

## 3. 工具系统

### 3.1 工具分组

DeepSeek++ 的 50+ 工具按 10 个逻辑组分批注入提示词，避免模型认知过载：

| 组 | 包含工具 | 注入条件 |
|---|---------|---------|
| memory | memory_save, memory_update, memory_delete | 总是 |
| web | web_search, web_fetch | 总是 |
| artifact | artifact_create, artifact_bundle_create | 总是 |
| sandbox | sandbox_run | 总是 |
| shell | shell_exec, shell_status, shell_session_* | Shell MCP 已启用 |
| file | file_read, file_write, file_edit, file_list, file_search | Shell MCP + 编码模式 |
| code | code_search, code_symbol, code_structure, code_glob, code_batch_read | Code-index MCP 已启用 |
| git | git_status, git_diff, git_log, git_commit, git_branch, git_push | Shell MCP + 编码模式 |
| browser | browser_snapshot, browser_click, browser_navigate 等 | 浏览器控制已启用 |
| mcp | 第三方 MCP 工具 | 按需 |

### 3.2 场景模式

| 模式 | 注入的工具组 | 适用场景 |
|------|-------------|---------|
| chat (聊天) | memory, web, artifact, sandbox | 日常对话、信息查询 |
| coding (编码) | 全部 + file, code, git, shell | 编码、调试、代码审查 |
| automation (自动化) | memory, web, shell, browser | 定时任务、自动化工作流 |
| browsing (浏览) | memory, browser, web | 网页操作、数据采集 |

### 3.3 调用格式

所有工具通过 XML 标签加 JSON body 调用：

```
<file_read>
{"path": "/home/user/project/src/main.ts"}
</file_read>

<file_edit>
{"path": "/home/user/project/src/main.ts", "hunks": [{"oldText": "console.log('hello')", "newText": "console.log('hello world')"}]}
</file_edit>

<git_status>
{}
</git_status>

<code_search>
{"pattern": "class.*Controller", "path": "/home/user/project", "glob": "*.ts"}
</code_search>
```

规则：
- 标签名必须与工具名完全一致
- JSON body 必须是合法独立 JSON
- 禁止使用包装格式（`<invoke>`、`<tool_call>`、代码块、`{"tool":...}`）
- 工具调用必须在最终回复中，不能在 thinking/reasoning 块里

---

## 4. 提示词架构

### 4.1 三层结构

DeepSeek++ 使用三层提示词结构，借鉴 Claude Code 的设计：

```
┌─────────────────────────────────────────┐
│  STATIC PREFIX (缓存稳定区 ~2500 tokens)  │ ← 可缓存，不随请求变化
│  ├─ 角色定义 / 安全边界                    │
│  ├─ 行为规则 / Doing Tasks                │
│  ├─ 工具使用原则 / Using Your Tools       │
│  └─ 输出风格与格式要求                     │
├─ PROMPT_CACHE_BOUNDARY ────────────────┤
│  DYNAMIC SUFFIX (每次更新 ~1500+ tokens)  │ ← 随场景和上下文变化
│  ├─ 当前场景定义                          │
│  ├─ 场景过滤后的工具列表（只含组名+描述）      │
│  ├─ 工具选择优先级规则                      │
│  ├─ 项目上下文                             │
│  └─ 相关记忆                              │
├─────────────────────────────────────────┤
│  USER MESSAGE                            │
│  └─ 原始用户提示 + 简短格式提醒              │
└─────────────────────────────────────────┘
```

- **缓存边界**：`PROMPT_CACHE_BOUNDARY` 标记之前的内容在所有同场景请求中一致，可被 DeepSeek prompt caching 缓存
- **场景过滤**：不同场景注入不同的工具列表，Chat 模式下不会看到 `file_edit` 和 `browser_click`
- **紧凑工具列表**：注入的是工具名+描述，而非完整的 XML Schema，减少 token 占用

### 4.2 记忆系统

- **自动保存**：AI 识别关键信息后自动调用 `memory_save`
- **智能注入**：根据关键词匹配、置顶权重、访问频率筛选相关记忆
- **四种类型**：`user`（用户画像）、`feedback`（行为反馈）、`topic`（话题上下文）、`reference`（参考资料）
- **四种作用域**：`global` 全局可见、`project` 仅在项目内注入

---

## 5. Shell 原生宿主

### 5.1 概述

`shell-mcp-host.mjs` 是运行在本机的 Node.js 原生消息处理程序，通过 Chrome 原生消息协议与扩展通信。它提供：

- 20 个工具（9 个原有 + 5 个文件系统 + 6 个 git）
- 持久 shell 会话（保持 cwd 和环境变量的长连接）
- Python 解释器检测和执行
- 环境变量隔离（H-01 安全规范：最小化 env 传递）

### 5.2 安全模型

- **环境隔离**：子进程只继承最小 env 集合，不继承 `AWS_*`、`GITHUB_TOKEN` 等敏感变量
- **阻塞的 env key**：`LD_PRELOAD`、`LD_LIBRARY_PATH`、`DYLD_INSERT_LIBRARIES` 等动态加载器劫持变量被硬阻塞
- **输出截断**：stdout/stderr 最多 128KB
- **命令超时**：默认 120s，可配置
- **Python 隔离**：`python -I` 隔离模式，temp cwd，禁止包安装和网络访问

### 5.3 持久会话

适合需要保持状态的连续命令：

```
shell_session_begin → shell_session_exec × N → shell_session_end
```

会话空闲 5 分钟后自动关闭。

---

## 6. 代码索引宿主

### 6.1 概述

`code-index-host.mjs` 是独立的原生消息处理程序，专注代码理解任务：

- 5 个工具：`code_search`、`code_symbol`、`code_structure`、`code_glob`、`code_batch_read`
- 30 秒文件索引缓存
- 优先使用 ripgrep（如果可用）
- `.gitignore`-aware（感知 gitignore 规则）

### 6.2 多语言支持

| 语言 | 符号提取 | 文件结构 |
|------|---------|---------|
| TypeScript/JavaScript | ✅ 函数、类、接口、类型、枚举、导入/导出 | ✅ |
| Python | ✅ 函数、类、异步函数、lambda | ✅ import/from |
| Go | ✅ 函数、方法、结构体、接口 | ✅ import |
| Rust | ✅ 函数、pub 项、结构体、枚举、trait | ✅ use/extern |
| Java/Kotlin | ✅ 方法、类、接口、枚举 | 基础 |
| Ruby | ✅ 函数、类、模块 | 基础 |

### 6.3 搜索策略

`code_search` 先尝试 ripgrep，不可用时回退到纯 Node.js 实现：
- ripgrep：JSON 输出模式，支持上下文行、glob、固定字符串
- Node.js 回退：逐文件读取 + 正则匹配，跳过 >1MB 的文件

---

## 7. 高级模式

### 7.1 编码工作流模板

```python
# 推荐编码会话流程
1. git_status                    # 了解当前工作树状态
2. code_search/glob              # 找到要修改的代码
3. file_read                     # 阅读具体文件
4. buildEditPlanPrompt()         # 输出 <edit_plan>
5. file_edit × N                 # 执行修改
6. python_exec / shell_exec      # 验证（编译/类型检查）
7. git_diff                      # 审查更改
8. git_commit                    # 提交
```

### 7.2 场景检测

系统自动根据用户请求检测场景：

- 包含 `编辑`、`修改`、`创建文件`、`编码`、`bug` 等关键词 → `coding`
- 包含 `搜索`、`导航`、`点击`、`打开` 等页面操作 → `browsing`
- 其他 → `chat`

也可以在侧边栏手动指定场景。

### 7.3 提示词控制

| 控制项 | 位置 | 说明 |
|--------|------|------|
| 记忆注入开关 | 设置 → 提示词 | 关闭后不注入记忆 |
| 系统提示词开关 | 设置 → 提示词 | 关闭后只注入记忆块 |
| 预设注入频率 | 设置 → 提示词 | 每次/首条/关闭 |
| 回复语言强制 | 设置 → 提示词 | 强制使用中文或英文回复 |

---

## 8. 故障排除

### 8.1 Shell 宿主连接问题

```bash
# 检查安装状态
npx deepseek-pp-shell-host status --browser chrome

# 重新安装
npx deepseek-pp-shell-host install --browser chrome --extension-id <扩展ID>

# 运行烟雾测试
npm run smoke:shell
```

### 8.2 代码索引宿主问题

```bash
# 检查安装状态
npx deepseek-pp-code-index status --browser chrome

# 重新安装
npx deepseek-pp-code-index install --browser chrome --extension-id <扩展ID>
```

### 8.3 文件工具报错

- **"path escapes"**：路径超出了安全根目录，使用绝对路径
- **"oldText not found"**：`file_edit` 的 `oldText` 与文件内容不精确匹配，检查空格和换行
- **"oldText found N times"**：`oldText` 在文件中有多个匹配，添加更多上下文使匹配唯一

### 8.4 上下文限制问题

**症状**：模型回复变短、遗漏信息或重复同一工具调用

**解决方案**：
- 使用 `git_commit` 提交不相关的更改，清理工作树
- 开始新的编码会话
- 减少单次任务范围

### 8.5 性能提示

- **大文件**：使用 `file_read` 的 `offset` 和 `limit` 参数
- **代码搜索**：优先使用 `code_search` 而非 `file_search`（ripgrep 更快）
- **批量读取**：使用 `code_batch_read` 代替多次 `file_read`
- **Glob 搜索**：使用 `code_glob` 而非 `file_list` + 手动过滤

---

> 完整 API 参考和开发指南请参阅项目 [docs/](docs/) 目录和 [CONTRIBUTING.md](CONTRIBUTING.md)。
