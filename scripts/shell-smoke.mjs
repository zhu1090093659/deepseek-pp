#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST_SCRIPT = resolve(__dirname, 'shell-mcp-host.mjs');
const PROJECT_ROOT = resolve(__dirname, '..');
const LOCAL_BIN_DIR = resolve(PROJECT_ROOT, 'node_modules', '.bin');
const USER_LOCAL_BIN_DIR = resolve(homedir(), '.local', 'bin');

let passed = 0;
let failed = 0;
let reportedShell = null;
let pythonAvailable = false;

function sendNativeMessage(child, message) {
  const json = JSON.stringify(message);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  child.stdin.write(header);
  child.stdin.write(body);
}

function readNativeMessage(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout reading response')), 10_000);
    let headerBuf = Buffer.alloc(0);
    let bodyBuf = Buffer.alloc(0);
    let expectedLength = -1;

    function onData(chunk) {
      if (expectedLength < 0) {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        if (headerBuf.length >= 4) {
          expectedLength = headerBuf.readUInt32LE(0);
          bodyBuf = headerBuf.subarray(4);
          if (bodyBuf.length >= expectedLength) {
            done();
          }
        }
      } else {
        bodyBuf = Buffer.concat([bodyBuf, chunk]);
        if (bodyBuf.length >= expectedLength) {
          done();
        }
      }
    }

    function done() {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      try {
        const json = bodyBuf.subarray(0, expectedLength).toString('utf8');
        resolve(JSON.parse(json));
      } catch (err) {
        reject(err);
      }
    }

    child.stdout.on('data', onData);
  });
}

