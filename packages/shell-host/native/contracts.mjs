import { platform } from 'node:os';
const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 128_000;
// Chrome native messaging caps a single Port message at ~1 MB. The host must
// respect the same ceiling in both directions or Chrome truncates/disconnects
// and the user sees opaque "QUOTA_BYTES" failures (issue #297).
const MAX_NATIVE_MESSAGE_BYTES = 1 * 1024 * 1024;
// Headroom under MAX_NATIVE_MESSAGE_BYTES for the JSON-RPC envelope wrapping
// the file content. Aligned with the extension-side cap so a request that
// passes one side is never rejected by the other.
const MAX_LOCAL_FILE_WRITE_BYTES = 900_000;
const MAX_LOCAL_FILE_READ_CHARS = 100_000;
const DEFAULT_LOCAL_FILE_READ_CHARS = 16_000;
const DEFAULT_PYTHON_TIMEOUT_MS = 10_000;
const MAX_PYTHON_TIMEOUT_MS = 30_000;
const MAX_PYTHON_CODE_BYTES = 60_000;
const MAX_PYTHON_OUTPUT_BYTES = 64_000;
const PYTHON_PACKAGE_CHECKS = ['numpy', 'pandas', 'sympy'];
const PYTHON_NOT_FOUND_MESSAGE = 'No local Python interpreter found. Tried environment variables, PATH entries, common paths, and python/python3/py --version.';
const MAX_LOCAL_SKILLS = 80;
const MAX_LOCAL_SKILL_BYTES = 120_000;
const MAX_LOCAL_RESOURCE_FILES_PER_SKILL = 16;
const MAX_LOCAL_RESOURCE_BYTES_PER_SKILL = 100_000;
const MAX_LOCAL_RESOURCE_FILE_BYTES = 40_000;
const MAX_LOCAL_TOTAL_CONTENT_BYTES = 420_000;
const LOCAL_TEXT_RESOURCE_EXTENSIONS = new Set(['.md', '.txt', '.yaml', '.yml', '.json', '.tex']);
const LOCAL_SCRIPT_EXTENSIONS = new Set(['.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.zsh', '.ps1', '.rb', '.pl', '.php', '.lua', '.r']);
const DEFAULT_SHELL = platform() === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh';
const WINDOWS_POWERSHELL_UTF8_PREAMBLE = [
  '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding',
  'try { chcp.com 65001 > $null } catch {}',
].join('; ');
const HOST_FEATURES = {
  windowsFolderPickerEncodedCommand: true,
  localSkillNestedResourceBoundary: true,
};

// --- Persistent shell session ---
//
// Each session keeps one long-lived shell child open and pipes commands to its
// stdin. A randomized end-marker is appended after each command so the host can
// detect where a single command's output ends on stdout and read back the exit
// code. This makes resident-mode tools (e.g. OfficeCLI) survive across separate
// tool calls instead of dying with a one-shot `shell_exec` shell (issue #230).
//
// Why delimiter-based instead of a PTY: the host ships as a single .mjs copied
// into app-data with no node_modules, so native deps (node-pty/conPTY) would
// force per-platform prebuilt binaries and double the install footprint.
// Pure child_process + sentinel is the established pattern for this constraint.
const SESSION_IDLE_TIMEOUT_MS = 300_000; // 5min; aligns with resident-tool idle windows
const SESSION_MAX_OUTPUT_BYTES = MAX_OUTPUT_BYTES;
const SESSION_MARKER_PREFIX = '__DPP_SESSION_END__';

