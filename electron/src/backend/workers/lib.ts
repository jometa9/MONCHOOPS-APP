

import fs from 'fs';
import path from 'path';
import type { AccountSecrets, InstagramCookie } from '../accounts';

function resolveChromiumExecutable(): string | undefined {
  const bundled = process.env.MonchoOps_CHROMIUM_DIR;
  if (bundled) {
    const exe = findChromiumIn(bundled);
    if (exe) return exe;
  }
  return undefined;
}

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

type BrowserContext = any;
type Browser = any;
type Page = any;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaunchOpts {
  headless: boolean;
  secrets?: AccountSecrets;
  proxy?: AccountSecrets['proxy'];

  windowBounds?: WindowBounds;

  maximizeWindow?: boolean;
}

const DESKTOP_LAYOUT_MIN_WIDTH = 1024;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function pickViewport(opts: LaunchOpts): { width: number; height: number } | null {
  if (opts.headless) return DEFAULT_VIEWPORT;

  if (opts.maximizeWindow) return null;
  if (!opts.windowBounds) return DEFAULT_VIEWPORT;
  if (opts.windowBounds.width >= DESKTOP_LAYOUT_MIN_WIDTH) return null;
  return DEFAULT_VIEWPORT;
}

export async function launchBrowser(opts: LaunchOpts): Promise<{ browser: Browser; context: BrowserContext }> {

  const { chromium } = require('playwright-core') as typeof import('playwright-core');

  const proxy = opts.proxy ?? opts.secrets?.proxy;
  const userAgent =
    opts.secrets?.userAgent ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const executablePath = resolveChromiumExecutable();

  const launchArgs: string[] = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (!opts.headless) {
    if (opts.maximizeWindow) {
      launchArgs.push('--start-maximized');
    } else if (opts.windowBounds) {
      const { x, y, width, height } = opts.windowBounds;
      launchArgs.push(`--window-position=${x},${y}`);
      launchArgs.push(`--window-size=${width},${height}`);
    }
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: opts.headless,
      executablePath,
      args: launchArgs,

      ignoreDefaultArgs: ['--enable-automation'],
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
        process.env.MonchoOps_CHROMIUM_DIR
          ? `Bundled Chromium not found under ${process.env.MonchoOps_CHROMIUM_DIR}. The build is incomplete.`
          : 'Chromium for Playwright is missing. Run `npx playwright install chromium` once from the project root.'
      );
    }
    throw err;
  }

  const context = await browser.newContext({
    userAgent,

    viewport: pickViewport(opts),

    locale: 'en-US',
    timezoneId: 'America/New_York',

    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': process.platform === 'darwin' ? '"macOS"' : process.platform === 'win32' ? '"Windows"' : '"Linux"',
    },
  });

  await applyStealthPatches(context);

  if (opts.secrets?.cookies?.length) {
    await context.addCookies(opts.secrets.cookies as InstagramCookie[]);
  }

  registerBrowserForCleanup(browser);

  return { browser, context };
}

const activeBrowsers = new Set<Browser>();
let cleanupHooksInstalled = false;

function registerBrowserForCleanup(browser: Browser): void {
  installCleanupHooks();
  activeBrowsers.add(browser);
  try {
    browser.on('disconnected', () => activeBrowsers.delete(browser));
  } catch {}
}

function installCleanupHooks(): void {
  if (cleanupHooksInstalled) return;
  cleanupHooksInstalled = true;

  const closeAll = async (): Promise<void> => {
    const browsers = Array.from(activeBrowsers);
    activeBrowsers.clear();
    await Promise.all(
      browsers.map(async (b) => {
        try { await b.close(); } catch {}
      })
    );
  };

  process.on('disconnect', () => {
    void closeAll().finally(() => process.exit(0));
  });

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.on(signal, () => {
      void closeAll().finally(() => process.exit(0));
    });
  }

  process.on('exit', () => {
    for (const browser of activeBrowsers) {
      try {
        const child = typeof browser.process === 'function' ? browser.process() : null;
        if (child && child.pid && !child.killed) {
          try { child.kill('SIGKILL'); } catch {}
        }
      } catch {}
    }
  });
}

async function applyStealthPatches(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {

    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    } catch {}

    try {
      const fakePlugins = [
        { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'Microsoft Edge PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
        { name: 'WebKit built-in PDF', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
      ];
      Object.defineProperty(navigator, 'plugins', {
        get: () => Object.assign([...fakePlugins], {
          item: (i: number) => fakePlugins[i],
          namedItem: (n: string) => fakePlugins.find((p) => p.name === n) ?? null,
          refresh: () => {},
        }),
        configurable: true,
      });
    } catch {}

    try {
      const w = window as unknown as { chrome?: Record<string, unknown> };
      if (!w.chrome || Object.keys(w.chrome).length < 2) {
        w.chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
          runtime: {
            OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
            PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
          },
          loadTimes: () => ({ requestTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: 'unknown', wasAlternateProtocolAvailable: false, connectionInfo: 'http/1.1' }),
          csi: () => ({ startE: Date.now() - 100, onloadT: Date.now(), pageT: 3000 + Math.random() * 1000, tran: 15 }),
        };
      }
    } catch {}

    try {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission } as PermissionStatus);
        }
        return origQuery(parameters);
      };
    } catch {}

    try {
      const patchGL = (proto: any) => {
        const orig = proto.getParameter;
        proto.getParameter = function (p: number) {
          if (p === 37445) return 'Intel Inc.';
          if (p === 37446) return 'Intel Iris OpenGL Engine';
          return orig.call(this, p);
        };
      };
      if (typeof WebGLRenderingContext !== 'undefined') patchGL(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') patchGL(WebGL2RenderingContext.prototype);
    } catch {}

    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
    } catch {}

    try {
      const origCreate = document.createElement.bind(document);
      document.createElement = function (tag: string, ...rest: unknown[]) {
        const el = origCreate(tag, ...(rest as [])) as HTMLElement;
        if (tag.toLowerCase() === 'iframe') {
          try {
            const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
            Object.defineProperty(el, 'contentWindow', {
              get() {
                const win = desc?.get?.call(this) as Window | null;
                if (win) {
                  try {
                    Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined, configurable: true });
                  } catch {}
                }
                return win;
              },
              configurable: true,
            });
          } catch {}
        }
        return el;
      } as typeof document.createElement;
    } catch {}
  });
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

export function sendErrorAndWait(msg: string): Promise<void> {
  return new Promise((resolve) => {
    if (!process.send) { resolve(); return; }
    try {
      process.send({ type: 'error', msg }, undefined, undefined, () => resolve());
    } catch {
      resolve();
    }
  });
}

export function sendLoginFailed(payload: {
  username: string;
  password: string;
  error: string;
}): void {
  if (process.send) {
    process.send({ type: 'login-failed', payload });
  }
}

export function sendDmSend(payload: {
  username: string;
  status: 'sent' | 'failed';
  message?: string | null;
  error?: string | null;
}): void {
  if (process.send) {
    process.send({ type: 'dm-send', payload });
  }
}

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
        const errMsg = err instanceof Error
          ? `${err.message}${err.stack ? `\n${err.stack}` : ''}`
          : String(err);
        await sendErrorAndWait(errMsg);
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
