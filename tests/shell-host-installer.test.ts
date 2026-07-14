import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// @ts-ignore - .mjs files have no type declarations; tested via runtime only
import { createWrapper, detectLogFile, escapeShellValue, parseArgs } from '../packages/shell-host/lib/installer.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('installer parseArgs --log-file', () => {
  it('accepts --log-file with a path', () => {
    const args = parseArgs(['install', '--log-file', '/tmp/dpp.log']);
    expect(args.logFile).toBe('/tmp/dpp.log');
  });

  it('throws when --log-file has no value', () => {
    expect(() => parseArgs(['install', '--log-file'])).toThrowError(/requires a path argument/);
  });

  it('defaults logFile to null when --log-file is absent', () => {
    const args = parseArgs(['install', '--skip-officecli']);
    expect(args.logFile).toBeNull();
  });
});

describe('installer createWrapper + detectLogFile round-trip', () => {
  it('preserves a simple path across write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');
    const logFile = '/tmp/dpp-host.log';

    const wrapperPath = createWrapper(hostPath, logFile);
    expect(existsSync(wrapperPath)).toBe(true);
    expect(detectLogFile(wrapperPath)).toBe(logFile);
  });

  it('preserves a path with spaces across write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');
    const logFile = '/tmp/my deepseek path/dpp-host.log';

    const wrapperPath = createWrapper(hostPath, logFile);
    expect(detectLogFile(wrapperPath)).toBe(logFile);
  });

  it('preserves a path with single quotes across write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');
    const logFile = '/tmp/o\'reilly/dpp-host.log';

    const wrapperPath = createWrapper(hostPath, logFile);
    expect(detectLogFile(wrapperPath)).toBe(logFile);
  });

  it('preserves a Windows-style path with backslashes across write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');
    const logFile = 'C:\\Users\\me\\dpp-host.log';

    const wrapperPath = createWrapper(hostPath, logFile);
    expect(detectLogFile(wrapperPath)).toBe(logFile);
  });

  it('preserves a Windows-style path with spaces across write and read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');
    const logFile = 'C:\\Program Files\\dpp-host.log';

    const wrapperPath = createWrapper(hostPath, logFile);
    expect(detectLogFile(wrapperPath)).toBe(logFile);
  });

  it('returns null when no log file is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');

    const wrapperPath = createWrapper(hostPath, null);
    expect(detectLogFile(wrapperPath)).toBeNull();
  });

  it('returns null when the sidecar meta file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const wrapperPath = join(dir, 'shell-mcp-host');
    expect(detectLogFile(wrapperPath)).toBeNull();
  });

  it('surfaces corrupt log metadata instead of silently disabling logging', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const wrapperPath = join(dir, 'shell-mcp-host');
    writeFileSync(join(dir, 'shell-mcp-host.log-meta'), '{broken', 'utf8');

    expect(() => detectLogFile(wrapperPath)).toThrow('Invalid Shell Host log metadata');
  });

  it('rejects log paths that could inject wrapper commands', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');

    expect(() => createWrapper(hostPath, '/tmp/host.log\nmalicious-command'))
      .toThrow('--log-file must be a single filesystem path without control characters.');
  });
});

describe('installer escapeShellValue', () => {
  it('wraps a simple value in single quotes', () => {
    expect(escapeShellValue('/tmp/dpp.log')).toBe("'/tmp/dpp.log'");
  });

  it('escapes embedded single quotes', () => {
    expect(escapeShellValue("/tmp/o'reilly.log")).toBe("'/tmp/o'\\''reilly.log'");
  });

  it('handles empty string', () => {
    expect(escapeShellValue('')).toBe("''");
  });
});

describe('installer createWrapper backward compatibility', () => {
  it('produces identical wrapper when logFile is null (no env prefix)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dpp-wrapper-'));
    tempRoots.push(dir);
    const hostPath = join(dir, 'shell-mcp-host.mjs');
    writeFileSync(hostPath, '', 'utf8');

    const wrapperPath = createWrapper(hostPath, null);
    const content = readFileSync(wrapperPath, 'utf8');
    expect(content).not.toContain('DPP_LOG_FILE');
  });
});
