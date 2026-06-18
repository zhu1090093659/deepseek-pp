// Stages the built Chrome MV3 bundle into desktop/dpp so the Electron shell
// can load background.js and inject the content scripts. Mirrors
// scripts/copy-to-android-assets.mjs.
import { cp, rm, access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'dist/chrome-mv3');
const dest = resolve(root, 'desktop/dpp');

try {
  await access(src);
} catch {
  console.error('[copy-dist-to-desktop] dist/chrome-mv3 not found. Run `npm run build:chrome` first.');
  process.exit(1);
}

await rm(dest, { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log(`[copy-dist-to-desktop] staged ${src} -> ${dest}`);

// Stage the app icon into electron-builder's default buildResources dir.
// public/logo.png is 1254x1254 — large enough for builder to generate .ico/.icns.
const iconSrc = resolve(root, 'public/logo.png');
const iconDest = resolve(root, 'desktop/build/icon.png');
try {
  await access(iconSrc);
  await mkdir(dirname(iconDest), { recursive: true });
  await cp(iconSrc, iconDest);
  console.log(`[copy-dist-to-desktop] staged icon ${iconSrc} -> ${iconDest}`);
} catch {
  console.warn('[copy-dist-to-desktop] public/logo.png not found; skipping app icon.');
}