function spawnHost() {
  return spawn(process.execPath, [HOST_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeEnvelope(method, params, id) {
  return {
    protocol: 'deepseek-pp-mcp-native',
    version: 1,
    server: { id: 'test-shell' },
    message: {
      jsonrpc: '2.0',
      id: id ?? crypto.randomUUID(),
      method,
      ...(params ? { params } : {}),
    },
  };
}

async function testMethod(label, method, params, validate) {
  const child = spawnHost();
  try {
    const envelope = makeEnvelope(method, params);
    sendNativeMessage(child, envelope);
    child.stdin.end();
    const response = await readNativeMessage(child);
    validate(response);
    passed++;
    console.log(`  PASS: ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL: ${label} — ${err.message}`);
  } finally {
    child.kill();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('Shell MCP Host Smoke Tests\n');

await testMethod('initialize', 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: { tools: {} },
  clientInfo: { name: 'test', version: '1.0.0' },
}, (res) => {
  assert(res.jsonrpc === '2.0', 'expected jsonrpc 2.0');
  assert(res.result, 'expected result');
  assert(res.result.protocolVersion === '2025-06-18', 'expected protocol version');
  assert(res.result.serverInfo.name === 'deepseek-pp-shell', 'expected server name');
});

await testMethod('tools/list', 'tools/list', undefined, (res) => {
  assert(res.result, 'expected result');
  assert(Array.isArray(res.result.tools), 'expected tools array');
  assert(res.result.tools.length === 4, `expected 4 tools, got ${res.result.tools.length}`);
  const names = res.result.tools.map(t => t.name);
  assert(names.includes('shell_exec'), 'expected shell_exec');
  assert(names.includes('shell_status'), 'expected shell_status');
  assert(names.includes('python_status'), 'expected python_status');
  assert(names.includes('python_exec'), 'expected python_exec');
});

await testMethod('tools/call shell_status', 'tools/call', {
  name: 'shell_status',
  arguments: {},
}, (res) => {
  assert(res.result, 'expected result');
  const data = res.result.structuredContent?.data;
  assert(data?.platform, 'expected platform in status');
  assert(data?.nodeVersion, 'expected nodeVersion');
  assert(data?.shell, 'expected shell in status');
  assert(data?.osRelease, 'expected osRelease in status');
  assert(Array.isArray(data?.pathEntries), 'expected pathEntries in status');
  if (data.platform === 'win32') {
    assert(data.windowsVersion, 'expected windowsVersion on Windows');
  }
  reportedShell = data.shell;
});

await testMethod('tools/call python_status', 'tools/call', {
  name: 'python_status',
  arguments: {},
}, (res) => {
  assert(res.result, 'expected result');
  const data = res.result.structuredContent?.data;
  assert(typeof data?.available === 'boolean', 'expected boolean available in python status');
  assert(data?.limits?.timeoutMsDefault === 10000, 'expected python timeout default');
  assert(data?.packages && typeof data.packages === 'object', 'expected package availability map');
  pythonAvailable = data.available === true;
});

if (pythonAvailable) {
  await testMethod('tools/call python_exec (calculation)', 'tools/call', {
    name: 'python_exec',
    arguments: { code: 'import json, math\nprint(json.dumps({"sqrt2": round(math.sqrt(2), 6)}))' },
  }, (res) => {
    assert(res.result, 'expected result');
    const data = res.result.structuredContent?.data;
    assert(data?.exitCode === 0, `expected exitCode 0, got ${data?.exitCode}`);
    assert(data.stdout.includes('1.414214'), `expected sqrt output, got "${data.stdout}"`);
  });
}

await testMethod('tools/call shell_exec (echo)', 'tools/call', {
  name: 'shell_exec',
  arguments: { command: 'echo hello_world' },
}, (res) => {
  assert(res.result, 'expected result');
  const data = res.result.structuredContent?.data;
  assert(data, 'expected structured data');
  assert(data.exitCode === 0, `expected exitCode 0, got ${data.exitCode}`);
  assert(data.shell === reportedShell, `expected shell_exec shell ${data.shell} to match shell_status ${reportedShell}`);
  assert(data.stdout.trim() === 'hello_world', `expected hello_world, got "${data.stdout.trim()}"`);
});

await testMethod('tools/call shell_exec (unicode stdout)', 'tools/call', {
  name: 'shell_exec',
  arguments: { command: platform() === 'win32' ? 'Write-Output "中文路径-123"' : 'printf "中文路径-123\\n"' },
}, (res) => {
  assert(res.result, 'expected result');
  const data = res.result.structuredContent?.data;
  assert(data?.exitCode === 0, `expected exitCode 0, got ${data?.exitCode}`);
  assert(data.stdout.trim() === '中文路径-123', `expected unicode output, got "${data.stdout.trim()}"`);
});

{
  const inheritedPath = process.env.Path || process.env.PATH || '';
  const expectedPrefix = platform() === 'win32' ? 'C:\\deepseek-expected' : '/tmp/deepseek-expected';
  const wrongPrefix = platform() === 'win32' ? 'C:\\deepseek-wrong' : '/tmp/deepseek-wrong';
  const pathSep = platform() === 'win32' ? ';' : ':';
  const command = platform() === 'win32'
    ? 'Write-Output $env:Path'
    : 'printf "%s\\n" "$PATH"';
  const env = platform() === 'win32'
    ? {
        PATH: `${wrongPrefix}${pathSep}${inheritedPath}`,
        Path: `${expectedPrefix}${pathSep}${inheritedPath}`,
      }
    : {
        PATH: `${expectedPrefix}${pathSep}${inheritedPath}`,
      };

  await testMethod('tools/call shell_exec (PATH env override)', 'tools/call', {
    name: 'shell_exec',
    arguments: { command, env },
  }, (res) => {
    assert(res.result, 'expected result');
    const data = res.result.structuredContent?.data;
    assert(data?.exitCode === 0, `expected exitCode 0, got ${data?.exitCode}`);
    assert(data.stdout.trim().startsWith(expectedPrefix), `expected PATH to start with ${expectedPrefix}, got "${data.stdout.trim()}"`);
  });
}

if (platform() !== 'win32') {
  await testMethod('tools/call shell_exec (PATH order)', 'tools/call', {
    name: 'shell_exec',
    arguments: { command: 'node -e "console.log(process.env.PATH || \'\')"' },
  }, (res) => {
    assert(res.result, 'expected result');
    const data = res.result.structuredContent?.data;
    assert(data?.exitCode === 0, `expected exitCode 0, got ${data?.exitCode}`);
    const dirs = data.stdout.trim().split(':');
    const userLocalIndex = dirs.indexOf(USER_LOCAL_BIN_DIR);
    const localBinIndex = dirs.indexOf(LOCAL_BIN_DIR);
    assert(userLocalIndex >= 0, `expected ${USER_LOCAL_BIN_DIR} in PATH`);
    assert(localBinIndex >= 0, `expected ${LOCAL_BIN_DIR} in PATH`);
    assert(userLocalIndex < localBinIndex, 'expected user OfficeCLI locations before project node_modules/.bin');
  });
}

await testMethod('tools/call shell_exec (failing command)', 'tools/call', {
  name: 'shell_exec',
  arguments: { command: 'exit 42' },
}, (res) => {
  assert(res.result, 'expected result');
  assert(res.result.isError === true, 'expected isError for non-zero exit');
  assert(res.result.structuredContent?.data?.exitCode === 42, `expected exitCode 42`);
});

await testMethod('tools/call shell_exec (missing command param)', 'tools/call', {
  name: 'shell_exec',
  arguments: {},
}, (res) => {
  assert(res.result, 'expected result');
  assert(res.result.isError === true, 'expected isError for missing command');
});

await testMethod('unknown method', 'unknown/method', {}, (res) => {
  assert(res.error, 'expected error');
  assert(res.error.code === -32601, 'expected method not found code');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
