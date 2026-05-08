

import { isCancelled, launchBrowser, onInit, sendError, sendResult, waitFor, type WindowBounds } from './lib';
import { attachDialogDismisser } from './ig';
import type { InstagramCookie } from '../accounts';

interface LoginInit {
  jobId: string;
  proxy?: { server: string; username?: string; password?: string };
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

const LOGIN_DEADLINE_MS = 10 * 60_000;
const IDENTITY_DEADLINE_MS = 25_000;
const RESERVED = [
  'p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories', 'tv',
  'challenge', 'about', 'legal', 'press', 'terms', 'privacy',
];

onInit<LoginInit>(async (init) => {
  const { browser, context } = await launchBrowser({ headless: false, proxy: init.proxy, windowBounds: init.windowBounds, maximizeWindow: init.maximizeWindow });

  const page = await context.newPage();
  const detachDismisser = attachDialogDismisser(page);
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + LOGIN_DEADLINE_MS;
  let sessionFound = false;

  while (Date.now() < deadline) {
    if (isCancelled()) {
      try { await browser.close(); } catch {}
      process.exit(0);
      return;
    }
    if (context.pages().length === 0 || page.isClosed()) {
      sendError('Login window was closed before completing');
      try { await browser.close(); } catch {}
      return;
    }
    const cookies = (await context.cookies()) as InstagramCookie[];
    const hasSession = cookies.some((c) => c.name === 'sessionid' && c.domain.includes('instagram.com'));
    if (hasSession) {
      sessionFound = true;
      break;
    }
    await waitFor(1500);
  }

  if (!sessionFound) {
    sendError('Timed out waiting for Instagram login. Try again.');
    try { await browser.close(); } catch {}
    return;
  }

  const identity = await extractIdentity(page);
  if (!identity) {
    sendError('Signed in, but could not read your username. Instagram may be slow or have changed its layout — try again.');
    try { await browser.close(); } catch {}
    return;
  }

  let displayName: string | null = identity.displayName;
  let profilePicUrl: string | null = isPersistableUrl(identity.profilePicUrl) ? identity.profilePicUrl : null;
  if (!displayName || !profilePicUrl) {
    try {
      await page.goto(`https://www.instagram.com/${encodeURIComponent(identity.username)}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await waitFor(2000);
      const info = await page.evaluate(() => {
        const h2 = document.querySelector('header section h2, header section h1');
        const name = h2 ? (h2.textContent || '').trim() : null;
        const avatar = document.querySelector<HTMLImageElement>(
          'header img[alt*="profile picture" i], header img'
        );
        const pic = avatar?.getAttribute('src') ?? null;
        return { name, pic };
      });
      displayName = displayName ?? (info.name || null);
      if (!profilePicUrl && isPersistableUrl(info.pic)) {
        profilePicUrl = info.pic;
      }
    } catch {

    }
  }

  if (profilePicUrl) {
    const dataUrl = await downloadAsDataUrl(context, profilePicUrl);
    if (dataUrl) profilePicUrl = dataUrl;
  }

  const cookies = (await context.cookies()) as InstagramCookie[];
  const userAgent = (await page.evaluate(() => navigator.userAgent).catch(() => '')) ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  sendResult({
    username: identity.username,
    displayName,
    profilePicUrl,
    cookies,
    userAgent,
  });

  detachDismisser();
  try { await browser.close(); } catch {}
  process.exit(0);
});

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
              alt: (img as HTMLImageElement).alt || '',
            };
          }
        }
        return null;
      }, RESERVED)
      .catch(() => null);

    if (found && found.username) {

      return {
        username: found.username,
        displayName: null,
        profilePicUrl: found.pic,
      };
    }
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
