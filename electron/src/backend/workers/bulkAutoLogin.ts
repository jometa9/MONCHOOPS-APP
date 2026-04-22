// Forked worker: signs into many Instagram accounts sequentially. For each
// row it spins up a fresh Chromium with the row's optional proxy, fills the
// login form, harvests cookies + profile, and emits a `bulk-account` message
// so the main process can persist the account immediately. The worker keeps
// going past per-row failures (it just logs them and moves on).

import { isCancelled, launchBrowser, onInit, sendError, sendLog, sendLoginFailed, sendProgress, sendResult, waitFor, type WindowBounds } from './lib';
import { attachDialogDismisser } from './ig';
import type { InstagramCookie } from '../accounts';

interface BulkRowInit {
  username: string;
  password: string;
  proxyUrl?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

interface BulkInit {
  jobId: string;
  rows: BulkRowInit[];
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

// Post-submit window is generous on purpose: if Instagram throws a captcha or
// checkpoint, the login flow is headed and the user can solve it manually
// before the sessionid cookie lands. 3 min covers reCAPTCHA + 2FA SMS wait.
// PER_ROW_DEADLINE_MS must stay above POST_SUBMIT plus navigation and
// identity extraction (~90s worst case).
const POST_SUBMIT_DEADLINE_MS = 180_000;
const PER_ROW_DEADLINE_MS = 300_000;

interface RowResult {
  username: string;
  success: boolean;
  error?: string;
}

onInit<BulkInit>(async (init) => {
  const total = init.rows.length;
  if (total === 0) {
    sendError('No rows to import');
    process.exit(1);
    return;
  }

  sendProgress(0, total);

  const results: RowResult[] = [];

  for (let i = 0; i < init.rows.length; i++) {
    if (isCancelled()) break;
    const row = init.rows[i]!;
    const label = row.username || `row ${i + 1}`;
    sendLog('info', `[${i + 1}/${total}] Logging in ${label}…`);

    try {
      await processRow(row, init.headless, init.windowBounds, init.maximizeWindow);
      results.push({ username: row.username, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog('error', `[${i + 1}/${total}] ${label}: ${msg}`);
      // Persist the failed attempt as an error-status account so the user
      // can retry it from the Accounts screen without re-importing the CSV.
      if (row.username) {
        sendLoginFailed({ username: row.username, password: row.password, error: msg });
      }
      results.push({ username: row.username, success: false, error: msg });
    }

    sendProgress(i + 1, total, label);
  }

  const ok = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  sendResult({
    type: 'bulk-summary',
    total,
    succeeded: ok,
    failed: failed.length,
    failures: failed.map((r) => ({ username: r.username, error: r.error })),
  });

  process.exit(0);
});

async function processRow(row: BulkRowInit, headless: boolean, windowBounds?: WindowBounds, maximizeWindow?: boolean): Promise<void> {
  const proxy = row.proxyUrl
    ? {
        server: row.proxyUrl,
        username: row.proxyUsername || undefined,
        password: row.proxyPassword || undefined,
      }
    : undefined;

  const { browser, context } = await launchBrowser({ headless, proxy, windowBounds, maximizeWindow });
  const page = await context.newPage();
  const detachDismisser = attachDialogDismisser(page);

  try {
    await Promise.race([
      runLogin(page, context, row),
      delayThenThrow(PER_ROW_DEADLINE_MS, `Timed out after ${Math.round(PER_ROW_DEADLINE_MS / 1000)}s`),
    ]);
  } finally {
    detachDismisser();
    try { await browser.close(); } catch {}
  }
}

async function runLogin(page: any, context: any, row: BulkRowInit): Promise<void> {
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

  await dismissCookieBanner(page);

  const USERNAME_SEL =
    'input[autocomplete*="username"], input[name="email"], input[name="username"]';
  const PASSWORD_SEL = 'input[type="password"]';

  try {
    await fillLoginField(page, USERNAME_SEL, row.username);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not enter username (${msg}, at ${page.url()})`);
  }

  try {
    await fillLoginField(page, PASSWORD_SEL, row.password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not enter password (${msg})`);
  }

  const submitted = await submitLoginForm(page);
  if (!submitted) {
    await page.keyboard.press('Enter').catch(() => {});
  }

  // Poll until sessionid lands or we hit a known error / timeout.
  const start = Date.now();
  while (Date.now() - start < POST_SUBMIT_DEADLINE_MS) {
    if (page.isClosed()) throw new Error('Login page closed unexpectedly');

    const cookies = (await context.cookies()) as InstagramCookie[];
    if (cookies.some((c) => c.name === 'sessionid' && c.domain.includes('instagram.com'))) {
      break;
    }

    const errorText = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('span'))
          .map((s) => s.textContent ?? '')
          .join(' ')
          .toLowerCase()
      )
      .catch(() => '');

    if (
      errorText.includes("password you entered is incorrect") ||
      errorText.includes('username you entered') ||
      errorText.includes("couldn't find an account") ||
      errorText.includes('please wait a few minutes')
    ) {
      throw new Error('Invalid username or password');
    }
    if (errorText.includes('two-factor') || errorText.includes('security code') || errorText.includes('confirm it')) {
      throw new Error('Account requires 2FA / checkpoint — use manual login');
    }

    await waitFor(2000);
  }

