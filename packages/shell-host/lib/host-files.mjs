import { chmodSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';

const LOG_META_FILENAME = 'shell-mcp-host.log-meta';
export const REQUIRED_HOST_RUNTIME_FILES = [
  'contracts.mjs',
  'file-provider.mjs',
  'framing.mjs',
  'logger.mjs',
  'os-adapter.mjs',
  'picker-provider.mjs',
  'process-provider.mjs',
  'router.mjs',
  'session-provider.mjs',
  'shell-mcp-host.mjs',
  'skill-provider.mjs',
];

export function copyHostRuntime(nativeSourceDir, installDir) {
  cpSync(nativeSourceDir, installDir, { recursive: true, force: true });
  const hostPath = resolve(installDir, 'shell-mcp-host.mjs');
  const missing = getMissingHostRuntimeFiles(installDir);
  if (missing.length > 0) throw new Error(`Shell Host runtime copy is incomplete: ${missing.join(', ')}`);
  if (platform() !== 'win32') chmodSync(hostPath, 0o755);
  return hostPath;
}

export function getMissingHostRuntimeFiles(installDir) {
  return REQUIRED_HOST_RUNTIME_FILES.filter(filename => !existsSync(resolve(installDir, filename)));
}

export function createWrapper(hostPath, logFile) {
  if (logFile && /[\0\r\n]/.test(logFile)) {
    throw new Error('--log-file must be a single filesystem path without control characters.');
  }
  const installDir = dirname(hostPath);
  const nodePath = process.execPath;
  const metaPath = resolve(installDir, LOG_META_FILENAME);

  if (platform() === 'win32') {
    const wrapperPath = resolve(installDir, 'shell-mcp-host.bat');
    const setLine = logFile ? `set "DPP_LOG_FILE=${logFile.replaceAll('%', '%%')}"\r\n` : '';
    const content = `@echo off\r\n${setLine}"${nodePath}" "${hostPath}" %*\r\n`;
    writeFileSync(wrapperPath, content);
    writeLogMeta(metaPath, logFile);
    return wrapperPath;
  }

  const wrapperPath = resolve(installDir, 'shell-mcp-host');
  const envPrefix = logFile ? `DPP_LOG_FILE=${escapeShellValue(logFile)} ` : '';
  const content = `#!/bin/sh\n${envPrefix}exec "${nodePath}" "${hostPath}" "$@"\n`;
  writeFileSync(wrapperPath, content, { mode: 0o755 });
  writeLogMeta(metaPath, logFile);
  return wrapperPath;
}

export function detectLogFile(wrapperPath) {
  const metaPath = resolve(dirname(wrapperPath), LOG_META_FILENAME);
  if (!existsSync(metaPath)) return null;
  try {
    const data = JSON.parse(readFileSync(metaPath, 'utf8'));
    return typeof data.logFile === 'string' ? data.logFile : null;
  } catch (error) {
    throw new Error(`Invalid Shell Host log metadata at ${metaPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function escapeShellValue(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeLogMeta(metaPath, logFile) {
  if (logFile) writeFileSync(metaPath, JSON.stringify({ logFile }), 'utf8');
  else rmSync(metaPath, { force: true });
}
