import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, platform } from 'node:os';
import {
  DEFAULT_SHELL,
  DEFAULT_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_MARKER_PREFIX,
  SESSION_MAX_OUTPUT_BYTES,
} from './contracts.mjs';
import { createChildEnv } from './os-adapter.mjs';
import { formatExecSummary } from './process-provider.mjs';

export function createSessionProvider({ logLine }) {
  const shellSessions = new Map();

  function createPersistentShellArgs(shell) {
    // Keep the shell reading commands from stdin so subsequent commands reuse the
    // same process. `-NonInteractive` on Windows keeps PowerShell from printing
    // prompts; `-Command -` makes it read a script from stdin. POSIX shells with
    // no script argument and `-s` read commands from stdin — crucially the arg
    // array must be empty so argv[0] (the binary path, supplied by spawn) is the
    // only positional and the shell doesn't try to execute a stray arg as a script.
    if (platform() === 'win32') {
      return ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'];
    }
    return ['-s'];
  }

  function buildSessionEndMarkerLine(token) {
    // Print the marker + exit code. POSIX uses $?; PowerShell uses $LASTEXITCODE
    // (falls back to 0 when no native command ran, which matches shell semantics
    // for pure-shell commands). The random token makes accidental marker collisions
    // in command output effectively impossible.
    if (platform() === 'win32') {
      return `Write-Output '${SESSION_MARKER_PREFIX}${token}__:'$LASTEXITCODE`;
    }
    return `printf '__DPP_SESSION_END__%s__:%s\\n' "${token}" "$?"`;
  }

  async function beginShellSession(args) {
    const requestedShell = typeof args?.shell === 'string' && args.shell.trim() ? args.shell.trim() : null;
    const cwd = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : homedir();
    const env = createChildEnv(args?.env);
    const shellBin = requestedShell || DEFAULT_SHELL;
    const shellArgs = createPersistentShellArgs(requestedShell);

    let child;
    try {
      // Run the session shell as its own process group leader so we can tear down
      // the whole tree — shell + resident grandchildren (e.g. an OfficeCLI
      // resident process) — with a single negative-PID kill. Without this, a
      // SIGKILL to the shell alone leaves the resident as an orphan holding the
      // document file lock, which is exactly the failure mode in issue #230.
      //
      // detached:true is POSIX-only here. On Windows, CREATE_NEW_PROCESS_GROUP +
      // `powershell -Command -` makes PowerShell see stdin as a non-console
      // stream, treat the empty read as a completed script, and exit immediately
      // (exit 0) — so the session dies before any shell_session_exec runs. The
      // Windows tear-down path in killSessionProcessGroup already falls back to a
      // direct kill (no process groups on Win32), so dropping detached there loses
      // nothing.
      const spawnOptions = {
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      };
      if (platform() !== 'win32') spawnOptions.detached = true;
      child = spawn(shellBin, shellArgs, spawnOptions);
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to start persistent shell: ${err.message}` }],
      };
    }

    const sessionId = randomUUID();
    const session = {
      id: sessionId,
      child,
      shell: shellBin,
      cwd,
      env,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      idleTimer: null,
      closed: false,
    };

    // Between commands the shell blocks reading stdin and emits nothing, so we do
    // not attach a background drain listener — runInSession takes exclusive
    // ownership of stdout/stderr for the duration of each command. A second 'data'
    // listener here would race with it and swallow the marker bytes.
    child.on('exit', () => {
      session.closed = true;
      if (shellSessions.has(sessionId)) closeShellSession(sessionId, 'process_exited');
    });

    shellSessions.set(sessionId, session);
    armSessionIdleTimer(session);

    return {
      content: [{ type: 'text', text: `Persistent shell session ${sessionId} started (${shellBin}).` }],
      structuredContent: {
        ok: true,
        data: {
          session_id: sessionId,
          shell: shellBin,
          cwd,
          pid: typeof child.pid === 'number' ? child.pid : null,
          idleTimeoutMs: SESSION_IDLE_TIMEOUT_MS,
        },
      },
    };
  }

  function armSessionIdleTimer(session) {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      closeShellSession(session.id, 'idle_timeout');
    }, SESSION_IDLE_TIMEOUT_MS);
  }

  function killSessionProcessGroup(child) {
    if (!child || child.exitCode !== null || typeof child.pid !== 'number') return;
    // POSIX: the session shell is a process-group leader (detached:true), so a
    // negative PID signal reaches the whole tree — including resident
    // grandchildren (OfficeCLI resident, watch servers) that would otherwise
    // outlive the shell and keep the document locked.
    if (platform() !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL');
        return;
      } catch (error) {
        logLine(`Could not kill session process group ${child.pid}; falling back to the shell process: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Windows has no process groups; fall back to killing the shell. Resident
    // grandchildren there typically reattach when the next command opens the file,
    // and Windows Job Objects would be needed for true tree kill (out of scope).
    try {
      child.kill('SIGKILL');
    } catch (error) {
      logLine(`Could not kill session shell ${child.pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function closeShellSession(sessionId, reason) {
    const session = shellSessions.get(sessionId);
    if (!session) return;
    shellSessions.delete(sessionId);
    session.closed = true;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    killSessionProcessGroup(session.child);
    logLine(`Session ${sessionId} closed (${reason}).`);
  }

  async function execInShellSession(args) {
    const sessionId = args?.session_id;
    const command = args?.command;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return { isError: true, content: [{ type: 'text', text: 'session_id is required.' }] };
    }
    if (typeof command !== 'string' || command.trim().length === 0) {
      return { isError: true, content: [{ type: 'text', text: 'command is required and must be a non-empty string.' }] };
    }

    const session = shellSessions.get(sessionId);
    if (!session) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Session not found: ${sessionId}. It may have been closed, expired (idle timeout), or its shell exited. Open a new session with shell_session_begin.` }],
      };
    }
    if (session.closed) {
      shellSessions.delete(sessionId);
      return {
        isError: true,
        content: [{ type: 'text', text: `Session shell has exited: ${sessionId}. Open a new session with shell_session_begin.` }],
      };
    }

    const timeoutMs = typeof args.timeout_ms === 'number' && args.timeout_ms >= 1000
      ? Math.min(args.timeout_ms, 600_000)
      : DEFAULT_TIMEOUT_MS;

    // Refresh idle window on activity.
    if (session.idleTimer) clearTimeout(session.idleTimer);

    try {
      const result = await runInSession(session, command, { timeoutMs });
      session.lastActivityAt = Date.now();
      armSessionIdleTimer(session);
      return {
        content: [{ type: 'text', text: formatExecSummary(result) }],
        structuredContent: { ok: result.exitCode === 0, data: result },
        isError: result.exitCode !== 0,
      };
    } catch (err) {
      // A timeout or shell crash means the session is unrecoverable.
      closeShellSession(sessionId, 'exec_failed');
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    }
  }

  function runInSession(session, command, { timeoutMs }) {
    return new Promise((resolve, reject) => {
      const { child } = session;
      const token = randomUUID();
      const markerLine = buildSessionEndMarkerLine(token);
      const markerText = `${SESSION_MARKER_PREFIX}${token}__:`;

      // One write: the user's command, then the exit-code marker. POSIX shells
      // execute line by line; PowerShell in `-Command -` mode reads the whole
      // stdin script but still runs statements in order.
      const script = platform() === 'win32'
        ? `${command}\n${markerLine}\n`
        : `${command}\n${markerLine}\n`;
      try {
        child.stdin.write(script);
      } catch (err) {
        reject(new Error(`Failed to write to session shell: ${err.message}`));
        return;
      }

      const stdoutChunks = [];
      let stdoutBytes = 0;
      let stderrText = '';
      let stderrBytes = 0;
      let resolved = false;
      let timedOut = false;
      let onExit = null;

      const timer = setTimeout(() => {
        timedOut = true;
        detach();
        reject(new Error(`Command timed out after ${timeoutMs} ms; session shell killed.`));
      }, timeoutMs);

      function detach() {
        child.stdout.off('data', onStdout);
        child.stderr.off('data', onStderr);
        if (onExit) child.off('exit', onExit);
      }

      function onStderr(chunk) {
        if (stderrBytes < SESSION_MAX_OUTPUT_BYTES) {
          const remaining = SESSION_MAX_OUTPUT_BYTES - stderrBytes;
          stderrText += chunk.toString('utf8').slice(0, remaining);
        }
        stderrBytes += chunk.length;
      }

      function onStdout(chunk) {
        const text = chunk.toString('utf8');
        // Scan for the marker line; accumulate everything before it as stdout.
        const combined = stdoutChunks.concat([text]).join('');
        const markerIdx = combined.indexOf(markerText);
        if (markerIdx === -1) {
          // Not yet; keep what we have under the byte budget.
          stdoutChunks.length = 0;
          stdoutChunks.push(combined);
          stdoutBytes = Buffer.byteLength(combined, 'utf8');
          if (stdoutBytes > SESSION_MAX_OUTPUT_BYTES) {
            stdoutChunks[0] = stdoutChunks[0].slice(0, SESSION_MAX_OUTPUT_BYTES);
          }
          return;
        }

        // Marker found. Parse exit code from the rest of the marker line.
        resolved = true;
        clearTimeout(timer);
        detach();

        const before = combined.slice(0, markerIdx);
        const afterMarker = combined.slice(markerIdx + markerText.length);
        const newlineIdx = afterMarker.indexOf('\n');
        const exitToken = newlineIdx === -1 ? afterMarker.trim() : afterMarker.slice(0, newlineIdx).trim();
        // Exit token may carry a leading ':' already consumed; strip any non-digit trailing chars.
        const exitMatch = exitToken.match(/^(-?\d+)/);
        const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : 0;

        const stdout = before.replace(/\r?\n$/, '');
        resolve({
          command,
          shell: session.shell,
          session_id: session.id,
          exitCode: timedOut ? -1 : exitCode,
          stdout,
          stderr: stderrText,
          truncated: stdoutBytes > SESSION_MAX_OUTPUT_BYTES || stderrBytes > SESSION_MAX_OUTPUT_BYTES,
          timedOut,
        });
      }

      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);

      // If the command kills the shell itself (e.g. `exit N`), treat the shell's
      // exit code as the command's result rather than a generic failure. The
      // session is dead either way — caller will get "session not found" on reuse.
      onExit = (exitCode) => {
        if (resolved || timedOut) return;
        clearTimeout(timer);
        detach();
        resolve({
          command,
          shell: session.shell,
          session_id: session.id,
          exitCode: typeof exitCode === 'number' ? exitCode : 1,
          stdout: stdoutChunks.join('').replace(/\r?\n$/, ''),
          stderr: stderrText,
          truncated: stdoutBytes > SESSION_MAX_OUTPUT_BYTES || stderrBytes > SESSION_MAX_OUTPUT_BYTES,
          timedOut: false,
          shellExited: true,
        });
      };
      child.once('exit', onExit);
    });
  }

  async function endShellSession(args) {
    const sessionId = args?.session_id;
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      return { isError: true, content: [{ type: 'text', text: 'session_id is required.' }] };
    }
    const existed = shellSessions.has(sessionId);
    closeShellSession(sessionId, 'ended');
    return {
      content: [{ type: 'text', text: existed ? `Session ${sessionId} closed.` : `Session ${sessionId} was already gone (ignored).` }],
      structuredContent: { ok: true, data: { session_id: sessionId, closed: existed } },
    };
  }

  return {
    handlers: [
      { name: 'shell_session_begin', handle: beginShellSession },
      { name: 'shell_session_exec', handle: execInShellSession },
      { name: 'shell_session_end', handle: endShellSession },
    ],
    shutdown() {
      for (const sessionId of [...shellSessions.keys()]) {
        closeShellSession(sessionId, 'host_shutdown');
      }
    },
  };
}
