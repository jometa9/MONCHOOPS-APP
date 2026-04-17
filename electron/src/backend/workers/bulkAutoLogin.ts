// Forked worker: signs into many Instagram accounts sequentially. For each
// row it spins up a fresh Chromium with the row's optional proxy, fills the
// login form, harvests cookies + profile, and emits a `bulk-account` message
// so the main process can persist the account immediately. The worker keeps
// going past per-row failures (it just logs them and moves on).

import { launchBrowser, onInit, sendError, sendLog, sendProgress, sendResult, waitFor } from './lib';
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
}

const PER_ROW_DEADLINE_MS = 90_000;

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
    const row = init.rows[i]!;
    const label = row.username || `row ${i + 1}`;
    sendLog('info', `[${i + 1}/${total}] Logging in ${label}…`);

    try {
      await processRow(row);
      results.push({ username: row.username, success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendLog('error', `[${i + 1}/${total}] ${label}: ${msg}`);
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

async function processRow(row: BulkRowInit): Promise<void> {
  const proxy = row.proxyUrl
    ? {
        server: row.proxyUrl,
        username: row.proxyUsername || undefined,
        password: row.proxyPassword || undefined,
      }
    : undefined;

  const { browser, context } = await launchBrowser({ headless: true, proxy });
  const page = await context.newPage();

  try {
    await Promise.race([
      runLogin(page, context, row),
      delayThenThrow(PER_ROW_DEADLINE_MS, `Timed out after ${Math.round(PER_ROW_DEADLINE_MS / 1000)}s`),
    ]);
  } finally {
    try { await browser.close(); } catch {}
  }
}

async function runLogin(page: any, context: any, row: BulkRowInit): Promise<void> {
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await waitFor(1500);

  const usernameInput = await page.$('input[name="username"]');
  if (!usernameInput) throw new Error('Could not find username field');
  await usernameInput.fill(row.username);

  const passwordInput = await page.$('input[name="password"]');
  if (!passwordInput) throw new Error('Could not find password field');
  await passwordInput.fill(row.password);

  const loginButton = await page.$('button[type="submit"], button:has-text("Log in")');
  if (loginButton) {
    await loginButton.click();
  } else {
    await page.press('input[name="password"]', 'Enter');
  }

  // Poll until sessionid lands or we hit a known error / timeout.
  const start = Date.now();
  while (Date.now() - start < PER_ROW_DEADLINE_MS) {
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

  // Read the canonical username from /accounts/edit/.
  let canonicalUsername: string | null = null;
  try {
    await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitFor(2500);
    canonicalUsername = await readUsernameFromEdit(page);
  } catch {}
  if (!canonicalUsername) canonicalUsername = row.username;

  // Optional: harvest display name + avatar from the profile page.
  let displayName: string | null = null;
  let profilePicUrl: string | null = null;
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
        displayName: h2 ? (h2.textContent || '').trim() : null,
        pic: avatar?.getAttribute('src') ?? null,
      };
    });
    displayName = info.displayName || null;
    profilePicUrl = info.pic || null;
  } catch {}

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

async function readUsernameFromEdit(page: any): Promise<string | null> {
  for (let i = 0; i < 5; i++) {
    const found = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('input[name="username"]');
      if (input && input.value) return input.value;
      const allInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
      for (const inp of allInputs) {
        if ((inp.name === 'username' || inp.placeholder?.toLowerCase().includes('username')) && inp.value) {
          return inp.value;
        }
      }
      return null;
    });
    if (typeof found === 'string' && found.length > 0) return found;
    await waitFor(1500);
  }
  return null;
}
