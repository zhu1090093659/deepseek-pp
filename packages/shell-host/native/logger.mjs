import { appendFileSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname } from 'node:path';

const LOG_PREFIX = '[shell-mcp-host]';

export function createHostLogger(logFile = process.env.DPP_LOG_FILE || '') {
  let logWriteFailureReported = false;

  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
      appendFileSync(
        logFile,
        `${new Date().toISOString()} ${LOG_PREFIX} started pid=${process.pid} platform=${platform()} node=${process.version}\n`,
        { encoding: 'utf8' },
      );
    } catch (error) {
      process.stderr.write(`${LOG_PREFIX} failed to initialize log file ${logFile}: ${errorMessage(error)}\n`);
      logWriteFailureReported = true;
    }
  }

  return {
    hasFile: Boolean(logFile),
    logLine(message) {
      const line = typeof message === 'string' ? message : String(message);
      process.stderr.write(`${LOG_PREFIX} ${line}\n`);
      if (!logFile) return;
      try {
        appendFileSync(logFile, `${new Date().toISOString()} ${LOG_PREFIX} ${line}\n`, { encoding: 'utf8' });
      } catch (error) {
        if (logWriteFailureReported) return;
        process.stderr.write(`${LOG_PREFIX} failed to write log file ${logFile}: ${errorMessage(error)}\n`);
        logWriteFailureReported = true;
      }
    },
  };
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
