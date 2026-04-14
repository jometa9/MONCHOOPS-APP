// Forked worker: opens a headed Chromium to let the user log into Instagram
// manually. Everything happens through Playwright — navigation + DOM reads,
// never by hitting Instagram's internal JSON endpoints. That's friendlier to
// IG's bot detection and avoids the schema drift we'd get from private APIs.

import { launchBrowser, onInit, sendError, sendResult, waitFor } from './lib';
import type { InstagramCookie } from '../accounts';

interface LoginInit {
  jobId: string;
  proxy?: { server: string; username?: string; password?: string };
}

const LOGIN_DEADLINE_MS = 10 * 60_000;
const RESERVED = new Set(['explore', 'direct', 'accounts', 'reels', 'reel', 'p', 'stories', 'tv', 'about', 'legal']);

onInit<LoginInit>(async (init) => {
  const { browser, context } = await launchBrowser({ headless: false, proxy: init.proxy });

  const page = await context.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });

  // Poll until a sessionid cookie appears under .instagram.com.
  const deadline = Date.now() + LOGIN_DEADLINE_MS;
  let sessionFound = false;

  while (Date.now() < deadline) {
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

  // Go home so the nav bar is rendered with the user's avatar link.
  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch {}
  await waitFor(2500);

  const username = await readUsernameFromNav(page);
  if (!username) {
    sendError('Logged in, but could not read your username from the page. Try again.');
    try { await browser.close(); } catch {}
    return;
  }

  // Visit the profile page to harvest display name + avatar.
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
    // Non-fatal: we can persist the account without a display name / pfp.
  }

  const cookies = (await context.cookies()) as InstagramCookie[];
  const userAgent = (await page.evaluate(() => navigator.userAgent).catch(() => '')) ||
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

  sendResult({
    username,
    displayName,
    profilePicUrl,
    cookies,
    userAgent,
  });

  try { await browser.close(); } catch {}
  process.exit(0);
});

// Reads the current user's handle by finding the avatar link in the nav.
// That link always points to "/<username>/" for the logged-in account.
async function readUsernameFromNav(page: any): Promise<string | null> {
  // Give the nav a few attempts — IG sometimes ships a "one-tap" intermediate.
  for (let i = 0; i < 5; i++) {
    const found = await page.evaluate((reservedList: string[]) => {
      const reserved = new Set(reservedList);
      // Prefer anchors that wrap an <img> (the nav avatar).
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'));
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (!m || !m[1]) continue;
        if (reserved.has(m[1])) continue;
        if (a.querySelector('img')) return m[1];
      }
      return null;
    }, Array.from(RESERVED));

    if (typeof found === 'string' && found.length > 0) return found;
    await waitFor(1500);
  }
  return null;
}
