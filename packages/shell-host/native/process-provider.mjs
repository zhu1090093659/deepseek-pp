import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import {
  arch,
  homedir,
  hostname,
  platform,
  release as osRelease,
  tmpdir,
  type as osType,
  version as osVersion,
} from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEFAULT_PYTHON_TIMEOUT_MS,
  DEFAULT_SHELL,
  DEFAULT_TIMEOUT_MS,
  HOST_FEATURES,
  MAX_OUTPUT_BYTES,
  MAX_PYTHON_CODE_BYTES,
  MAX_PYTHON_OUTPUT_BYTES,
  MAX_PYTHON_TIMEOUT_MS,
  PYTHON_NOT_FOUND_MESSAGE,
  PYTHON_PACKAGE_CHECKS,
} from './contracts.mjs';
import {
  createChildEnv,
  createPythonChildEnv,
  createShellInvocation,
  getEnvironmentPath,
  getWindowsVersionLabel,
  localAppData,
  splitPath,
} from './os-adapter.mjs';

export function createProcessToolHandlers() {
  return [
    { name: 'shell_exec', handle: executeShellTool },
    { name: 'shell_status', handle: createShellStatusResult },
    { name: 'python_status', handle: createPythonStatusResult },
    { name: 'python_exec', handle: executePythonTool },
  ];
}

function createShellStatusResult() {
  return {
    content: [{ type: 'text', text: `Shell host ready on ${platform()} ${arch()}` }],
    structuredContent: {
      ok: true,
      data: {
        platform: platform(),
        arch: arch(),
        osType: osType(),
        osRelease: osRelease(),
        osVersion: osVersion(),
        windowsVersion: getWindowsVersionLabel(),
        shell: DEFAULT_SHELL,
        cwd: homedir(),
        nodeVersion: process.version,
        hostname: hostname(),
        path: getEnvironmentPath(process.env),
        pathEntries: splitPath(getEnvironmentPath(process.env)),
        features: HOST_FEATURES,
      },
    },
  };
}

async function executeShellTool(args) {
  const command = args?.command;
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { isError: true, content: [{ type: 'text', text: 'command is required and must be a non-empty string.' }] };
  }
  const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : homedir();
  const env = createChildEnv(args?.env);
  const timeoutMs = typeof args?.timeout_ms === 'number' && args.timeout_ms >= 1000
    ? Math.min(args.timeout_ms, 600_000)
    : DEFAULT_TIMEOUT_MS;
  try {
    const result = await execCommand(command, { cwd, env, timeoutMs });
    return {
      content: [{ type: 'text', text: formatExecSummary(result) }],
      structuredContent: { ok: result.exitCode === 0, data: result },
      isError: result.exitCode !== 0,
    };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
  }
}
function execCommand(command, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const { shellBin, shellArgs } = createShellInvocation(command);

    const child = spawn(shellBin, shellArgs, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let forceKillTimer = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stdoutBytes;
        stdout.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderrBytes;
        stderr.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stderrBytes += chunk.length;
    });

    child.on('error', (err) => {
      clearTimers();
      reject(new Error(`Failed to spawn command: ${err.message}`));
    });

    child.on('close', (exitCode, signal) => {
      clearTimers();
      resolve({
        command,
        shell: shellBin,
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        signal: signal || (timedOut ? 'SIGTERM' : null),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated: stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES,
        timedOut,
      });
    });
  });
}

// --- Persistent shell session ---

async function createPythonStatusResult() {
  const status = await detectPythonStatus();
  const text = status.available
    ? `Python ${status.version} ready at ${status.executable}`
    : PYTHON_NOT_FOUND_MESSAGE;

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      ok: true,
      data: status,
    },
  };
}