const TOOL_DEFINITIONS = [
  {
    name: 'shell_exec',
    title: 'Execute Shell Command',
    description: 'Execute a command in the shell reported by shell_status. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        cwd: { type: 'string', description: 'Working directory. Defaults to user home.' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Additional environment variables to set.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in milliseconds. Default 120000.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'high' },
  },
  {
    name: 'shell_status',
    title: 'Shell Host Status',
    description: 'Report host health, platform, shell, current working directory, and Node.js version.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'python_status',
    title: 'Python Interpreter Status',
    description: 'Report whether a local Python interpreter is available and which quick-validation packages can be imported.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'python_exec',
    title: 'Execute Python Code',
    description: 'Run short Python code for calculation, reasoning checks, and small data transformations. Do not install packages, access sensitive local files, or use network access.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Short Python code to execute. Keep it focused on computation or validation.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: MAX_PYTHON_TIMEOUT_MS, description: 'Timeout in milliseconds. Default 10000.' },
      },
      required: ['code'],
      additionalProperties: false,
    },
    annotations: { operation: 'execute', risk: 'high' },
  },
  {
    name: 'local_skill_preview',
    title: 'Preview Local Skill Folder',
    description: 'Read SKILL.md files, nearby text resources, and script file manifests from a local Skill folder. Does not execute local code.',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string', description: 'Absolute local folder path that contains one or more SKILL.md files.' },
        selectedPaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional SKILL.md paths relative to rootPath. When omitted, previews all detected Skills up to the limit.',
        },
      },
      required: ['rootPath'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'medium' },
  },
  {
    name: 'local_folder_pick',
    title: 'Pick Local Folder',
    description: 'Open the operating system folder picker and return the absolute path selected by the user.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Optional prompt shown in the native folder picker.' },
        defaultPath: { type: 'string', description: 'Optional local folder path to use as the initial picker location.' },
      },
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'low' },
  },
  {
    name: 'local_file_stat',
    title: 'Inspect Local File',
    description: 'Return whether a local path exists, whether it is a file or directory, its size, and its last modified timestamp.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or home-relative local path to inspect.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'medium' },
  },
  {
    name: 'local_file_read',
    title: 'Read Local Text File',
    description: 'Read a UTF-8 local text file in character windows so large files can be fetched in chunks.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or home-relative local file path to read.' },
        start: { type: 'integer', minimum: 0, description: 'Starting character offset. Default 0.' },
        max_chars: { type: 'integer', minimum: 1, maximum: MAX_LOCAL_FILE_READ_CHARS, description: 'Maximum characters to return. Default 16000.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { operation: 'read', risk: 'medium' },
  },
  {
    name: 'local_file_write',
    title: 'Write Local Text File',
    description: 'Write UTF-8 text to a local file without shell quoting. Supports overwrite or append and can create parent directories.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or home-relative local file path to write.' },
        content: { type: 'string', description: 'UTF-8 text content to write exactly as provided.' },
        append: { type: 'boolean', description: 'When true, append to the file instead of overwriting it.' },
        create_directories: { type: 'boolean', description: 'When true, create missing parent directories. Default true.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'high' },
  },
  {
    name: 'shell_session_begin',
    title: 'Open Persistent Shell Session',
    description: 'Start a long-lived shell session whose working directory, environment, and resident child processes (e.g. OfficeCLI resident mode) survive across later shell_session_exec calls. Use it for multi-step workflows where separate shell_exec calls would lose state. Returns a session_id to pass to subsequent calls.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Initial working directory. Defaults to user home.' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Additional environment variables to set on the session shell.' },
        shell: { type: 'string', description: 'Shell binary to use. Defaults to the shell reported by shell_status.' },
      },
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'high' },
  },
  {
    name: 'shell_session_exec',
    title: 'Run Command in Persistent Shell Session',
    description: 'Run a command inside a previously opened shell session (shell_session_begin). State (cwd, exports, resident processes) carries over between calls. Returns stdout, stderr, and exit code like shell_exec. Sessions auto-close after an idle timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id returned by shell_session_begin.' },
        command: { type: 'string', description: 'The shell command to execute in the session.' },
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 600000, description: 'Timeout in milliseconds. Default 120000.' },
      },
      required: ['session_id', 'command'],
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'high' },
  },
  {
    name: 'shell_session_end',
    title: 'Close Persistent Shell Session',
    description: 'Close a persistent shell session opened by shell_session_begin and release its child process. After this, the session_id is no longer valid.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id returned by shell_session_begin.' },
      },
      required: ['session_id'],
      additionalProperties: false,
    },
    annotations: { operation: 'write', risk: 'medium' },
  },
];

// --- Logging ---
//
// Chrome does not surface native-host stderr to users. When DPP_LOG_FILE is set
// (written into the wrapper script by the installer's --log-file option), every
// log line is also appended to that file so users can capture a diagnostic

export {
  DEFAULT_LOCAL_FILE_READ_CHARS,
  DEFAULT_PYTHON_TIMEOUT_MS,
  DEFAULT_SHELL,
  DEFAULT_TIMEOUT_MS,
  HOST_FEATURES,
  LOCAL_SCRIPT_EXTENSIONS,
  LOCAL_TEXT_RESOURCE_EXTENSIONS,
  MAX_LOCAL_FILE_READ_CHARS,
  MAX_LOCAL_FILE_WRITE_BYTES,
  MAX_LOCAL_RESOURCE_BYTES_PER_SKILL,
  MAX_LOCAL_RESOURCE_FILE_BYTES,
  MAX_LOCAL_RESOURCE_FILES_PER_SKILL,
  MAX_LOCAL_SKILL_BYTES,
  MAX_LOCAL_SKILLS,
  MAX_LOCAL_TOTAL_CONTENT_BYTES,
  MAX_NATIVE_MESSAGE_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_PYTHON_CODE_BYTES,
  MAX_PYTHON_OUTPUT_BYTES,
  MAX_PYTHON_TIMEOUT_MS,
  MCP_PROTOCOL_VERSION,
  PYTHON_NOT_FOUND_MESSAGE,
  PYTHON_PACKAGE_CHECKS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MARKER_PREFIX,
  SESSION_MAX_OUTPUT_BYTES,
  TOOL_DEFINITIONS,
  WINDOWS_POWERSHELL_UTF8_PREAMBLE,
};
