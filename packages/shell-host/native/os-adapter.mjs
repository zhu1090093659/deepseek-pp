import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, platform, release as osRelease } from 'node:os';
import { dirname, resolve } from 'node:path';
import { DEFAULT_SHELL, WINDOWS_POWERSHELL_UTF8_PREAMBLE } from './contracts.mjs';

export const PATH_SEPARATOR = platform() === 'win32' ? ';' : ':';
export const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');

const SHELL_ENV_BASE_KEYS = platform() === 'win32'
  ? ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE',
     'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROGRAMDATA',
     'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PUBLIC', 'USERNAME', 'USERDOMAIN',
     'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']
  : ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TEMP', 'TMP',
     'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ'];

const BLOCKED_CHILD_ENV_KEYS = new Set([
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH',
]);

export function initializeHostEnvironment(packageRoot, logLine) {
  const nodeBinDir = dirname(process.execPath);
  const localBinDirs = [
    resolve(packageRoot, 'node_modules', '.bin'),
    resolve(packageRoot, '..', '..', 'node_modules', '.bin'),
  ].filter(existsSync);
  const currentPath = getEnvironmentPath(process.env) || (platform() === 'win32' ? '' : '/usr/bin:/bin');
  const userBinDirs = platform() === 'win32'
    ? [resolve(localAppData, 'OfficeCLI')]
    : [
        resolve(homedir(), '.local', 'bin'),
        resolve(homedir(), '.pyenv', 'shims'),
        resolve(homedir(), 'miniconda3', 'bin'),
        resolve(homedir(), 'anaconda3', 'bin'),
        resolve(homedir(), 'miniforge3', 'bin'),
        resolve(homedir(), 'mambaforge', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
      ];
  const managedPathDirs = new Set([nodeBinDir, ...localBinDirs, ...userBinDirs]);
  const existingPathDirs = splitPath(currentPath).filter(directory => !managedPathDirs.has(directory));
  const hostPath = dedupePathDirs([
    nodeBinDir,
    ...userBinDirs,
    ...readWindowsUserMachinePathDirs(logLine),
    ...existingPathDirs,
    ...localBinDirs,
  ]).join(PATH_SEPARATOR);
  setEnvironmentPath(process.env, hostPath);
  return hostPath;
}

export function createChildEnv(extraEnv) {
  const explicitPath = getExplicitPathOverride(extraEnv);
  const env = {};
  for (const key of SHELL_ENV_BASE_KEYS) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (typeof value !== 'string') continue;
      if (BLOCKED_CHILD_ENV_KEYS.has(key.toUpperCase())) continue;
      env[key] = value;
    }
  }
  const pathValue = explicitPath !== null ? explicitPath : (getEnvironmentPath(env) || getEnvironmentPath(process.env));
  setEnvironmentPath(env, pathValue);
  if (platform() === 'win32') {
    env.PYTHONUTF8 ??= '1';
    env.PYTHONIOENCODING ??= 'utf-8';
  }
  return env;
}

export function createPythonChildEnv() {
  const env = {};
  const keys = platform() === 'win32'
    ? ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']
    : ['HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE'];

  for (const key of keys) {
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  }

  setEnvironmentPath(env, getEnvironmentPath(process.env));
  env.PYTHONUTF8 = '1';
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONNOUSERSITE = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}

export function createShellInvocation(command) {
  if (platform() === 'win32') {
    return {
      shellBin: DEFAULT_SHELL,
      shellArgs: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `${WINDOWS_POWERSHELL_UTF8_PREAMBLE}; ${command}`,
      ],
    };
  }
  return { shellBin: DEFAULT_SHELL, shellArgs: ['-c', command] };
}

export function splitPath(value) {
  return (value || '').split(PATH_SEPARATOR).map(entry => entry.trim()).filter(Boolean);
}

export function getEnvironmentPath(env) {
  const canonicalKey = platform() === 'win32' ? 'Path' : 'PATH';
  if (typeof env[canonicalKey] === 'string') return env[canonicalKey];
  const key = Object.keys(env).find(name => name.toLowerCase() === 'path');
  return key ? env[key] || '' : '';
}

export function setEnvironmentPath(env, value) {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') delete env[key];
  }
  env[platform() === 'win32' ? 'Path' : 'PATH'] = value;
}

export function getWindowsVersionLabel() {
  if (platform() !== 'win32') return null;
  const release = osRelease();
  const parts = release.split('.').map(part => Number.parseInt(part, 10));
  const build = parts[2] || 0;
  if (parts[0] === 10 && build >= 22000) return `Windows 11 (${release})`;
  if (parts[0] === 10) return `Windows 10 (${release})`;
  return `Windows (${release})`;
}

function getExplicitPathOverride(env) {
  if (!env || typeof env !== 'object') return null;
  let value = null;
  for (const [key, candidate] of Object.entries(env)) {
    if (key.toLowerCase() === 'path' && typeof candidate === 'string') value = candidate;
  }
  return value;
}

function dedupePathDirs(dirs) {
  const seen = new Set();
  const result = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const key = platform() === 'win32' ? dir.replace(/[\\/]+$/, '').toLowerCase() : dir.replace(/\/+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(dir);
  }
  return result;
}

function readWindowsUserMachinePathDirs(logLine) {
  if (platform() !== 'win32') return [];
  const command = [
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    "$paths = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))",
    "$paths | Where-Object { $_ } | ForEach-Object { [Environment]::ExpandEnvironmentVariables($_) }",
  ].join('; ');
  try {
    const output = execFileSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command,
    ], {
      encoding: 'utf8',
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return splitPath(output.replace(/\r?\n/g, PATH_SEPARATOR));
  } catch (error) {
    logLine(`Could not read Windows User/Machine PATH: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