  // Re-check sessionid after the loop (the loop may have exited on timeout).
  const finalCookies = (await context.cookies()) as InstagramCookie[];
  const hasSession = finalCookies.some(
    (c) => c.name === 'sessionid' && c.domain.includes('instagram.com')
  );
  if (!hasSession) throw new Error('Timed out waiting for login to complete');

  // Extract the canonical username using the same robust pipeline as the
  // manual login worker: home → avatar-link in the nav first, /accounts/edit/
  // as fallback.
  const identity = await extractIdentity(page);
  const canonicalUsername = identity?.username || row.username;

  let displayName: string | null = identity?.displayName ?? null;
  let profilePicUrl: string | null = isPersistableUrl(identity?.profilePicUrl ?? null)
    ? (identity!.profilePicUrl as string)
    : null;

  if (!displayName || !profilePicUrl) {
    try {
      await page.goto(`https://www.instagram.com/${encodeURIComponent(canonicalUsername)}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await waitFor(2000);
      const info = await page.evaluate(() => {
        const h2 = document.querySelector('header section h2, header section h1');
        const avatar = document.querySelector<HTMLImageElement>(
          'header img[alt*="profile picture" i], header img'
        );
        return {
          name: h2 ? (h2.textContent || '').trim() : null,
          pic: avatar?.getAttribute('src') ?? null,
        };
      });
      displayName = displayName ?? (info.name || null);
      if (!profilePicUrl && isPersistableUrl(info.pic)) profilePicUrl = info.pic;
    } catch {}
  }

  // IG CDN URLs expire (HMAC'd via oh/oe) — snapshot the bytes now and store
  // them inline as a data URL so the avatar survives past the token TTL.
  if (profilePicUrl) {
    const dataUrl = await downloadAsDataUrl(context, profilePicUrl);
    if (dataUrl) profilePicUrl = dataUrl;
  }

  const userAgent =
    (await page.evaluate(() => navigator.userAgent).catch(() => '')) ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  // Hand the account to main right away — main creates the row and applies
  // the proxy. We don't wait for an ack; main treats this fire-and-forget.
  if (process.send) {
    process.send({
      type: 'bulk-account',
      payload: {
        username: canonicalUsername,
        password: row.password,
        displayName,
        profilePicUrl,
        cookies: finalCookies,
        userAgent,
        proxy: row.proxyUrl
          ? {
              url: row.proxyUrl,
              username: row.proxyUsername ?? null,
              password: row.proxyPassword ?? null,
            }
          : null,
      },
    });
  }
}

function delayThenThrow(ms: number, msg: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(msg)), ms);
  });
}

async function fillLoginField(page: any, selector: string, value: string): Promise<void> {
  // Locator re-resolves on every action, so we survive the React re-renders
  // that drop cached ElementHandle keystrokes. Verify the DOM value after
  // each attempt and retry with a different technique if it didn't stick.
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 20_000 });

  let lastValue = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await loc.click(); } catch {}
    try {
      await loc.press('ControlOrMeta+A');
      await loc.press('Delete');
    } catch {}
    try { await loc.fill(value); } catch {}

    lastValue = await loc.inputValue().catch(() => '');
    if (lastValue === value) return;

    try { await loc.click(); } catch {}
    try {
      await loc.press('ControlOrMeta+A');
      await loc.press('Delete');
    } catch {}
    try { await loc.pressSequentially(value, { delay: 35 }); } catch {}

    lastValue = await loc.inputValue().catch(() => '');
    if (lastValue === value) return;

    await waitFor(400);
  }

  throw new Error(`value did not persist (got "${lastValue}", expected "${value}")`);
}

async function submitLoginForm(page: any): Promise<boolean> {
  const btn = await page.$(
    'div[role="button"][aria-label="Log In"], div[role="button"][aria-label="Log in"], button[type="submit"], button:has-text("Log in")'
  );
  if (btn) {
    const disabled = await btn.getAttribute('aria-disabled').catch(() => null);
    if (disabled !== 'true') {
      try {
        await btn.click();
        return true;
      } catch {}
    }
  }
  const viaForm = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>('form#login_form, form[method="POST"]');
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      form.submit();
    }
    return true;
  }).catch(() => false);
  return !!viaForm;
}

async function dismissCookieBanner(page: any): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const variants = [
        'allow all cookies',
        'allow all',
        'accept all',
        'accept',
        'permitir todas las cookies',
        'permitir todas',
        'aceptar todo',
        'aceptar',
        'only allow essential cookies',
        'permitir solo las cookies esenciales',
      ];
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (variants.some((v) => text === v || text.includes(v))) {
          (btn as HTMLButtonElement).click();
          return true;
        }
      }
      return false;
    });
    if (clicked) await waitFor(800);
  } catch {
    // Non-fatal.
  }
}

const IDENTITY_DEADLINE_MS = 25_000;
const RESERVED = [
  'p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories', 'tv',
  'challenge', 'about', 'legal', 'press', 'terms', 'privacy',
];

interface Identity {
  username: string;
  displayName: string | null;
  profilePicUrl: string | null;
}

async function extractIdentity(page: any): Promise<Identity | null> {
  const fromHome = await readIdentityFromHome(page);
  if (fromHome) return fromHome;
  const fromEdit = await readUsernameFromEdit(page);
  if (fromEdit) return { username: fromEdit, displayName: null, profilePicUrl: null };
  return null;
}

async function readIdentityFromHome(page: any): Promise<Identity | null> {
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    return null;
  }

  const deadline = Date.now() + IDENTITY_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    const found = await page
      .evaluate((reserved: string[]) => {
        const scopes: ParentNode[] = [
          ...Array.from(document.querySelectorAll('nav, [role="navigation"]')),
          document,
        ];
        for (const scope of scopes) {
          const anchors = Array.from(
            scope.querySelectorAll<HTMLAnchorElement>('a[role="link"][href^="/"], a[href^="/"]')
          );
          for (const a of anchors) {
            const path = a.pathname || '';
            const m = path.match(/^\/([A-Za-z0-9._]+)\/?$/);
            if (!m) continue;
            const username = m[1];
            if (!username || reserved.includes(username)) continue;
            const img = a.querySelector('img');
            if (!img) continue;
            return {
              username,
              pic: (img as HTMLImageElement).src || null,
            };
          }
        }
        return null;
      }, RESERVED)
      .catch(() => null);

    if (found && found.username) {
      return { username: found.username, displayName: null, profilePicUrl: found.pic };
    }
    await waitFor(1000);
  }
  return null;
}

async function readUsernameFromEdit(page: any): Promise<string | null> {
  try {
    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {
    return null;
  }

  const deadline = Date.now() + IDENTITY_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (page.isClosed()) return null;
    try {
      await page.waitForSelector('input[name="username"]', { state: 'visible', timeout: 3000 });
    } catch {
      // Selector not yet there; keep polling.
    }
    const found = await page
      .evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('input[name="username"]');
        if (input && input.value) return input.value;
        const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
        for (const inp of allInputs) {
          if ((inp.name === 'username' || inp.placeholder?.toLowerCase().includes('username')) && inp.value) {
            return inp.value;
          }
        }
        return null;
      })
      .catch(() => null);
    if (typeof found === 'string' && found.length > 0) return found;
    await waitFor(1000);
  }
  return null;
}

function isPersistableUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

async function downloadAsDataUrl(context: any, url: string): Promise<string | null> {
  try {
    const res = await context.request.get(url, { timeout: 15_000 });
    if (!res.ok()) return null;
    const body = await res.body();
    if (!body || body.length === 0) return null;
    const rawType = (res.headers()['content-type'] || 'image/jpeg').split(';')[0]!.trim();
    const mime = rawType || 'image/jpeg';
    return `data:${mime};base64,${body.toString('base64')}`;
  } catch {
    return null;
  }
}
