import type { ToolRiskLevel } from '../tool/types';

export const SHELL_MCP_SERVER_NAME = 'Shell Local';
export const SHELL_MCP_NATIVE_HOST = 'com.deepseek_pp.shell';

export const OFFICECLI_BIN_PATH = 'officecli';

export const SHELL_TOOL_NAMES = ['shell_exec', 'shell_status', 'python_status', 'python_exec', 'local_skill_preview', 'local_folder_pick', 'local_file_stat', 'local_file_read', 'local_file_write', 'local_file_edit','shell_session_begin', 'shell_session_exec', 'shell_session_end'] as const;
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
    name: 'local_file_stat',
    title: '查看本地文件信息',
    description: '返回本地文件是否存在、大小、类型和修改时间；不读取文件正文。',
    risk: 'medium',
  },
  {
    name: 'local_file_read',
    title: '读取本地文本文件',
    description: '按字符窗口读取本地 UTF-8 文本文件，支持分片读取大型文件。',
    risk: 'medium',
  },
  {
    name: 'local_file_write',
    title: '写入本地文本文件',
    description: '将 UTF-8 文本原样写入本地文件，支持覆盖或追加，并可自动创建父目录。',
    risk: 'high',
  },
  {
  name: 'local_file_edit',
  title: '安全编辑本地文本文件',
  description: '基于 SHA-256 与精确唯一匹配安全修改现有本地文本文件；文件已变化、目标不存在或匹配不唯一时拒绝修改。',
  risk: 'high',
  },
  {
    name: 'shell_session_begin',
    title: '开启持久 Shell 会话',
    description: '启动一个长生存的 Shell 会话，其工作目录、环境变量与常驻子进程（例如 OfficeCLI 驻留模式）可在后续多次 shell_session_exec 之间保持。适用于多步骤工作流，避免分次 shell_exec 丢失状态。返回 session_id 供后续调用使用。',
    risk: 'high',
  },
  {
    name: 'shell_session_exec',
    title: '在持久会话中执行命令',
    description: '在先前开启的持久 Shell 会话中执行命令。状态（工作目录、export 的变量、常驻进程）在调用之间保持。返回与 shell_exec 一致的 stdout、stderr 和退出码。会话闲置一段时间后会自动关闭。',
    risk: 'high',
  },
  {
    name: 'shell_session_end',
    title: '关闭持久 Shell 会话',
    description: '关闭由 shell_session_begin 开启的持久 Shell 会话并释放其子进程。调用后该 session_id 不再有效。',
    risk: 'medium',
  },
] as const;
