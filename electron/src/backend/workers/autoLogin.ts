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

const LOGIN_DEADLINE_MS = 15_000;

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
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // Instagram sometimes shows a cookie consent banner before rendering the
    // login form. Click it away so the form can mount.
    await dismissCookieBanner(page);

    // Instagram renamed the form fields in 2026: the username input is now
    // name="email" (still autocomplete="username") and the password is
    // name="pass". Keep the old names as fallbacks.
    const USERNAME_SEL =
      'input[autocomplete*="username"], input[name="email"], input[name="username"]';
    const PASSWORD_SEL = 'input[type="password"]';

    try {
      await fillLoginField(page, USERNAME_SEL, init.username);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Could not enter username on Instagram login page: ${msg} (at ${page.url()})`);
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }

    try {
      await fillLoginField(page, PASSWORD_SEL, init.password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`Could not enter password on Instagram login page: ${msg}`);
      try { await browser.close(); } catch {}
      process.exit(1);
      return;
    }

    // Submit: the login button is a div[role="button"] in the new layout, and
    // there's still a hidden <input type="submit">. Pressing Enter on the
    // password field is the most reliable trigger across variants.
    const submitted = await submitLoginForm(page);
    if (!submitted) {
      await page.keyboard.press('Enter').catch(() => {});
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

async function fillLoginField(page: any, selector: string, value: string): Promise<void> {
  // Instagram's login form is a React controlled input that re-renders during
  // typing, which invalidates cached ElementHandles and drops keystrokes (we
  // saw a 14-char username land as just the trailing 2 chars). Using a Locator
  // re-resolves the element on every action, and we verify + retry until the
  // DOM value matches what we intended to type.
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 20_000 });

  let lastValue = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await loc.click(); } catch {}
    // Select-all + delete is more resilient than fill('') against controlled
    // inputs that reject programmatic value sets.
    try {
      await loc.press('ControlOrMeta+A');
      await loc.press('Delete');
    } catch {}
    try {
      await loc.fill(value);
    } catch {
      // fill() can throw if the element detaches mid-call — fall through to
      // verification and retry.
    }

    lastValue = await loc.inputValue().catch(() => '');
    if (lastValue === value) return;

    // fill() didn't stick — try typing character-by-character instead.
    try { await loc.click(); } catch {}
    try {
      await loc.press('ControlOrMeta+A');
      await loc.press('Delete');
    } catch {}
    try {
      await loc.pressSequentially(value, { delay: 35 });
    } catch {}

    lastValue = await loc.inputValue().catch(() => '');
    if (lastValue === value) return;

    await waitFor(400);
  }

  throw new Error(`value did not persist in field (got "${lastValue}", expected "${value}")`);
}

async function submitLoginForm(page: any): Promise<boolean> {
  // Try the visible button first (div[role="button"] in the new layout,
  // <button> in the old one). If it's aria-disabled, fall back to requesting
  // form submit programmatically.
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
  // Instagram's EU/ROW consent banner uses localized copy. Click the first
  // button whose text matches a known "accept/allow" variant.
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
    // Non-fatal — if the banner isn't present, nothing to do.
  }
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
