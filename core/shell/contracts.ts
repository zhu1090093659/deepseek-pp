import type { ToolRiskLevel } from '../tool/types';

export const SHELL_MCP_SERVER_NAME = 'Shell Local';
export const SHELL_MCP_NATIVE_HOST = 'com.deepseek_pp.shell';

export const OFFICECLI_BIN_PATH = 'officecli';

export const SHELL_TOOL_NAMES = ['shell_exec', 'shell_status', 'python_status', 'python_exec', 'local_skill_preview', 'local_folder_pick', 'shell_session_begin', 'shell_session_exec', 'shell_session_end', 'file_read', 'file_write', 'file_edit', 'file_list', 'file_search', 'git_status', 'git_diff', 'git_log', 'git_commit', 'git_branch', 'git_push'] as const;
export type ShellToolName = typeof SHELL_TOOL_NAMES[number];

export interface ShellToolSpec {
  name: ShellToolName;
  title: string;
  description: string;
  risk: ToolRiskLevel;
}

export const SHELL_TOOL_SPECS: readonly ShellToolSpec[] = [
  {
    name: 'shell_exec',
    title: '执行命令',
    description: '在本地系统执行 shell 命令，返回 stdout、stderr 和退出码。',
    risk: 'high',
  },
  {
    name: 'shell_status',
    title: '主机状态',
    description: '报告 Native Host 健康状态、平台、shell 类型和工作目录。',
    risk: 'low',
  },
  {
    name: 'python_status',
    title: 'Python 状态',
    description: '报告本机 Python 解释器、版本和可导入的快速验证库。',
    risk: 'low',
  },
  {
    name: 'python_exec',
    title: '执行 Python',
    description: '执行短 Python 代码，用于快速验证想法、复杂计算和小型数据处理。',
    risk: 'high',
  },
  {
    name: 'local_skill_preview',
    title: '预览本地 Skill',
    description: '只读扫描本地 Skill 目录，返回 SKILL.md、文本资源和脚本清单；不会执行本地代码。',
    risk: 'medium',
  },
  {
    name: 'local_folder_pick',
    title: '选择本地文件夹',
    description: '打开系统文件夹选择器并返回用户选择的本地绝对路径。',
    risk: 'low',
  },
  {
    name: 'shell_session_begin',
    title: '开启持久 Shell 会话',
    description: '启动一个长生存的 Shell 会话，其工作目录、环境变量与常驻子进程可在后续多次 shell_session_exec 之间保持。返回 session_id 供后续调用使用。',
    risk: 'high',
  },
  {
    name: 'shell_session_exec',
    title: '在持久会话中执行命令',
    description: '在先前开启的持久 Shell 会话中执行命令。状态在调用之间保持。返回 stdout、stderr 和退出码。',
    risk: 'high',
  },
  {
    name: 'shell_session_end',
    title: '关闭持久 Shell 会话',
    description: '关闭由 shell_session_begin 开启的持久 Shell 会话并释放其子进程。',
    risk: 'medium',
  },
  {
    name: 'file_read',
    title: '读取文件',
    description: '读取本地文件内容。支持行偏移和限制。自动检测二进制文件。',
    risk: 'low',
  },
  {
    name: 'file_write',
    title: '写入文件',
    description: '将内容写入文件。自动创建父目录。覆盖前备份原文件。',
    risk: 'high',
  },
  {
    name: 'file_edit',
    title: '编辑文件',
    description: '搜索-替换式文件编辑。支持多 hunk。每个 oldText 必须在文件中精确匹配一次。',
    risk: 'high',
  },
  {
    name: 'file_list',
    title: '列出目录',
    description: '递归列出目录内容。支持 glob 过滤。默认跳过 .git 和 node_modules。',
    risk: 'low',
  },
  {
    name: 'file_search',
    title: '搜索文件',
    description: '全文正则搜索。优先使用 ripgrep，否则回退到 Node.js 递归搜索。自动跳过 .git、node_modules 和二进制文件。',
    risk: 'low',
  },
  {
    name: 'git_status',
    title: 'Git 状态',
    description: '显示工作树状态：已暂存、已修改、未跟踪和冲突文件。',
    risk: 'low',
  },
  {
    name: 'git_diff',
    title: 'Git 差异',
    description: '显示未暂存和/或已暂存的差异输出。',
    risk: 'low',
  },
  {
    name: 'git_log',
    title: 'Git 日志',
    description: '显示提交历史（带分支图）。返回结构化提交数据。',
    risk: 'low',
  },
  {
    name: 'git_commit',
    title: 'Git 提交',
    description: '暂存所有更改并创建提交。使用 git add -A + git commit。',
    risk: 'high',
  },
  {
    name: 'git_branch',
    title: 'Git 分支',
    description: '列出、创建或切换分支。',
    risk: 'medium',
  },
  {
    name: 'git_push',
    title: 'Git 推送',
    description: '推送提交到远程仓库。',
    risk: 'high',
  },
] as const;
