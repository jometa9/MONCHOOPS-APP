// Helpers shared by forked Playwright workers. Not a real entry point —
// these run inside child processes spawned via child_process.fork().

import fs from 'fs';
import path from 'path';
import type { AccountSecrets, InstagramCookie } from '../accounts';

// Find a usable chromium binary. In packaged builds we bundle Chrome for
// Testing under <Resources>/chromium/ via electron-builder.extraResources, and
// the main process exposes that location via the B2DM_CHROMIUM_DIR env var.
// In dev we fall through to playwright-core's own cache resolution by
// returning undefined.
function resolveChromiumExecutable(): string | undefined {
  const bundled = process.env.B2DM_CHROMIUM_DIR;
  if (bundled) {
    const exe = findChromiumIn(bundled);
    if (exe) return exe;
  }
  return undefined;
}

// Looks for a chrome binary directly under `root` (the layout extraResources
// produces) or one level deeper inside a chromium-<rev>/ folder (the layout
// playwright's own cache uses).
function findChromiumIn(root: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  const direct = chromiumBinaryPaths(root);
  for (const candidate of direct) {
    if (fs.existsSync(candidate)) return candidate;
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return undefined;
  }
  entries.sort().reverse();
  for (const entry of entries) {
    if (!entry.startsWith('chromium')) continue;
    const nested = chromiumBinaryPaths(path.join(root, entry));
    for (const candidate of nested) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

// Possible locations of the launchable chromium binary inside an extracted
// Chrome-for-Testing tree. The folder name comes from the zip name and the
// .app name has shifted across Chrome versions (Chromium.app vs. Google Chrome
// for Testing.app), so we list every variant we have seen.
function chromiumBinaryPaths(base: string): string[] {
  if (process.platform === 'darwin') {
    return [
      path.join(base, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(base, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
      path.join(base, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      path.join(base, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ];
  }
  if (process.platform === 'win32') {
    return [
      path.join(base, 'chrome-win64', 'chrome.exe'),
      path.join(base, 'chrome-win', 'chrome.exe'),
    ];
  }
  return [
    path.join(base, 'chrome-linux64', 'chrome'),
    path.join(base, 'chrome-linux', 'chrome'),
  ];
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
        process.env.B2DM_CHROMIUM_DIR
          ? `Bundled Chromium not found under ${process.env.B2DM_CHROMIUM_DIR}. The build is incomplete.`
          : 'Chromium for Playwright is missing. Run `npx playwright install chromium` once from the project root.'
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

// Emitted by login workers when an auto-login attempt fails. Main upserts a
// shell account row with status='error' so the user can see the attempt in
// the Accounts list and decide to retry or delete it.
export function sendLoginFailed(payload: {
  username: string;
  password: string;
  error: string;
}): void {
  if (process.send) {
    process.send({ type: 'login-failed', payload });
  }
}

// Cooperative cancellation: the main process sends `{type:'cancel'}` over IPC
// when the user hits Cancel in the UI. Workers check `isCancelled()` at their
// natural yield points and return early so they can flush partial state (CSVs,
// result payloads) before exiting with code 0. Main escalates to SIGTERM /
// SIGKILL if the worker doesn't exit within its grace window.
let cancelled = false;
const cancelCallbacks = new Set<() => void | Promise<void>>();

export function isCancelled(): boolean {
  return cancelled;
}

export function onCancel(cb: () => void | Promise<void>): void {
  cancelCallbacks.add(cb);
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
      cancelled = true;
      for (const cb of cancelCallbacks) {
        try { await cb(); } catch {}
      }
    }
  });
}