async function executePythonTool(args) {
  const code = args?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'code is required and must be a non-empty string.' }],
    };
  }

  const codeBytes = Buffer.byteLength(code, 'utf8');
  if (codeBytes > MAX_PYTHON_CODE_BYTES) {
    return {
      isError: true,
      content: [{ type: 'text', text: `code exceeds ${MAX_PYTHON_CODE_BYTES} bytes.` }],
    };
  }

  const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms >= 1000
    ? Math.min(Math.floor(args.timeout_ms), MAX_PYTHON_TIMEOUT_MS)
    : DEFAULT_PYTHON_TIMEOUT_MS;
  const status = await detectPythonStatus();

  if (!status.available || !status.command) {
    return {
      isError: true,
      content: [{ type: 'text', text: PYTHON_NOT_FOUND_MESSAGE }],
      structuredContent: {
        ok: false,
        data: status,
      },
    };
  }

  const cwd = mkdtempSync(join(tmpdir(), 'deepseek-pp-python-'));
  try {
    const result = await execPythonProcess(status.command, status.commandArgs ?? [], {
      code,
      cwd,
      timeoutMs,
    });
    return {
      content: [{ type: 'text', text: formatPythonExecSummary(result) }],
      structuredContent: {
        ok: result.exitCode === 0,
        data: {
          ...result,
          pythonPath: status.executable,
          pythonVersion: status.version,
          cwd: '(temporary scratch directory)',
          limits: getPythonLimits(),
        },
      },
      isError: result.exitCode !== 0,
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: err.message }],
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function detectPythonStatus() {
  const candidates = getPythonCandidates();
  const candidateLabels = candidates.map(formatPythonCandidate);

  for (const candidate of candidates) {
    let versionText = null;
    try {
      const versionProbe = await execPythonVersionProbe(candidate);
      versionText = parsePythonVersionOutput(versionProbe);
      if (versionProbe.exitCode !== 0 || !versionText) continue;
    } catch {
      // Try the next environment value, path, or command name.
      continue;
    }

    try {
      const probe = await execPythonProbe(candidate);
      if (probe.exitCode !== 0 || !probe.stdout.trim()) continue;
      const data = JSON.parse(probe.stdout.trim());
      return {
        available: true,
        command: candidate.command,
        commandArgs: getPythonCommandArgs(candidate),
        executable: typeof data.executable === 'string' ? data.executable : candidate.command,
        version: typeof data.version === 'string' ? data.version : versionText,
        versionCheck: versionText,
        packages: normalizePythonPackages(data.packages),
        candidates: candidateLabels,
        isolation: 'python -I',
        policy: getPythonPolicy(),
        limits: getPythonLimits(),
      };
    } catch {
      // --version worked, but the JSON probe failed; try the next common executable name.
    }
  }

  return {
    available: false,
    command: null,
    commandArgs: [],
    executable: null,
    version: null,
    versionCheck: null,
    packages: Object.fromEntries(PYTHON_PACKAGE_CHECKS.map((name) => [name, false])),
    candidates: candidateLabels,
    isolation: 'python -I',
    policy: getPythonPolicy(),
    limits: getPythonLimits(),
  };
}

function getPythonCandidates() {
  const envCandidates = getPythonEnvCandidates();
  const pathCandidates = getPythonPathCandidates();
  const fallbackCandidates = platform() === 'win32'
    ? [
        { command: 'py', args: [], launcherArgs: ['-3'], source: 'command:py -3 --version' },
        { command: 'py.exe', args: [], launcherArgs: ['-3'], source: 'command:py.exe -3 --version' },
        { command: 'python', args: [], source: 'command:python --version' },
        { command: 'python.exe', args: [], source: 'command:python.exe --version' },
        { command: 'python3', args: [], source: 'command:python3 --version' },
        { command: 'python3.exe', args: [], source: 'command:python3.exe --version' },
      ]
    : [
        { command: 'python3', args: [], source: 'command:python3 --version' },
        { command: 'python', args: [], source: 'command:python --version' },
        { command: 'py', args: [], source: 'command:py --version' },
      ];
  return dedupePythonCandidates([...envCandidates, ...pathCandidates, ...fallbackCandidates]);
}

function getPythonEnvCandidates() {
  const names = [
    'DEEPSEEK_PP_PYTHON',
    'PYTHON_EXECUTABLE',
    'PYTHON',
    'PYTHON3',
  ];
  const candidates = [];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    candidates.push({ command: value.trim(), args: [], source: 'env:' + name });
  }
  return candidates;
}

function getPythonPathCandidates() {
  return platform() === 'win32' ? getWindowsPythonPathCandidates() : getPosixPythonPathCandidates();
}

