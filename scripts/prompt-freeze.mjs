#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestEntry = path.join(rootDir, 'node_modules', 'vitest', 'vitest.mjs');
const updateGoldens = process.argv.includes('--update');
const timeoutMs = 60_000;
const result = spawnSync(
  process.execPath,
  [
    vitestEntry,
    'run',
    'tests/prompt-output-contract.test.ts',
    '--expandSnapshotDiff',
  ],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      DEEPSEEK_PP_UPDATE_PROMPT_GOLDENS: updateGoldens ? '1' : '0',
    },
    stdio: 'inherit',
    timeout: timeoutMs,
  },
);

if (result.error) {
  const message = result.error.code === 'ETIMEDOUT'
    ? `Prompt freeze timed out after ${timeoutMs}ms.`
    : `Prompt freeze failed to start: ${result.error.message}`;
  console.error(message);
  process.exit(1);
}

if (result.signal) {
  console.error(`Prompt freeze terminated by ${result.signal}.`);
  process.exit(1);
}

process.exit(result.status ?? 1);
