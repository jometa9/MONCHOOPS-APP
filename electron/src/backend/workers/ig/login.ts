// ensureLoggedIn — reusable entry-point for scrape/DM workers. Assumes the
// browser context was already seeded with the account's sessionid cookie via
// launchBrowser(). This function navigates to instagram.com, waits out any
// reCAPTCHA challenge, dismisses post-login nudges, and confirms the session
// is live. If no sessionid cookie is present and credentials were provided,
// it falls back to a password login.

import { safeGoto, sendLog, waitFor } from '../lib';
import { SELECTORS } from './selectors';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface EnsureLoggedInOpts {
  /** Max time to wait while a captcha challenge is visible. Default 5 min. */
  captchaTimeoutMs?: number;
  /** Optional fallback credentials if the cookie session is stale. */
  username?: string;
  password?: string;
}

const DEFAULT_CAPTCHA_TIMEOUT_MS = 5 * 60_000;
const SESSION_POLL_MS = 2000;

export async function ensureLoggedIn(page: Page, opts: EnsureLoggedInOpts = {}): Promise<void> {
  const captchaTimeoutMs = opts.captchaTimeoutMs ?? DEFAULT_CAPTCHA_TIMEOUT_MS;

  await safeGoto(page, 'https://www.instagram.com/');
  await waitFor(2500);

  await waitOutCaptcha(page, captchaTimeoutMs);
  await dismissDialogs(page);

  if (await hasSession(page)) return;

  if (opts.username && opts.password) {
    await passwordLogin(page, opts.username, opts.password, captchaTimeoutMs);
    await dismissDialogs(page);
    if (await hasSession(page)) return;
  }

  throw new Error('Instagram session is not active. Re-login this account and retry.');
}

async function hasSession(page: Page): Promise<boolean> {
  try {
    const cookies = await page.context().cookies('https://www.instagram.com/');
    return cookies.some((c: { name: string }) => c.name === 'sessionid');
  } catch {
    return false;
  }
}

async function waitOutCaptcha(page: Page, timeoutMs: number): Promise<void> {
  const initial = await page.$(SELECTORS.captcha).catch(() => null);
  if (!initial) return;

  sendLog('warn', `Captcha detected — waiting up to ${Math.round(timeoutMs / 1000)}s for manual resolution`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await waitFor(SESSION_POLL_MS);
    const still = await page.$(SELECTORS.captcha).catch(() => null);
    if (!still) {
      sendLog('info', 'Captcha cleared');
      return;
    }
  }
  throw new Error('Captcha was not resolved within the allowed window');
}

async function dismissDialogs(page: Page): Promise<void> {
  // "Save your login info?" — appears after cookie-based re-entry too.
  for (const label of ['Not now', 'Not Now']) {
    try {
      await page.locator(`button:has-text("${label}")`).first().click({ timeout: 1500 });
      await waitFor(600);
    } catch {
      // Button isn't present — that's fine.
    }
  }
}

async function passwordLogin(
  page: Page,
  username: string,
  password: string,
  captchaTimeoutMs: number
): Promise<void> {
  await safeGoto(page, 'https://www.instagram.com/accounts/login/');
  await waitFor(1500);

  await page.fill(SELECTORS.loginUsername, username);
  await page.fill(SELECTORS.loginPassword, password);
  await page.press(SELECTORS.loginPassword, 'Enter');
  await waitFor(2500);

  await waitOutCaptcha(page, captchaTimeoutMs);

  // Wait for the session cookie to appear after submit.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await hasSession(page)) return;
    await waitFor(SESSION_POLL_MS);
  }
}