function getPosixPythonPathCandidates() {
  const candidates = [];
  const directPaths = [
    resolve(homedir(), '.pyenv', 'shims', 'python3'),
    resolve(homedir(), '.pyenv', 'shims', 'python'),
    resolve(homedir(), 'miniconda3', 'bin', 'python'),
    resolve(homedir(), 'anaconda3', 'bin', 'python'),
    resolve(homedir(), 'miniforge3', 'bin', 'python'),
    resolve(homedir(), 'mambaforge', 'bin', 'python'),
    '/opt/homebrew/bin/python3',
    '/opt/homebrew/bin/python',
    '/usr/local/bin/python3',
    '/usr/local/bin/python',
    '/usr/bin/python3',
    '/usr/bin/python',
    '/bin/python3',
    '/bin/python',
  ];
  for (const pythonPath of directPaths) addPythonPathCandidate(candidates, pythonPath, 'path:file');
  for (const root of ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge']) {
    addPythonEnvDirCandidates(candidates, resolve(homedir(), root, 'envs'));
  }
  addPythonEnvDirCandidates(candidates, resolve(homedir(), '.pyenv', 'versions'));
  return candidates;
}

function getWindowsPythonPathCandidates() {
  const candidates = [];
  addWindowsPathPythonCandidates(candidates);
  const dirs = [
    resolve(localAppData, 'Programs', 'Python'),
    process.env.ProgramFiles ? resolve(process.env.ProgramFiles) : '',
    process.env['ProgramFiles(x86)'] ? resolve(process.env['ProgramFiles(x86)']) : '',
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const entry of readDirectoryEntries(dir)) {
      if (!/^Python\d+/i.test(entry.name)) continue;
      addPythonPathCandidate(candidates, resolve(dir, entry.name, 'python.exe'), 'path:file');
    }
  }
  return candidates;
}

function addWindowsPathPythonCandidates(candidates) {
  for (const dir of splitPath(getEnvironmentPath(process.env))) {
    for (const name of ['python.exe', 'python3.exe']) {
      addPythonPathCandidate(candidates, resolve(dir, name), 'path:PATH');
    }
  }
}

function addPythonEnvDirCandidates(candidates, envsDir) {
  for (const entry of readDirectoryEntries(envsDir)) {
    if (!entry.isDirectory()) continue;
    const pythonPath = platform() === 'win32'
      ? resolve(envsDir, entry.name, 'python.exe')
      : resolve(envsDir, entry.name, 'bin', 'python');
    addPythonPathCandidate(candidates, pythonPath, 'path:env');
  }
}

function addPythonPathCandidate(candidates, pythonPath, source) {
  if (!existsSync(pythonPath)) return;
  if (platform() === 'win32' && isWindowsAppExecutionAliasPath(pythonPath)) return;
  candidates.push({ command: pythonPath, args: [], source });
}

function isWindowsAppExecutionAliasPath(filePath) {
  const normalized = normalizeWindowsPathForCompare(filePath);
  const aliasDir = normalizeWindowsPathForCompare(resolve(localAppData, 'Microsoft', 'WindowsApps'));
  return normalized === aliasDir || normalized.startsWith(aliasDir + '/');
}

function normalizeWindowsPathForCompare(filePath) {
  return resolve(filePath).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
}

function readDirectoryEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function dedupePythonCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = [candidate.command, ...(candidate.launcherArgs ?? []), ...candidate.args].join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function getPythonCommandArgs(candidate) {
  return [...(candidate.launcherArgs ?? []), ...candidate.args];
}

function formatPythonCandidate(candidate) {
  const label = [candidate.command, ...getPythonCommandArgs(candidate)].join(' ');
  return candidate.source ? label + ' (' + candidate.source + ')' : label;
}

function execPythonVersionProbe(candidate) {
  return execProcess(candidate.command, [...getPythonCommandArgs(candidate), '--version'], {
    cwd: homedir(),
    env: createPythonChildEnv(),
    timeoutMs: 2_000,
    maxOutputBytes: 2_000,
  });
}

