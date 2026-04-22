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
  // When set (and headless=false), position + size the Chromium window so
  // the main process can tile concurrent automations into a grid. The
  // bounds come from windowSlots in main and are forwarded here via the
  // worker's init payload.
  windowBounds?: WindowBounds;
  // When true (and headless=false), open the Chromium window maximized
  // instead of tiling it. Mutually exclusive with windowBounds — set by
  // the user's "Full window" preference.
  maximizeWindow?: boolean;
}

// IG's mobile breakpoint is ~768px. We use 1024 as the cutoff with margin so
// browser chrome / scrollbars don't shave us under the breakpoint.
const DESKTOP_LAYOUT_MIN_WIDTH = 1024;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function pickViewport(opts: LaunchOpts): { width: number; height: number } | null {
  if (opts.headless) return DEFAULT_VIEWPORT;
  // Maximized headed window is always larger than the desktop breakpoint —
  // let the page fill it naturally.
  if (opts.maximizeWindow) return null;
  if (!opts.windowBounds) return DEFAULT_VIEWPORT;
  if (opts.windowBounds.width >= DESKTOP_LAYOUT_MIN_WIDTH) return null;
  return DEFAULT_VIEWPORT;
}

export async function launchBrowser(opts: LaunchOpts): Promise<{ browser: Browser; context: BrowserContext }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { chromium } = require('playwright-core') as typeof import('playwright-core');

  const proxy = opts.proxy ?? opts.secrets?.proxy;
  const userAgent =
    opts.secrets?.userAgent ??
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  const executablePath = resolveChromiumExecutable();

  // --disable-blink-features=AutomationControlled strips the "controlled by
  // automated test software" banner AND flips navigator.webdriver to false
  // at the Chromium layer — the single most important anti-detection flag.
  // The rest are anti-fingerprint hardening (stable across Chrome releases).
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
      // Hide the default "Chrome is being controlled by automated test
      // software" infobar & related switches that IG's detection scripts
      // sniff for.
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
        process.env.B2DM_CHROMIUM_DIR
          ? `Bundled Chromium not found under ${process.env.B2DM_CHROMIUM_DIR}. The build is incomplete.`
          : 'Chromium for Playwright is missing. Run `npx playwright install chromium` once from the project root.'
      );
    }
    throw err;
  }

  const context = await browser.newContext({
    userAgent,
    // Viewport policy when we tile the window:
    //   - Big tile (≥1024px wide): viewport:null lets the page fill the
    //     window naturally, since IG's desktop layout still applies.
    //   - Small tile: pin viewport to 1280x800 so IG doesn't collapse into
    //     mobile layout (which would break our desktop selectors). The
    //     page renders at 1280x800 but is clipped inside the smaller OS
    //     window — fine for monitoring, scraper sees the same DOM as
    //     when running un-tiled.
    viewport: pickViewport(opts),
    // Locale + timezone must be set so navigator.languages and Date.toString
    // agree with the UA's implied country — mismatch is a hard signal.
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Modern Chrome sends these client hints; their absence (or mismatch
    // with the UA string) is fingerprinted by IG's Edge workers.
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

  return { browser, context };
}

// Anti-fingerprint patches injected into every page via addInitScript. These
// run before any page script, including IG's inline detection bundle. Covers
// the 7 fingerprint vectors IG actually checks in 2026:
//   1. navigator.webdriver          (undefined, not false)
//   2. navigator.plugins / mimeTypes (non-empty, shaped like real Chrome)
//   3. window.chrome.{runtime,loadTimes,csi}
//   4. navigator.permissions.query  (notifications returns real state)
//   5. WebGLRenderingContext.getParameter vendor/renderer
//   6. navigator.languages
//   7. iframe.contentWindow navigator isolation
async function applyStealthPatches(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // 1. navigator.webdriver — delete instead of `= false`, which is itself
    //    a tell (real browsers have the property absent).
    try {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
    } catch {}

    // 2. plugins / mimeTypes — IG checks `navigator.plugins.length > 0`.
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

    // 3. window.chrome — real Chrome has this populated; Playwright's
    //    Chromium leaves it mostly empty.
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

    // 4. permissions.query — IG probes 'notifications'; should return the
    //    actual Notification.permission state, not the stock "denied".
    try {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters: PermissionDescriptor) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission } as PermissionStatus);
        }
        return origQuery(parameters);
      };
    } catch {}

    // 5. WebGL vendor/renderer — 37445=UNMASKED_VENDOR_WEBGL,
    //    37446=UNMASKED_RENDERER_WEBGL. Playwright's headless reports
    //    "Google Inc." / "SwiftShader" which is a dead giveaway.
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

    // 6. navigator.languages — must agree with UA language.
    try {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
    } catch {}

    // 7. iframe isolation — IG opens hidden iframes and re-checks
    //    navigator.webdriver inside them. Patches leak into child contexts
    //    if we override createElement.
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

// Emitted by the mass DM worker after every send attempt. Main inserts a
// row into mass_dm_sends so the UI can show per-username history and the
// Cold DM flow can warn when a username was already DM'd by this account.
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
