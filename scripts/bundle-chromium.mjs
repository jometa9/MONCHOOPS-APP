#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stagingRoot = path.join(repoRoot, 'build-resources');
const cacheRoot = path.join(stagingRoot, '.cache');

const TARGETS = {
  'mac-arm64': {
    folder: 'chrome-mac-arm64',
    zipName: 'chrome-mac-arm64.zip',
    cdnPath: 'mac-arm64/chrome-mac-arm64.zip',
  },
  'win64': {
    folder: 'chrome-win64',
    zipName: 'chrome-win64.zip',
    cdnPath: 'win64/chrome-win64.zip',
  },
};

function parseTargets(argv) {
  const wantMac = argv.includes('--mac');
  const wantWin = argv.includes('--win');
  if (!wantMac && !wantWin) {
    if (process.platform === 'darwin') return ['mac-arm64'];
    if (process.platform === 'win32') return ['win64'];
    throw new Error(`Unsupported host platform without explicit --mac/--win flag: ${process.platform}`);
  }
  const targets = [];
  if (wantMac) targets.push('mac-arm64');
  if (wantWin) targets.push('win64');
  return targets;
}

async function readBrowsersJson() {
  const file = path.join(repoRoot, 'node_modules', 'playwright-core', 'browsers.json');
  const raw = await readFile(file, 'utf8');
  const parsed = JSON.parse(raw);
  const chromium = parsed.browsers.find((b) => b.name === 'chromium');
  if (!chromium) throw new Error('chromium descriptor missing in playwright-core/browsers.json');
  return { revision: chromium.revision, browserVersion: chromium.browserVersion };
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

function downloadFollowingRedirects(url, dest, attempt = 0) {
  return new Promise((resolve, reject) => {
    if (attempt > 5) return reject(new Error(`too many redirects fetching ${url}`));
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        downloadFollowingRedirects(next, dest, attempt + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      let lastLogged = 0;
      const sink = createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct >= lastLogged + 10) {
            lastLogged = pct;
            process.stdout.write(`  …${pct}%\n`);
          }
        }
      });
      res.pipe(sink);
      sink.on('finish', () => sink.close((err) => (err ? reject(err) : resolve())));
      sink.on('error', reject);
    }).on('error', reject);
  });
}

function unzip(zipPath, destDir) {

  const tryRun = (bin, args) => {
    const result = spawnSync(bin, args, { stdio: 'inherit' });
    return result.status === 0;
  };
  const useUnzip = process.platform !== 'win32';
  if (useUnzip && tryRun('unzip', ['-q', '-o', zipPath, '-d', destDir])) return;
  if (!tryRun('tar', ['-xf', zipPath, '-C', destDir])) {
    throw new Error(`failed to extract ${zipPath} into ${destDir}`);
  }
}

async function ensureExecutable(target, destDir) {

  if (target !== 'mac-arm64') return;
  const bin = path.join(
    destDir,
    'chrome-mac-arm64',
    'Google Chrome for Testing.app',
    'Contents',
    'MacOS',
    'Google Chrome for Testing'
  );
  if (await exists(bin)) {
    await chmod(bin, 0o755);
  }
}

async function stageTarget(target, browserVersion) {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`unknown target ${target}`);

  const targetRoot = path.join(stagingRoot, target);
  const sentinel = path.join(targetRoot, '.installed-version');

  if (await exists(sentinel)) {
    const installed = (await readFile(sentinel, 'utf8')).trim();
    if (installed === browserVersion) {
      console.log(`[bundle-chromium] ${target} already at ${browserVersion}, skipping.`);
      return targetRoot;
    }
    console.log(`[bundle-chromium] ${target} stale (${installed} → ${browserVersion}), rebuilding.`);
    await rm(targetRoot, { recursive: true, force: true });
  }

  await mkdir(targetRoot, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });

  const cachedZip = path.join(cacheRoot, `${browserVersion}-${spec.zipName}`);
  if (!(await exists(cachedZip))) {
    const url = `https://cdn.playwright.dev/builds/cft/${browserVersion}/${spec.cdnPath}`;
    console.log(`[bundle-chromium] downloading ${url}`);
    const tmp = `${cachedZip}.partial`;
    await rm(tmp, { force: true });
    await downloadFollowingRedirects(url, tmp);
    await rm(cachedZip, { force: true });
    const { rename } = await import('node:fs/promises');
    await rename(tmp, cachedZip);
  } else {
    console.log(`[bundle-chromium] using cached ${path.basename(cachedZip)}`);
  }

  console.log(`[bundle-chromium] extracting into ${path.relative(repoRoot, targetRoot)}/`);
  unzip(cachedZip, targetRoot);
  await ensureExecutable(target, targetRoot);

  const { writeFile } = await import('node:fs/promises');
  await writeFile(sentinel, browserVersion, 'utf8');

  return targetRoot;
}

async function main() {
  const targets = parseTargets(process.argv.slice(2));
  const { browserVersion, revision } = await readBrowsersJson();
  console.log(`[bundle-chromium] chromium ${browserVersion} (rev ${revision}) for targets: ${targets.join(', ')}`);
  for (const target of targets) {
    await stageTarget(target, browserVersion);
  }
  console.log('[bundle-chromium] done.');
}

main().catch((err) => {
  console.error('[bundle-chromium] failed:', err);
  process.exit(1);
});
