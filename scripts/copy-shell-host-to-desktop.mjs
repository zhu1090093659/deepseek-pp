// Stages packages/shell-host into desktop/native so the Electron app can spawn
// the native messaging host both in dev (npm start) and when packaged
// (electron-builder with asar:false keeps __dirname-relative paths valid).
import { cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'packages/shell-host');
const dest = resolve(root, 'desktop/native/shell-host');

try {
  await access(src);
} catch {
  console.error('[copy-shell-host-to-desktop] packages/shell-host not found.');
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await cp(src, dest, {
  recursive: true,
  filter: (s) => !s.includes(`${'node_modules'}`),
});
console.log(`[copy-shell-host-to-desktop] staged ${src} -> ${dest}`);
