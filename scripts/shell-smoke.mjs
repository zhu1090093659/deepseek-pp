#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { homedir, platform, tmpdir } from 'node:os';
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

function spawnHost(extraHostEnv) {
  const options = { stdio: ['pipe', 'pipe', 'pipe'] };
  // extraHostEnv simulates secrets present in the host's OWN environment
  // (e.g. AWS_SECRET_ACCESS_KEY, DATABASE_URL). When absent, inherit unchanged.
  if (extraHostEnv) options.env = { ...process.env, ...extraHostEnv };
  return spawn(process.execPath, [HOST_SCRIPT], options);
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
  const names = res.result.tools.map(t => t.name);
  const requiredTools = [
    'shell_exec',
    'shell_status',
    'python_status',
    'python_exec',
    'local_skill_preview',
    'local_folder_pick',
    'shell_session_begin',
    'shell_session_exec',
    'shell_session_end',
  ];
  assert(res.result.tools.length >= requiredTools.length, `expected at least ${requiredTools.length} tools, got ${res.result.tools.length}`);
  for (const tool of requiredTools) {
    assert(names.includes(tool), `expected ${tool}`);
  }
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
  assert(data?.features?.windowsFolderPickerEncodedCommand === true, 'expected encoded Windows folder picker capability');
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

// --- Persistent shell session ---
//
// Reproduces the issue #230 scenario shape: a resident tool's state must
// survive across separate shell_session_exec calls within one session, and
// cross-session isolation must hold.

const IS_WIN = platform() === 'win32';
const PRINT_CWD = IS_WIN ? 'Get-Location' : 'pwd';
const CD_PARENT = IS_WIN ? 'Set-Location ..' : 'cd ..';
const EXPORT_VAR = IS_WIN ? '$env:DPP_SMOKE = "persisted"' : 'export DPP_SMOKE=persisted';
const PRINT_VAR_CMD = IS_WIN ? 'Write-Output $env:DPP_SMOKE' : 'echo $DPP_SMOKE';

// The session_id from begin must be threaded into subsequent exec/end calls, so
// use an explicit imperative block that talks to one long-lived host instead
// of the per-call testMethod helper (which closes stdin after each request).
{
  const child = spawnHost();
  let sessionId = null;
  const label = 'shell_session begin/exec/end (cwd + env persist)';
  try {
    // begin: start the session in tmpdir so we can verify cwd drifts from there.
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_begin',
      arguments: { cwd: tmpdir() },
    }));
    let res = await readNativeMessage(child);
    sessionId = res.result?.structuredContent?.data?.session_id;
    assert(sessionId, 'expected session_id from begin');
    assert(res.result?.structuredContent?.data?.cwd === tmpdir(), 'expected begin cwd to match requested');

    // exec: basic stdout
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: 'echo first_in_session' },
    }));
    res = await readNativeMessage(child);
    assert(res.result?.structuredContent?.data?.exitCode === 0, `expected exit 0, got ${res.result?.structuredContent?.data?.exitCode}`);
    assert(res.result?.structuredContent?.data?.stdout.trim() === 'first_in_session', `expected first_in_session, got "${res.result?.structuredContent?.data?.stdout}"`);

    // exec: cwd persists across calls (cd .. then pwd must reflect the change)
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: CD_PARENT },
    }));
    await readNativeMessage(child);
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: PRINT_CWD },
    }));
    res = await readNativeMessage(child);
    const cwdAfter = res.result?.structuredContent?.data?.stdout.trim();
    assert(cwdAfter !== tmpdir() && cwdAfter.length > 0, `expected cwd to have drifted from ${tmpdir()} (got "${cwdAfter}")`);

    // exec: env export persists
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: EXPORT_VAR },
    }));
    await readNativeMessage(child);
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: PRINT_VAR_CMD },
    }));
    res = await readNativeMessage(child);
    assert(res.result?.structuredContent?.data?.stdout.trim() === 'persisted', `expected persisted env var, got "${res.result?.structuredContent?.data?.stdout}"`);

    // end
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_end',
      arguments: { session_id: sessionId },
    }));
    res = await readNativeMessage(child);
    assert(res.result?.structuredContent?.data?.closed === true, 'expected session closed');

    // exec after end: must report not found
    sendNativeMessage(child, makeEnvelope('tools/call', {
      name: 'shell_session_exec',
      arguments: { session_id: sessionId, command: 'echo nope' },
    }));
    res = await readNativeMessage(child);
    assert(res.result?.isError === true, 'expected isError for exec after end');
    assert(/Session not found|shell has exited/.test(res.result?.content?.[0]?.text || ''), `expected not-found message, got "${res.result?.content?.[0]?.text}"`);

    passed++;
    console.log(`  PASS: ${label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL: ${label} — ${err.message}`);
  } finally {
    child.kill();
  }
}

