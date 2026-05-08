

import { safeGoto, sendLog } from '../lib';
import { waitForPageReady } from './network';
import { iterateByScrolling, scrollWindow } from './scroll';

type Page = any;

export interface LocationSearchOpts {

  recent?: boolean;
}

export async function* iterPostsByHashtag(
  page: Page,
  hashtag: string
): AsyncGenerator<string, void, void> {
  await gotoHashtagGrid(page, hashtag);
  yield* iterateGridPosts(page);
}

export async function* iterPostsByLocation(
  page: Page,
  locationInput: string,
  opts: LocationSearchOpts = {}
): AsyncGenerator<string, void, void> {
  await gotoLocationGrid(page, locationInput, opts);
  yield* iterateGridPosts(page);
}

export async function gotoHashtagGrid(page: Page, hashtag: string): Promise<void> {
  const clean = hashtag.replace(/^#+/, '').trim();
  if (!clean) throw new Error('hashtag is required');
  await safeGoto(page, `https://www.instagram.com/explore/tags/${encodeURIComponent(clean)}/`);
  await waitForPageReady(page);
}

export async function gotoLocationGrid(
  page: Page,
  locationInput: string,
  opts: LocationSearchOpts = {}
): Promise<void> {
  const raw = locationInput.trim();
  if (!raw) throw new Error('location is required');
  const base = raw.startsWith('http')
    ? raw
    : `https://www.instagram.com/explore/locations/${raw}/`;
  const wantRecent = opts.recent ?? true;
  const url = wantRecent ? toRecentUrl(base) : base;
  await safeGoto(page, url);
  await waitForPageReady(page);

  if (wantRecent) {
    const counts = await probeGridAnchors(page);
    sendLog(
      'info',
      `      [grid] location /recent/: posts=${counts.posts} reels=${counts.reels} anchors=${counts.anchors}`
    );
    if (counts.posts + counts.reels === 0) {
      sendLog('info', `      [grid] /recent/ empty, falling back to Top tab (${base})`);
      await safeGoto(page, base);
      await waitForPageReady(page);
      const retry = await probeGridAnchors(page);
      sendLog(
        'info',
        `      [grid] location /top/: posts=${retry.posts} reels=${retry.reels} anchors=${retry.anchors}`
      );
    }
  }
}

export function iteratePostsOnGrid(page: Page): AsyncGenerator<string, void, void> {
  return iterateGridPosts(page);
}

function toRecentUrl(url: string): string {
  let u = url.split('?')[0];
  if (/\/recent\/?$/.test(u)) return u.endsWith('/') ? u : `${u}/`;
  if (!u.endsWith('/')) u += '/';
  return `${u}recent/`;
}

export async function readLocationName(page: Page): Promise<string | null> {
  try {
    return (await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const txt = h1?.textContent?.trim() || '';
      if (txt) return txt;
      const title = document.title || '';
      const m = title.match(/^([^|-(]+)/);
      return m ? m[1].trim() : null;
    })) as string | null;
  } catch {
    return null;
  }
}

function iterateGridPosts(page: Page): AsyncGenerator<string, void, void> {
  let probed = false;
  return iterateByScrolling<string>({
    scroll: () => scrollWindow(page),
    extract: async () => {
      const urls = await extractGridPostUrls(page);
      if (!probed) {
        probed = true;
        const counts = await probeGridAnchors(page);
        sendLog(
          'info',
          `      [grid] first extract: yielded=${urls.length} posts=${counts.posts} reels=${counts.reels} anchors=${counts.anchors}`
        );
      }
      return urls;
    },
  });
}

async function extractGridPostUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const set = new Set<string>();

    const addFrom = (s: string) => {
      const mp = s.match(/\/p\/([A-Za-z0-9_-]+)/);
      const mr = s.match(/\/reel\/([A-Za-z0-9_-]+)/);
      if (mp) set.add(`https://www.instagram.com/p/${mp[1]}/`);
      else if (mr) set.add(`https://www.instagram.com/reel/${mr[1]}/`);
    };
    document
      .querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]')
      .forEach((a) => {
        addFrom(a.pathname || '');
        if (set.size === 0) addFrom(a.getAttribute('href') || '');
      });

    document
      .querySelectorAll<HTMLElement>('[role="link"]')
      .forEach((el) => {
        const anchor = el.closest('a') ?? el.querySelector('a');
        if (anchor) {
          addFrom((anchor as HTMLAnchorElement).pathname || '');
          addFrom(anchor.getAttribute('href') || '');
        }
      });
    return Array.from(set);
  }) as Promise<string[]>;
}

async function probeGridAnchors(
  page: Page
): Promise<{ posts: number; reels: number; anchors: number }> {
  try {
    return (await page.evaluate(() => ({
      posts: document.querySelectorAll('a[href*="/p/"]').length,
      reels: document.querySelectorAll('a[href*="/reel/"]').length,
      anchors: document.querySelectorAll('a').length,
    }))) as { posts: number; reels: number; anchors: number };
  } catch {
    return { posts: 0, reels: 0, anchors: 0 };
  }
}
