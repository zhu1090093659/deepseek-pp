import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FIREFOX_EXTENSION_ID,
  HOST_NAME,
  SUPPORTED_BROWSER_NAMES,
  createNativeHostManifest,
  parseArgs,
  resolveNativeHostLocations,
} from '../packages/shell-host/lib/installer.mjs';
import { MCP_PROTOCOL_VERSION } from '../core/mcp';
import { SHELL_TOOL_NAMES, SHELL_TOOL_SPECS } from '../core/shell';
import {
  INSTALLER_CURRENT_GAPS,
  INSTALLER_LOCATION_FIXTURES,
  SHELL_HOST_CONTRACT,
} from './fixtures/external-runtime/installer';

const hostScript = resolve('packages/shell-host/native/shell-mcp-host.mjs');
const shellPackage = readJson(resolve('packages/shell-host/package.json'));
const expectedTools = readJson(resolve('tests/fixtures/external-runtime/shell-tools.json'));
const liveChildren = new Set<ReturnType<typeof spawn>>();

afterAll(() => {
  for (const child of liveChildren) child.kill();
  liveChildren.clear();
});

describe('Shell Native Host external contract', () => {
  it('freezes host/package/runtime identities without treating version drift as compatible policy', async () => {
    expect(HOST_NAME).toBe(SHELL_HOST_CONTRACT.nativeHost);
    expect(shellPackage.name).toBe(SHELL_HOST_CONTRACT.packageName);
    expect(shellPackage.version).toBe(SHELL_HOST_CONTRACT.packageVersion);
    expect(shellPackage.engines.node).toBe(SHELL_HOST_CONTRACT.nodeEngine);
    expect(FIREFOX_EXTENSION_ID).toBe(SHELL_HOST_CONTRACT.firefoxExtensionId);

    const response = await callHost(nativeEnvelope('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: 'contract-test', version: '1.0.0' },
    }, 'initialize'));
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'initialize',
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SHELL_HOST_CONTRACT.initializedServer,
        instructions: SHELL_HOST_CONTRACT.instructions,
      },
    });
    expect(INSTALLER_CURRENT_GAPS[0].target).toBe('single-host-version-source-after-T4.5');
  });

  it('compares the exact 12-tool order, complete host schemas, and TypeScript risks', async () => {
    const response = await callHost(nativeEnvelope('tools/list', undefined, 'tools'));
    const tools = response.result.tools as Array<{
      name: string;
      annotations: { risk: string };
    }>;

    expect(tools).toEqual(expectedTools);
    expect(tools.map((tool) => tool.name)).toEqual(SHELL_TOOL_NAMES);
    expect(tools.map((tool) => tool.annotations.risk))
      .toEqual(SHELL_TOOL_SPECS.map((tool) => tool.risk));
  });

  it('freezes successful and invalid tool output envelopes', async () => {
    const status = await callHost(nativeEnvelope('tools/call', {
      name: 'shell_status',
      arguments: {},
    }, 'status'));
    expect(status).toMatchObject({
      jsonrpc: '2.0',
      id: 'status',
      result: {
        content: [{ type: 'text' }],
        structuredContent: {
          ok: true,
          data: {
            platform: expect.any(String),
            nodeVersion: expect.any(String),
            shell: expect.any(String),
            pathEntries: expect.any(Array),
          },
        },
      },
    });

    const badArguments = await callHost(nativeEnvelope('tools/call', {
      name: 'shell_exec',
      arguments: {},
    }, 'bad-arguments'));
    expect(badArguments).toEqual({
      jsonrpc: '2.0',
      id: 'bad-arguments',
      result: {
        isError: true,
        content: [{ type: 'text', text: 'command is required and must be a non-empty string.' }],
      },
    });

    const unknownTool = await callHost(nativeEnvelope('tools/call', {
      name: 'future_tool',
      arguments: {},
    }, 'unknown-tool'));
    expect(unknownTool).toEqual({
      jsonrpc: '2.0',
      id: 'unknown-tool',
      error: { code: -32602, message: 'Unknown tool: future_tool' },
    });
  });

  it('rejects future Native envelopes and malformed JSON-RPC with stable errors', async () => {
    const futureEnvelope = {
      ...nativeEnvelope('initialize', {}, 'future'),
      version: 2,
    };
    await expect(callHost(futureEnvelope)).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid envelope: expected deepseek-pp-mcp-native v1' },
    });

    await expect(callHost({
      protocol: 'deepseek-pp-mcp-native',
      version: 1,
      server: { id: 'contract' },
      message: { jsonrpc: '1.0', id: 'bad', method: 'initialize' },
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid JSON-RPC request.' },
    });
  });
});