await testMethod('shell_session_exec with unknown session', 'tools/call', {
  name: 'shell_session_exec',
  arguments: { session_id: 'definitely-not-a-real-session-id', command: 'echo x' },
}, (res) => {
  assert(res.result?.isError === true, 'expected isError for unknown session');
  assert(/Session not found/.test(res.result?.content?.[0]?.text || ''), 'expected not-found message');
});

await testMethod('shell_session_end missing session_id', 'tools/call', {
  name: 'shell_session_end',
  arguments: {},
}, (res) => {
  assert(res.result?.isError === true, 'expected isError for missing session_id');
});

// --- H-01 regression: child env isolation (issue #236) ---
// The host must NOT leak its own environment secrets into spawned tools, must
// still pass explicit safe env through, and must drop dynamic-loader hijack
// keys. Drive this through the real shell_exec / shell_session tool path so the
// old `{ ...process.env, ...extraEnv }` implementation would fail here.
{
  const FAKE_HOST_SECRETS = {
    AWS_SECRET_ACCESS_KEY: 'FAKE_AWS_LEAK_SHOULD_NOT_APPEAR',
    DATABASE_URL: 'postgres://FAKE_DB_LEAK_SHOULD_NOT_APPEAR',
  };
  const TOOL_ENV = {
    DPP_SAFE_ENV: 'safe-value-7f3a',
    LD_PRELOAD: '/tmp/dpp-evil.so',
    DYLD_INSERT_LIBRARIES: '/tmp/dpp-evil.dylib',
  };
  const PROBE = platform() === 'win32'
    ? 'Write-Output "DPP_ENV_PROBE|SAFE=$env:DPP_SAFE_ENV|AWS=$env:AWS_SECRET_ACCESS_KEY|DB=$env:DATABASE_URL|LD=$env:LD_PRELOAD|DYLD=$env:DYLD_INSERT_LIBRARIES"'
    : 'printf "DPP_ENV_PROBE|SAFE=%s|AWS=%s|DB=%s|LD=%s|DYLD=%s\\n" "$DPP_SAFE_ENV" "$AWS_SECRET_ACCESS_KEY" "$DATABASE_URL" "$LD_PRELOAD" "$DYLD_INSERT_LIBRARIES"';

  function assertEnvIsolated(out, context) {
    assert(out.includes('SAFE=safe-value-7f3a'), `${context}: explicit env should pass through, got "${out}"`);
    assert(!out.includes('FAKE_AWS_LEAK'), `${context}: host AWS secret leaked into child — "${out}"`);
    assert(!out.includes('FAKE_DB_LEAK'), `${context}: host DATABASE_URL leaked into child — "${out}"`);
    assert(!out.includes('dpp-evil.so'), `${context}: LD_PRELOAD was not blocked — "${out}"`);
    assert(!out.includes('dpp-evil.dylib'), `${context}: DYLD_INSERT_LIBRARIES was not blocked — "${out}"`);
  }

  // shell_exec
  {
    const child = spawnHost(FAKE_HOST_SECRETS);
    const label = 'shell_exec env isolation: drops host secrets + loader keys, keeps explicit env (H-01)';
    try {
      sendNativeMessage(child, makeEnvelope('tools/call', {
        name: 'shell_exec',
        arguments: { command: PROBE, env: TOOL_ENV },
      }));
      const res = await readNativeMessage(child);
      assertEnvIsolated(res.result?.structuredContent?.data?.stdout || '', 'shell_exec');
      passed++;
      console.log(`  PASS: ${label}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${label} — ${err.message}`);
    } finally {
      child.kill();
    }
  }

  // shell_session_begin + shell_session_exec (same invariants on a persistent shell)
  {
    const child = spawnHost(FAKE_HOST_SECRETS);
    const label = 'shell_session env isolation: persistent shell keeps explicit env, no host secrets/loader keys (H-01)';
    try {
      sendNativeMessage(child, makeEnvelope('tools/call', {
        name: 'shell_session_begin',
        arguments: { env: TOOL_ENV },
      }));
      let res = await readNativeMessage(child);
      const sessionId = res.result?.structuredContent?.data?.session_id;
      assert(sessionId, 'expected session_id from begin');

      sendNativeMessage(child, makeEnvelope('tools/call', {
        name: 'shell_session_exec',
        arguments: { session_id: sessionId, command: PROBE },
      }));
      res = await readNativeMessage(child);
      assertEnvIsolated(res.result?.structuredContent?.data?.stdout || '', 'shell_session_exec');

      sendNativeMessage(child, makeEnvelope('tools/call', {
        name: 'shell_session_end',
        arguments: { session_id: sessionId },
      }));
      await readNativeMessage(child).catch(() => {});
      passed++;
      console.log(`  PASS: ${label}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL: ${label} — ${err.message}`);
    } finally {
      child.kill();
    }
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
