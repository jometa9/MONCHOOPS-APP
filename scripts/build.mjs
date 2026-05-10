#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const wantWin = args.includes('--win');
const wantMac = args.includes('--mac') || (!wantWin && process.platform === 'darwin');

function run(bin, argv, opts = {}) {
  const result = spawnSync(bin, argv, { stdio: 'inherit', cwd: repoRoot, ...opts });
  if (result.status !== 0) {
    console.error('[build] step failed:', bin, argv.join(' '));
    process.exit(result.status ?? 1);
  }
}

const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log('[build] vite build');
run(npxBin, ['vite', 'build', '--mode', 'production']);

console.log('[build] tsc -p electron/tsconfig.json');
run(npxBin, ['tsc', '-p', path.join('electron', 'tsconfig.json')]);

console.log('[build] obfuscate electron/dist');
run(process.execPath, [path.join('scripts', 'obfuscate-electron.mjs')]);

console.log('[build] writing electron/dist/package.json');
run(process.execPath, [path.join('scripts', 'write-electron-pkg.mjs')]);

const bundleArgs = [path.join('scripts', 'bundle-chromium.mjs')];
if (wantMac) bundleArgs.push('--mac');
if (wantWin) bundleArgs.push('--win');
console.log('[build] bundle-chromium', bundleArgs.slice(1).join(' '));
run(process.execPath, bundleArgs);

const builderArgs = ['electron-builder'];
if (wantMac) builderArgs.push('--mac');
if (wantWin) builderArgs.push('--win');
builderArgs.push('--publish', 'never');

console.log('[build]', builderArgs.join(' '));
run(npxBin, builderArgs);

console.log('[build] done. Output in ./release/');
