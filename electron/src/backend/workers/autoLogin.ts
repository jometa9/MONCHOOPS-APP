// Auto-login worker: uses provided credentials to log into Instagram automatically via Playwright

import { isCancelled, launchBrowser, onInit, sendError, sendLoginFailed, sendResult, waitFor } from './lib';
import type { InstagramCookie } from '../accounts';

interface AutoLoginInit {
  jobId: string;
  username: string;
  password: string;
  headless: boolean;
  proxy?: { server: string; username?: string; password?: string };
}

const LOGIN_DEADLINE_MS = 10 * 60_000;

onInit<AutoLoginInit>(async (init) => {
  // Helper: flag the attempt as failed with a user-visible error AND ask
  // main to upsert a shell account row so the user can see + retry it.
  const fail = (msg: string): void => {
    sendLoginFailed({ username: init.username, password: init.password, error: msg });
    sendError(msg);
  };

  const { browser, context } = await launchBrowser({ headless: init.headless, proxy: init.proxy });

  const page = await context.newPage();

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
    await waitFor(1500);

    // Fill username field
    const usernameInput = await page.$('input[name="username"]');
    if (!usernameInput) {
      fail('Could not find username field on Instagram login page');
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }
    await usernameInput.fill(init.username);

    // Fill password field
    const passwordInput = await page.$('input[name="password"]');
    if (!passwordInput) {
      fail('Could not find password field on Instagram login page');
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }
    await passwordInput.fill(init.password);

    // Click login button or press Enter
    const loginButton = await page.$('button[type="button"]:has-text("Log in"), button:has-text("Log in")');
    if (loginButton) {
      await loginButton.click();
    } else {
      await page.press('input[name="password"]', 'Enter');
    }

    // Poll for sessionid cookie
    const deadline = Date.now() + LOGIN_DEADLINE_MS;
    let sessionFound = false;

    while (Date.now() < deadline) {
      if (isCancelled()) {
        try { await browser.close(); } catch {}
        process.exit(0);
        return;
      }
      if (context.pages().length === 0 || page.isClosed()) {
        fail('Login window was closed unexpectedly');
        try { await browser.close(); } catch {}
        process.exit(1);
        return;
      }

      const cookies = (await context.cookies()) as InstagramCookie[];
      const hasSession = cookies.some((c) => c.name === 'sessionid' && c.domain.includes('instagram.com'));
      if (hasSession) {
        sessionFound = true;
        break;
      }

      // Check for common error indicators
      const errorText = await page.evaluate(() => {
        const errorSpans = Array.from(document.querySelectorAll('span'));
        return errorSpans
          .map((s) => s.textContent)
          .join(' ')
          .toLowerCase();
      });

      // Match a strong "wrong credentials" signal — avoid false positives from
      // generic copy that contains the word "password" (e.g. the "Forgot password?" link).
      if (
        errorText.includes("password you entered is incorrect") ||
        errorText.includes('username you entered') ||
        errorText.includes("couldn't find an account") ||
        errorText.includes('please wait a few minutes')
      ) {
        fail('Invalid username or password. Please check your credentials and try again.');
        try { await browser.close(); } catch {}
        process.exit(1);
        return;
      }

      if (errorText.includes('two-factor') || errorText.includes('security code') || errorText.includes('confirm it')) {
        fail('Two-factor authentication or a checkpoint is required. Use manual login for this account.');
        try { await browser.close(); } catch {}
        process.exit(1);
        return;
      }

      await waitFor(2000);
    }

    if (!sessionFound) {
      fail('Timed out waiting for Instagram login. Please check your credentials and try again.');
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }

    // Go to settings/edit to read the actual username
    try {
      await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch {}
    await waitFor(2500);

    const username = await readUsernameFromEdit(page);
    if (!username) {
      fail('Logged in, but could not read your username from settings. Try again.');
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }

    // Visit profile page to harvest display name + avatar
    let displayName: string | null = null;
    let profilePicUrl: string | null = null;
    try {
      await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await waitFor(2000);
      const info = await page.evaluate(() => {
        const h2 = document.querySelector('header section h2, header section h1');
        const displayName = h2 ? (h2.textContent || '').trim() : null;
        const avatar = document.querySelector<HTMLImageElement>(
          'header img[alt*="profile picture" i], header img'
        );
        const pic = avatar?.getAttribute('src') ?? null;
        return { displayName, pic };
      });
      displayName = info.displayName || null;
      profilePicUrl = info.pic || null;
    } catch {
      // Non-fatal
    }

    const cookies = (await context.cookies()) as InstagramCookie[];
    const userAgent = (await page.evaluate(() => navigator.userAgent).catch(() => '')) ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

    sendResult({
      username,
      password: init.password,
      displayName,
      profilePicUrl,
      cookies,
      userAgent,
    });

    try { await browser.close(); } catch {}
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(`Login failed: ${msg}`);
    try { await browser.close(); } catch {}
    process.exit(1);
  }
});

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