describe('Shell Host installer external contract', () => {
  it('freezes install/status/uninstall parsing across all four browsers', () => {
    expect(SUPPORTED_BROWSER_NAMES).toEqual(SHELL_HOST_CONTRACT.browsers);
    for (const command of SHELL_HOST_CONTRACT.commands) {
      for (const browser of SHELL_HOST_CONTRACT.browsers) {
        expect(parseArgs([command, '--browser', browser, '--skip-officecli']))
          .toMatchObject({ command, browser, skipOfficecli: true });
      }
    }
    expect(() => parseArgs(['install', '--browser', 'future-browser']))
      .toThrow('Unsupported browser: future-browser');
  });

  it('freezes macOS, Linux, and Windows manifest/install locations', () => {
    for (const fixture of INSTALLER_LOCATION_FIXTURES) {
      expect(resolveNativeHostLocations(fixture.input), fixture.name).toEqual(fixture.output);
    }
    expect(() => resolveNativeHostLocations({
      os: 'future-os',
      browser: 'chrome',
      home: '/home/contract',
      localAppData: undefined,
    })).toThrow('Unsupported platform: future-os');
  });

  it('freezes Chromium origin and Firefox extension manifests', () => {
    const wrapperPath = '/contract/shell-mcp-host';
    for (const browser of ['chrome', 'chromium', 'edge']) {
      expect(createNativeHostManifest({ browser, extensionId: 'extension-contract' }, wrapperPath))
        .toEqual({
          name: SHELL_HOST_CONTRACT.nativeHost,
          description: 'DeepSeek++ Shell MCP - General purpose shell execution via Native Messaging',
          path: wrapperPath,
          type: 'stdio',
          allowed_origins: ['chrome-extension://extension-contract/'],
        });
    }
    expect(createNativeHostManifest({ browser: 'firefox', extensionId: null }, wrapperPath))
      .toEqual({
        name: SHELL_HOST_CONTRACT.nativeHost,
        description: 'DeepSeek++ Shell MCP - General purpose shell execution via Native Messaging',
        path: wrapperPath,
        type: 'stdio',
        allowed_extensions: [SHELL_HOST_CONTRACT.firefoxExtensionId],
      });
    expect(() => createNativeHostManifest({ browser: 'chrome', extensionId: null }, wrapperPath))
      .toThrow('--extension-id is required for Chrome/Edge/Chromium.');
  });

  it('keeps partial install, checksum skip, and Windows registry behavior classified as gaps', () => {
    expect(INSTALLER_CURRENT_GAPS.slice(1).map((gap) => gap.target)).toEqual([
      'explicit-install-journal-or-partial-state-after-T4.5',
      'fail-closed-checksum-policy-after-T4.5',
      'observable-registry-health-after-T5.1',
    ]);
  });
});

function nativeEnvelope(method: string, params: unknown, id: string) {
  return {
    protocol: 'deepseek-pp-mcp-native',
    version: 1,
    server: { id: 'contract-shell' },
    message: {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    },
  };
}

async function callHost(envelope: unknown): Promise<any> {
  const child = spawn(process.execPath, [hostScript], { stdio: ['pipe', 'pipe', 'pipe'] });
  liveChildren.add(child);
  const body = Buffer.from(JSON.stringify(envelope), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  child.stdin.end(Buffer.concat([header, body]));

  try {
    return await readNativeResponse(child);
  } finally {
    child.kill();
    liveChildren.delete(child);
  }
}

function readNativeResponse(child: ReturnType<typeof spawn>): Promise<any> {
  const stdout = child.stdout;
  if (!stdout) throw new Error('Shell Host stdout pipe is unavailable.');

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Shell Host response.')), 5_000);
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      stdout.removeAllListeners();
      child.removeAllListeners('error');
      callback();
    };

    child.on('error', (error) => finish(() => reject(error)));
    stdout.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < length + 4) return;
      finish(() => {
        try {
          resolve(JSON.parse(buffer.subarray(4, length + 4).toString('utf8')));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}
