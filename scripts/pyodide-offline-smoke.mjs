#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const policy = JSON.parse(readFileSync(resolve(root, 'scripts/pyodide-package-policy.json'), 'utf8'));
const targets = ['chrome', 'edge', 'firefox'];

for (const browser of targets) {
  const assetDir = resolve(root, `dist/${browser}-mv3/pyodide`);
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '--eval',
    createFirstUseProbe(),
    assetDir,
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error([
      `${browser} Pyodide offline smoke failed with status ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }

  const measurement = JSON.parse(result.stdout);
  if (measurement.result !== 42) {
    throw new Error(`${browser} Pyodide first run returned ${JSON.stringify(measurement.result)}`);
  }
  if (measurement.assetCount !== policy.budgets.assetCount) {
    throw new Error(`${browser} Pyodide loaded ${measurement.assetCount} assets; expected ${policy.budgets.assetCount}`);
  }

  console.log([
    `[pyodide:${browser}] offline first-use passed`,
    `assets=${measurement.assetCount}`,
    `importMs=${measurement.importMs.toFixed(1)}`,
    `loadMs=${measurement.loadMs.toFixed(1)}`,
    `firstRunMs=${measurement.firstRunMs.toFixed(1)}`,
  ].join(' '));
}

function createFirstUseProbe() {
  return String.raw`
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const assetDir = resolve(process.argv[1]);
const lazyImportDir = mkdtempSync(join(tmpdir(), 'deepseek-pp-pyodide-'));
const forbidNetwork = (operation) => {
  throw new Error('network access forbidden during Pyodide offline smoke: ' + operation);
};

globalThis.fetch = async (input) => forbidNetwork(String(input));
http.request = (...args) => forbidNetwork('http.request ' + String(args[0]));
http.get = (...args) => forbidNetwork('http.get ' + String(args[0]));
https.request = (...args) => forbidNetwork('https.request ' + String(args[0]));
https.get = (...args) => forbidNetwork('https.get ' + String(args[0]));
net.connect = (...args) => forbidNetwork('net.connect ' + String(args[0]));
net.createConnection = (...args) => forbidNetwork('net.createConnection ' + String(args[0]));

try {
  copyFileSync(join(assetDir, 'pyodide.mjs'), join(lazyImportDir, 'pyodide.mjs'));
  const startedAt = performance.now();
  const { loadPyodide } = await import(pathToFileURL(join(lazyImportDir, 'pyodide.mjs')).href);
  const importedAt = performance.now();
  const pyodide = await loadPyodide({
    indexURL: assetDir + '/',
    packageBaseUrl: assetDir + '/',
  });
  const loadedAt = performance.now();
  const result = await pyodide.runPythonAsync('sum(range(10)) - 3');
  const finishedAt = performance.now();
  console.log(JSON.stringify({
    result,
    assetCount: readdirSync(assetDir, { withFileTypes: true }).filter((entry) => entry.isFile()).length,
    entryModule: basename(join(lazyImportDir, 'pyodide.mjs')),
    importMs: importedAt - startedAt,
    loadMs: loadedAt - importedAt,
    firstRunMs: finishedAt - loadedAt,
  }));
} finally {
  rmSync(lazyImportDir, { recursive: true, force: true });
}
`;
}
