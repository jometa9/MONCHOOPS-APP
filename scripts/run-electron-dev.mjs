#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const ELECTRON_BIN = require('electron');
const VITE_URL = 'http://127.0.0.1:7775';

function compileElectron() {
  const tscBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const result = spawnSync(tscBin, ['-p', path.join(repoRoot, 'electron', 'tsconfig.json')], {
    stdio: 'inherit',
    cwd: repoRoot,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error('[run-electron-dev] tsc failed');
    process.exit(result.status ?? 1);
  }
}

function writeElectronPkg() {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'write-electron-pkg.mjs')], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  if (result.status !== 0) {
    console.error('[run-electron-dev] write-electron-pkg failed');
    process.exit(result.status ?? 1);
  }
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForVite(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await ping(VITE_URL)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  compileElectron();
  writeElectronPkg();
  console.log('[run-electron-dev] waiting for Vite at', VITE_URL);
  const up = await waitForVite();
  if (!up) {
    console.error('[run-electron-dev] Vite did not come up in time. Is `npm run dev` running?');
    process.exit(1);
  }
  const child = spawn(ELECTRON_BIN, [path.join(repoRoot, 'electron', 'dist', 'main.js')], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: (({ ELECTRON_RUN_AS_NODE, ...rest }) => ({ ...rest, ELECTRON_ENABLE_LOGGING: '1' }))(process.env),
  });
  child.on('close', (code) => process.exit(code ?? 0));
})();
