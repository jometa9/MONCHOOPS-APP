// Search primitives: lazily yield post URLs from a hashtag or location grid.
// The caller drives iteration — we only scroll the grid when they ask for the
// next URL, so if they hit their lead cap after one post we never scroll at
// all.

import { safeGoto, waitFor } from '../lib';
import { iterateByScrolling, scrollWindow } from './scroll';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LocationSearchOpts {
  /** Use Instagram's /recent/ variant of the location page. Default true. */
  recent?: boolean;
}

export async function* iterPostsByHashtag(
  page: Page,
  hashtag: string
): AsyncGenerator<string, void, void> {
  const clean = hashtag.replace(/^#+/, '').trim();
  if (!clean) throw new Error('hashtag is required');

  await safeGoto(page, `https://www.instagram.com/explore/tags/${encodeURIComponent(clean)}/`);
  await waitFor(2500);
  yield* iterateGridPosts(page);
}

export async function* iterPostsByLocation(
  page: Page,
  locationInput: string,
  opts: LocationSearchOpts = {}
): AsyncGenerator<string, void, void> {
  const raw = locationInput.trim();
  if (!raw) throw new Error('location is required');

  const base = raw.startsWith('http')
    ? raw
    : `https://www.instagram.com/explore/locations/${raw}/`;
  const url = (opts.recent ?? true) ? toRecentUrl(base) : base;

  await safeGoto(page, url);
  await waitFor(2500);
  yield* iterateGridPosts(page);
}

function toRecentUrl(url: string): string {
  let u = url.split('?')[0];
  if (/\/recent\/?$/.test(u)) return u.endsWith('/') ? u : `${u}/`;
  if (!u.endsWith('/')) u += '/';
  return `${u}recent/`;
}

function iterateGridPosts(page: Page): AsyncGenerator<string, void, void> {
  return iterateByScrolling<string>({
    scroll: () => scrollWindow(page),
    extract: async () =>
      page.evaluate(() => {
        const set = new Set<string>();
        document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]').forEach((a) => {
          const path = a.pathname || '';
          const mp = path.match(/^\/p\/([^/?#]+)/);
          const mr = path.match(/^\/reel\/([^/?#]+)/);
          if (mp) set.add(`https://www.instagram.com/p/${mp[1]}/`);
          else if (mr) set.add(`https://www.instagram.com/reel/${mr[1]}/`);
        });
        return Array.from(set);
      }),
  });
}
