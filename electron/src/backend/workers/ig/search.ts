// Search primitives: enumerate posts under a hashtag or location. An
// optional { from, to } window filters by post datetime — since Instagram
// does not expose a built-in date filter, we scroll the grid newest-first
// and stop once we read a post whose timestamp is older than `from`.

import { safeGoto, sendLog, waitFor } from '../lib';
import { collectByScrolling, scrollWindow } from './scroll';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SearchOpts {
  /** Inclusive lower bound (epoch ms). Posts older than this are excluded. */
  from?: number;
  /** Inclusive upper bound (epoch ms). Posts newer than this are excluded. */
  to?: number;
  /** Stop collecting once this many URLs pass the filter. */
  max?: number;
}

export async function postsByHashtag(page: Page, hashtag: string, opts: SearchOpts = {}): Promise<string[]> {
  const clean = hashtag.replace(/^#+/, '').trim();
  if (!clean) throw new Error('hashtag is required');

  await safeGoto(page, `https://www.instagram.com/explore/tags/${encodeURIComponent(clean)}/`);
  await waitFor(2500);
  return collectPostsFromGrid(page, opts);
}

export async function postsByLocation(
  page: Page,
  locationInput: string,
  opts: SearchOpts = {}
): Promise<string[]> {
  const raw = locationInput.trim();
  if (!raw) throw new Error('location is required');
  const url = raw.startsWith('http')
    ? raw
    : `https://www.instagram.com/explore/locations/${raw}/`;

  await safeGoto(page, url);
  await waitFor(2500);
  return collectPostsFromGrid(page, opts);
}

async function collectPostsFromGrid(page: Page, opts: SearchOpts): Promise<string[]> {
  // When the caller wants a date filter, pull more candidates than `max`
  // because some will be rejected. 3× is a reasonable cushion.
  const gridMax = opts.from || opts.to ? (opts.max ? opts.max * 3 : undefined) : opts.max;

  const candidates = await collectByScrolling<string>({
    max: gridMax,
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

  if (!opts.from && !opts.to) {
    return opts.max ? candidates.slice(0, opts.max) : candidates;
  }

  // Date-filtered walk: newest first, stop once we go past `from`.
  const kept: string[] = [];
  let consecutiveOutOfRange = 0;
  for (const url of candidates) {
    const dt = await readPostDatetime(page, url);
    if (dt == null) continue;
    if (opts.to && dt > opts.to) continue;
    if (opts.from && dt < opts.from) {
      consecutiveOutOfRange += 1;
      // Grids aren't strictly chronological on hashtag "Top" — allow a few
      // misses before giving up.
      if (consecutiveOutOfRange >= 5) break;
      continue;
    }
    consecutiveOutOfRange = 0;
    kept.push(url);
    if (opts.max && kept.length >= opts.max) break;
  }
  return kept;
}

async function readPostDatetime(page: Page, postUrl: string): Promise<number | null> {
  try {
    await safeGoto(page, postUrl);
    await waitFor(1200);
    const iso = (await page.evaluate(() => {
      const t = document.querySelector<HTMLTimeElement>('time[datetime]');
      return t ? t.getAttribute('datetime') : null;
    })) as string | null;
    if (!iso) return null;
    const parsed = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (err) {
    sendLog('warn', `datetime read failed for ${postUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
