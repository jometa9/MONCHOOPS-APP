// Helpers shared by forked Playwright workers. Not a real entry point —
// these run inside child processes spawned via child_process.fork().

import fs from 'fs';
import path from 'path';
import type { AccountSecrets, InstagramCookie } from '../accounts';

// Find a usable chromium binary without relying on PLAYWRIGHT_BROWSERS_PATH.
// Searches the default playwright cache dirs and the @playwright/browser-chromium
// package's own .local-browsers folder. Returns `undefined` if nothing is
// found, which makes playwright fall back to its default resolution and emit
// a descriptive error that we re-wrap upstream.
function resolveChromiumExecutable(): string | undefined {
  const candidates: string[] = [];

  // @playwright/browser-chromium drops binaries alongside its package.
  try {
    const pkgJson = require.resolve('@playwright/browser-chromium/package.json');
    candidates.push(path.join(path.dirname(pkgJson), '.local-browsers'));
  } catch {}

  // Default Playwright cache locations per platform.
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'darwin' && home) {
    candidates.push(path.join(home, 'Library', 'Caches', 'ms-playwright'));
  } else if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  } else if (home) {
    candidates.push(path.join(home, '.cache', 'ms-playwright'));
  }

  for (const root of candidates) {
    const exe = findChromiumUnder(root);
    if (exe) return exe;
  }
  return undefined;
}

function findChromiumUnder(root: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  // Latest first — folder names look like "chromium-1091".
  entries.sort().reverse();
  for (const entry of entries) {
    if (!entry.startsWith('chromium')) continue;
    const base = path.join(root, entry);
    const platformPaths =
      process.platform === 'darwin'
        ? [
            path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
            path.join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          ]
        : process.platform === 'win32'
        ? [
            path.join(base, 'chrome-win', 'chrome.exe'),
            path.join(base, 'chrome-win64', 'chrome.exe'),
          ]
        : [
            path.join(base, 'chrome-linux', 'chrome'),
          ];
    for (const candidate of platformPaths) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

// Lazy require so the Electron main process can reference the type graph
// without pulling playwright-core into memory on startup.
type BrowserContext = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Browser = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LaunchOpts {
  headless: boolean;
  secrets?: AccountSecrets;
  proxy?: AccountSecrets['proxy'];
}

export async function launchBrowser(opts: LaunchOpts): Promise<{ browser: Browser; context: BrowserContext }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as typeof import('playwright-core');

  const proxy = opts.proxy ?? opts.secrets?.proxy;
  const userAgent =
    opts.secrets?.userAgent ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  const executablePath = resolveChromiumExecutable();

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: opts.headless,
      executablePath,
      proxy: proxy
        ? {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
          }
        : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|browserType\.launch/i.test(msg)) {
      throw new Error(
        'Chromium for Playwright is missing. Run `npx playwright install chromium` once from the project root.'
      );
    }
    throw err;
  }

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1280, height: 800 },
  });

  if (opts.secrets?.cookies?.length) {
    await context.addCookies(opts.secrets.cookies as InstagramCookie[]);
  }

  return { browser, context };
}

export async function waitFor(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export function jitter(ms: number, pct = 0.25): number {
  const range = ms * pct;
  return Math.round(ms - range + Math.random() * range * 2);
}

export async function safeGoto(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (err) {
    // Retry once on transient navigation errors.
    await waitFor(1500);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    void err;
  }
}

export function sendProgress(done: number, total?: number, item?: string): void {
  if (process.send) {
    process.send({ type: 'progress', done, total, item });
  }
}

export function sendLog(level: 'info' | 'warn' | 'error', msg: string): void {
  if (process.send) {
    process.send({ type: 'log', level, msg });
  }
}

export function sendResult(payload: unknown): void {
  if (process.send) {
    process.send({ type: 'result', payload });
  }
}

export function sendError(msg: string): void {
  if (process.send) {
    process.send({ type: 'error', msg });
  }
}

export function onInit<T>(cb: (init: T) => Promise<void> | void): void {
  process.on('message', async (msg: any) => {
    if (msg && msg.type === 'init') {
      try {
        await cb(msg.payload as T);
      } catch (err) {
        sendError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    } else if (msg && msg.type === 'cancel') {
      process.exit(0);
    }
  });
}