function parsePythonVersionOutput(probe) {
  const text = [probe.stdout, probe.stderr].join(' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/Python\s+([0-9]+(?:\.[0-9]+){1,2})/i);
  return match ? match[1] : null;
}

function execPythonProbe(candidate) {
  const code = [
    'import importlib.util, json, sys',
    `packages = {name: importlib.util.find_spec(name) is not None for name in ${JSON.stringify(PYTHON_PACKAGE_CHECKS)}}`,
    'print(json.dumps({"executable": sys.executable, "version": sys.version.split()[0], "packages": packages}, ensure_ascii=False))',
  ].join('\n');

  return execProcess(candidate.command, [...getPythonCommandArgs(candidate), '-I', '-c', code], {
    cwd: homedir(),
    env: createPythonChildEnv(),
    timeoutMs: 5_000,
    maxOutputBytes: 16_000,
  });
}

function execPythonProcess(command, commandArgs, { code, cwd, timeoutMs }) {
  return execProcess(command, [...commandArgs, '-I', '-'], {
    cwd,
    env: createPythonChildEnv(),
    input: code,
    timeoutMs,
    maxOutputBytes: MAX_PYTHON_OUTPUT_BYTES,
  });
}

function execProcess(command, args, { cwd, env, input, timeoutMs, maxOutputBytes }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let forceKillTimer = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
    }, timeoutMs);

    const clearTimers = () => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };

    child.stdout.on('data', (chunk) => {
      if (stdoutBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stdoutBytes;
        stdout.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stdoutBytes += chunk.length;
    });

    child.stderr.on('data', (chunk) => {
      if (stderrBytes < maxOutputBytes) {
        const remaining = maxOutputBytes - stderrBytes;
        stderr.push(chunk.length <= remaining ? chunk : chunk.subarray(0, remaining));
      }
      stderrBytes += chunk.length;
    });

    child.on('error', (err) => {
      clearTimers();
      reject(new Error(`Failed to spawn ${command}: ${err.message}`));
    });

    child.on('close', (exitCode, signal) => {
      clearTimers();
      resolve({
        command: [command, ...args].join(' '),
        exitCode: timedOut ? -1 : (exitCode ?? -1),
        signal: signal || (timedOut ? 'SIGTERM' : null),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated: stdoutBytes > maxOutputBytes || stderrBytes > maxOutputBytes,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function normalizePythonPackages(value) {
  const input = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(
    PYTHON_PACKAGE_CHECKS.map((name) => [name, input[name] === true]),
  );
}

function getPythonPolicy() {
  return {
    purpose: 'short computation, idea validation, and small data transformations',
    packageInstall: false,
    networkAccess: 'not_allowed_by_policy_not_os_enforced',
    filesystemAccess: 'temporary_cwd_only_by_policy_not_os_enforced',
  };
}

function getPythonLimits() {
  return {
    timeoutMsDefault: DEFAULT_PYTHON_TIMEOUT_MS,
    timeoutMsMax: MAX_PYTHON_TIMEOUT_MS,
    codeBytesMax: MAX_PYTHON_CODE_BYTES,
    outputBytesMax: MAX_PYTHON_OUTPUT_BYTES,
  };
}

// H-01: shell_exec / shell sessions must NOT inherit the host's entire
// process.env, which leaks secrets (AWS_*, GITHUB_TOKEN, *_SECRET, DATABASE_URL,
// …) into any command the model runs. Mirror createPythonChildEnv(): start from a

export function formatExecSummary(result) {
  const parts = [];
  if (result.timedOut) parts.push('[TIMED OUT]');
  if (result.exitCode !== 0) parts.push(`[exit ${result.exitCode}]`);
  if (result.truncated) parts.push('[output truncated]');
  if (result.stdout) parts.push(result.stdout.slice(0, 4000));
  if (result.stderr) parts.push(`STDERR: ${result.stderr.slice(0, 2000)}`);
  return parts.join('\n') || '(no output)';
}

function formatPythonExecSummary(result) {
  const parts = [];
  if (result.timedOut) parts.push('[TIMED OUT]');
  if (result.exitCode !== 0) parts.push(`[exit ${result.exitCode}]`);
  if (result.truncated) parts.push('[output truncated]');
  if (result.stdout) parts.push(result.stdout.slice(0, 4000));
  if (result.stderr) parts.push(`STDERR: ${result.stderr.slice(0, 2000)}`);
  return parts.join('\n') || '(no output)';
}

// --- Message dispatch ---
