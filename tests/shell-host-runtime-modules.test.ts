import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-ignore - Shell Host runtime modules are executable .mjs files.
import { copyHostRuntime } from '../packages/shell-host/lib/installer.mjs';
// @ts-ignore - Shell Host runtime modules are executable .mjs files.
import { REQUIRED_HOST_RUNTIME_FILES, getMissingHostRuntimeFiles } from '../packages/shell-host/lib/host-files.mjs';
// @ts-ignore - Shell Host runtime modules are executable .mjs files.
import { createNativeMessageChannel, NATIVE_EOF } from '../packages/shell-host/native/framing.mjs';
// @ts-ignore - Shell Host runtime modules are executable .mjs files.
import { createToolRegistry } from '../packages/shell-host/native/router.mjs';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Shell Host modular runtime ownership', () => {
  it('decodes fragmented and queued Native frames in order', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const logs: string[] = [];
    const channel = createNativeMessageChannel({
      input,
      output,
      logLine: (message: unknown) => logs.push(String(message)),
      onInvalidFrame: () => { throw new Error('unexpected invalid frame'); },
    });
    const first = { sequence: 1, text: '分片' };
    const second = { sequence: 2, text: 'queued' };
    const firstFrame = createNativeFrame(first);
    const secondFrame = createNativeFrame(second);

    const firstRead = channel.readMessage();
    input.write(firstFrame.subarray(0, 2));
    input.write(firstFrame.subarray(2, 7));
    input.end(Buffer.concat([firstFrame.subarray(7), secondFrame]));

    await expect(firstRead).resolves.toEqual(first);
    await expect(channel.readMessage()).resolves.toEqual(second);
    await expect(channel.readMessage()).resolves.toBe(NATIVE_EOF);
    expect(logs).toEqual([]);
  });

  it('rejects duplicate, missing, and undeclared tool registrations', () => {
    const definitions = [{ name: 'one' }, { name: 'two' }];
    const handler = () => ({ content: [] });

    expect(() => createToolRegistry(definitions, [[{ name: 'one', handle: handler }]]))
      .toThrow('Shell tool handlers missing: two');
    expect(() => createToolRegistry(definitions, [[
      { name: 'one', handle: handler },
      { name: 'one', handle: handler },
      { name: 'two', handle: handler },
    ]])).toThrow('Shell tool handler registered more than once: one');
    expect(() => createToolRegistry(definitions, [[
      { name: 'one', handle: handler },
      { name: 'two', handle: handler },
      { name: 'future', handle: handler },
    ]])).toThrow('Shell tool handler is not declared in the catalog: future');
  });

  it('copies the complete modular runtime and executes the installed entrypoint', async () => {
    const installDir = mkdtempSync(join(tmpdir(), 'deepseek-pp-shell-runtime-'));
    tempRoots.push(installDir);
    const hostPath = copyHostRuntime(resolve('packages/shell-host/native'), installDir);

    expect(getMissingHostRuntimeFiles(installDir)).toEqual([]);
    for (const moduleName of REQUIRED_HOST_RUNTIME_FILES) {
      expect(existsSync(join(installDir, moduleName)), moduleName).toBe(true);
    }

    await expect(callHost(hostPath, {
      protocol: 'deepseek-pp-mcp-native',
      version: 1,
      server: { id: 'installed-runtime' },
      message: {
        jsonrpc: '2.0',
        id: 'initialize',
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      },
    })).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 'initialize',
      result: { serverInfo: { name: 'deepseek-pp-shell', version: '1.0.0' } },
    });

    rmSync(join(installDir, 'router.mjs'));
    expect(getMissingHostRuntimeFiles(installDir)).toEqual(['router.mjs']);
  });

  it('preserves the explicit shell timeout result through the process provider', async () => {
    const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 5' : 'sleep 5';
    const response = await callHost(resolve('packages/shell-host/native/shell-mcp-host.mjs'), {
      protocol: 'deepseek-pp-mcp-native',
      version: 1,
      server: { id: 'timeout-runtime' },
      message: {
        jsonrpc: '2.0',
        id: 'timeout',
        method: 'tools/call',
        params: { name: 'shell_exec', arguments: { command, timeout_ms: 1_000 } },
      },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 'timeout',
      result: {
        isError: true,
        structuredContent: { ok: false, data: { exitCode: -1, timedOut: true } },
      },
    });
  });
});

function createNativeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

function callHost(hostPath: string, envelope: unknown): Promise<any> {
  const child = spawn(process.execPath, [hostPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  return new Promise((resolveResponse, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Installed Shell Host timed out. stderr: ${stderr}`));
    }, 5_000);

    const finish = (callback: () => void) => {
      clearTimeout(timer);
      child.kill();
      callback();
    };
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', error => finish(() => reject(error)));
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length < 4) return;
      const length = stdout.readUInt32LE(0);
      if (stdout.length < length + 4) return;
      finish(() => {
        try {
          resolveResponse(JSON.parse(stdout.subarray(4, length + 4).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
    child.stdin.end(createNativeFrame(envelope));
  });
}
