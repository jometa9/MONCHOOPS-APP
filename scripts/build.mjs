#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const wantWin = args.includes('--win');
const wantMac = args.includes('--mac') || (!wantWin && process.platform === 'darwin');

if (wantMac) {
  if (process.platform !== 'darwin') {
    console.error('[build] macOS builds must run on a Mac (keychain-based signing).');
    process.exit(1);
  }
  assertMacSigningReady();
}

function assertMacSigningReady() {
  const appIdsResult = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8',
  });
  const allIdsResult = spawnSync('security', ['find-identity', '-v'], { encoding: 'utf8' });
  if (appIdsResult.status !== 0 || allIdsResult.status !== 0) {
    console.error('[build] ERROR: could not query keychain. Is `security` available?');
    process.exit(1);
  }
  const appIds = appIdsResult.stdout ?? '';
  const allIds = allIdsResult.stdout ?? '';

  const missing = [];
  if (!/Developer ID Application:/i.test(appIds)) {
    missing.push('Developer ID Application certificate (for signing the .app)');
  }
  if (!/Developer ID Installer:/i.test(allIds)) {
    missing.push('Developer ID Installer certificate (for signing the .pkg)');
  }

  const hasApiKey =
    !!process.env.APPLE_API_KEY &&
    !!process.env.APPLE_API_KEY_ID &&
    !!process.env.APPLE_API_ISSUER;
  const hasAppleId =
    !!process.env.APPLE_ID &&
    !!process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    !!process.env.APPLE_TEAM_ID;
  const hasKeychainProfile = !!process.env.APPLE_KEYCHAIN && !!process.env.APPLE_KEYCHAIN_PROFILE;
  if (!hasApiKey && !hasAppleId && !hasKeychainProfile) {
    missing.push(
      'Notarization credentials. Set ONE of:\n' +
        '         (a) APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER  [recommended]\n' +
        '         (b) APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID\n' +
        '         (c) APPLE_KEYCHAIN + APPLE_KEYCHAIN_PROFILE'
    );
  }

  if (missing.length > 0) {
    console.error('\n[build] ERROR: macOS signing/notarization is not configured.');
    console.error('[build] The following are missing:');
    for (const item of missing) {
      console.error('  - ' + item);
    }
    console.error(
      '\n[build] Aborting before build to avoid wasting time on a notarization failure.\n'
    );
    process.exit(1);
  }

  console.log(
    '[build] ✓ macOS signing ready: Developer ID Application + Installer certs found, notarization credentials present.'
  );
}

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

console.log('[build] clean electron/dist');
rmSync(path.join(repoRoot, 'electron', 'dist'), { recursive: true, force: true });

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
