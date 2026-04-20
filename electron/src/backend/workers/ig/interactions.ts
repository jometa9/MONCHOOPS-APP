// Interaction primitives: like a post/reel, follow a user, plus "human
// activity" loops (browse feed / explore, act on a hashtag grid). Designed
// to be composed freely by the warmup worker and by the Mass DM worker
// when the user opts into pre-DM interactions.
//
// Every action is idempotent-safe: liking an already-liked post is a noop
// (returns { ok:true, skipped:true, reason:'already_liked' }), following
// an already-followed user never unfollows. Actions return a structured
// result so the worker can persist counts without grepping logs.

import { safeGoto, sendLog, waitFor, jitter, isCancelled } from '../lib';
import { iterUserPosts } from './profile';
import { iterPostsByHashtag, iterPostsByLocation } from './search';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type InteractionOutcome =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

function sanitizeUsername(raw: string): string {
  return raw.replace(/^@+/, '').trim();
}

/** Like the post/reel at `postUrl`. Detects already-liked state via the
 *  heart's aria-label ("Like" = not liked yet; "Unlike" = already liked).
 *  Supports both English and Spanish labels. */
export async function likePost(page: Page, postUrl: string): Promise<InteractionOutcome> {
  if (!postUrl) return { ok: false, reason: 'missing_post_url' };

  try {
    await safeGoto(page, postUrl);
    await waitFor(jitter(2500));

    const state = await detectLikeState(page);
    if (state === 'liked') return { ok: true, skipped: true, reason: 'already_liked' };
    if (state === 'unavailable') return { ok: false, reason: 'like_button_not_found' };

    const clicked = await clickLikeButton(page);
    if (!clicked) return { ok: false, reason: 'click_failed' };

    await waitFor(jitter(1200));
    const after = await detectLikeState(page);
    if (after === 'liked') return { ok: true, skipped: false };
    return { ok: false, reason: 'state_unchanged' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type LikeState = 'not_liked' | 'liked' | 'unavailable';

async function detectLikeState(page: Page): Promise<LikeState> {
  return (await page.evaluate(() => {
    const LIKED = ['Unlike', 'Ya no me gusta'];
    const UNLIKED = ['Like', 'Me gusta'];
    const svgs = Array.from(document.querySelectorAll<SVGElement>('svg[aria-label]'));
    for (const svg of svgs) {
      const label = svg.getAttribute('aria-label') ?? '';
      if (LIKED.includes(label)) return 'liked';
    }
    for (const svg of svgs) {
      const label = svg.getAttribute('aria-label') ?? '';
      if (UNLIKED.includes(label)) return 'not_liked';
    }
    return 'unavailable';
  })) as LikeState;
}

async function clickLikeButton(page: Page): Promise<boolean> {
  const selectors = [
    'svg[aria-label="Like"]',
    'svg[aria-label="Me gusta"]',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const n = await loc.count();
      if (n === 0) continue;
      // The svg itself usually isn't the click target — walk up to the
      // nearest button/role="button" ancestor and click that.
      await loc.evaluate((el: Element) => {
        let cur: HTMLElement | null = el as unknown as HTMLElement;
        while (cur) {
          const tag = cur.tagName;
          const role = cur.getAttribute('role');
          if (tag === 'BUTTON' || role === 'button') {
            cur.click();
            return;
          }
          cur = cur.parentElement;
        }
      });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

/** Navigate to a user's profile and follow them. If the user is already
 *  followed (button says "Following" / "Siguiendo"), we do NOT unfollow
 *  — return skipped=true. */
export async function followUser(page: Page, username: string): Promise<InteractionOutcome> {
  const clean = sanitizeUsername(username);
  if (!clean) return { ok: false, reason: 'missing_username' };

  try {
    await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/`);
    await waitFor(jitter(2500));

    const state = await detectFollowState(page);
    if (state === 'following' || state === 'requested') {
      return { ok: true, skipped: true, reason: `already_${state}` };
    }
    if (state === 'unavailable') {
      return { ok: false, reason: 'follow_button_not_found' };
    }

    const clicked = await clickFollowButton(page);
    if (!clicked) return { ok: false, reason: 'click_failed' };

    await waitFor(jitter(1500));
    const after = await detectFollowState(page);
    if (after === 'following' || after === 'requested') return { ok: true, skipped: false };
    return { ok: false, reason: 'state_unchanged' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type FollowState = 'not_following' | 'following' | 'requested' | 'unavailable';

async function detectFollowState(page: Page): Promise<FollowState> {
  return (await page.evaluate(() => {
    const NOT_FOLLOWING = ['Follow', 'Seguir'];
    const FOLLOWING = ['Following', 'Siguiendo'];
    const REQUESTED = ['Requested', 'Solicitado'];
    const header =
      document.querySelector('header') ??
      document.querySelector('main header') ??
      document.body;
    const buttons = Array.from(header.querySelectorAll<HTMLButtonElement>('button, [role="button"]'));
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim();
      if (!text || text.length > 20) continue;
      if (REQUESTED.includes(text)) return 'requested';
      if (FOLLOWING.includes(text)) return 'following';
      if (NOT_FOLLOWING.includes(text)) return 'not_following';
    }
    return 'unavailable';
  })) as FollowState;
}

async function clickFollowButton(page: Page): Promise<boolean> {
  for (const label of ['Follow', 'Seguir']) {
    try {
      const loc = page.locator(`header button:has-text("${label}"), header [role="button"]:has-text("${label}")`).first();
      const n = await loc.count();
      if (n === 0) continue;
      await loc.click({ timeout: 3000 });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

export interface LikeNResult {
  attempted: number;
  liked: number;
  skipped: number;
  failed: number;
  reason?: 'no_posts' | 'private' | 'empty';
}

/** Visit a user's profile, open up to `n` of their most recent posts, and
 *  like each. If the user has fewer than `n` posts we like all of them.
 *  If the user has no posts (or is private), returns reason without any
 *  attempts. */
export async function likeNPostsOfUser(
  page: Page,
  username: string,
  n: number
): Promise<LikeNResult> {
  const clean = sanitizeUsername(username);
  if (!clean) throw new Error('username is required');
  if (n <= 0) return { attempted: 0, liked: 0, skipped: 0, failed: 0 };

  const urls: string[] = [];
  for await (const url of iterUserPosts(page, clean)) {
    urls.push(url);
    if (urls.length >= n) break;
    if (isCancelled()) break;
  }

  if (urls.length === 0) {
    return { attempted: 0, liked: 0, skipped: 0, failed: 0, reason: 'no_posts' };
  }

  let liked = 0;
  let skipped = 0;
  let failed = 0;
  for (const url of urls) {
    if (isCancelled()) break;
    const res = await likePost(page, url);
    if (res.ok && !res.skipped) liked += 1;
    else if (res.ok && res.skipped) skipped += 1;
    else failed += 1;
    await waitFor(jitter(1800));
  }
  return { attempted: urls.length, liked, skipped, failed };
}

/** Park on the home feed and scroll for `durationMs` with human-ish
 *  pauses, occasionally playing a reel that scrolls into view. No likes
 *  or follows — just "I'm here, I'm looking" activity. */
export async function viewFeed(page: Page, durationMs: number): Promise<void> {
  await safeGoto(page, 'https://www.instagram.com/');
  await waitFor(jitter(2500));
  await scrollForDuration(page, durationMs);
}

/** Same idea on /explore/: loads the grid and scrolls through it for the
 *  given duration. */
export async function viewExplore(page: Page, durationMs: number): Promise<void> {
  await safeGoto(page, 'https://www.instagram.com/explore/');
  await waitFor(jitter(2500));
  await scrollForDuration(page, durationMs);
}

async function scrollForDuration(page: Page, durationMs: number): Promise<void> {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    if (isCancelled()) return;
    // Scroll a random amount — not a full page — to look less robotic.
    const by = 400 + Math.floor(Math.random() * 600);
    try {
      await page.evaluate((px: number) => window.scrollBy({ top: px, behavior: 'smooth' }), by);
    } catch {
      // page may have been closed mid-loop during cancel — swallow
    }
    await waitFor(jitter(2500, 0.5));
  }
}

export interface HashtagActOpts {
  /** Like each post encountered. Default false. */
  like?: boolean;
  /** Follow each post's author. Default false. */
  follow?: boolean;
  /** Max posts to touch. Required — hashtags have effectively infinite
   *  posts and we need an upper bound. */
  count: number;
}

export interface HashtagActResult {
  visited: number;
  liked: number;
  followed: number;
  skipped: number;
  failed: number;
}

/** Walk a hashtag grid and apply like/follow actions to each of the first
 *  `count` posts. The scrape worker uses the same iterator so behavior is
 *  consistent. */
export async function iterHashtagAndAct(
  page: Page,
  hashtag: string,
  opts: HashtagActOpts
): Promise<HashtagActResult> {
  const clean = hashtag.replace(/^#+/, '').trim();
  if (!clean) throw new Error('hashtag is required');
  return actOnGridIterator(
    page,
    iterPostsByHashtag(page, clean),
    opts,
    `hashtag #${clean}`
  );
}

/** Walk a location grid (recent tab) and apply like/follow actions to each
 *  of the first `count` posts. Mirrors `iterHashtagAndAct` so the warmup
 *  worker can treat location and hashtag as interchangeable sources. */
export async function iterLocationAndAct(
  page: Page,
  location: string,
  opts: HashtagActOpts
): Promise<HashtagActResult> {
  const raw = location.trim();
  if (!raw) throw new Error('location is required');
  return actOnGridIterator(
    page,
    iterPostsByLocation(page, raw, { recent: true }),
    opts,
    `location ${raw}`
  );
}

async function actOnGridIterator(
  page: Page,
  iter: AsyncIterable<string>,
  opts: HashtagActOpts,
  sourceLabel: string
): Promise<HashtagActResult> {
  if (opts.count <= 0) return { visited: 0, liked: 0, followed: 0, skipped: 0, failed: 0 };

  const urls: string[] = [];
  for await (const url of iter) {
    urls.push(url);
    if (urls.length >= opts.count) break;
    if (isCancelled()) break;
  }

  let liked = 0;
  let followed = 0;
  let skipped = 0;
  let failed = 0;
  for (const url of urls) {
    if (isCancelled()) break;
    try {
      await safeGoto(page, url);
      await waitFor(jitter(2500));

      if (opts.like) {
        const state = await detectLikeState(page);
        if (state === 'not_liked') {
          const clicked = await clickLikeButton(page);
          if (clicked) {
            await waitFor(jitter(1000));
            const after = await detectLikeState(page);
            if (after === 'liked') liked += 1;
            else failed += 1;
          } else {
            failed += 1;
          }
        } else if (state === 'liked') {
          skipped += 1;
        } else {
          failed += 1;
        }
      }

      if (opts.follow) {
        const author = await readPostAuthor(page);
        if (author) {
          const res = await followUser(page, author);
          if (res.ok && !res.skipped) followed += 1;
          else if (res.ok && res.skipped) skipped += 1;
          else failed += 1;
        } else {
          failed += 1;
        }
      }
    } catch (err) {
      sendLog(
        'warn',
        `${sourceLabel} act on ${url} failed: ${err instanceof Error ? err.message : String(err)}`
      );
      failed += 1;
    }
    await waitFor(jitter(2200));
  }
  return { visited: urls.length, liked, followed, skipped, failed };
}

async function readPostAuthor(page: Page): Promise<string | null> {
  try {
    return (await page.evaluate(() => {
      const header =
        document.querySelector('article header') ??
        document.querySelector('header');
      if (!header) return null;
      const a = header.querySelector<HTMLAnchorElement>('a');
      if (!a) return null;
      const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
      return m ? m[1] ?? null : null;
    })) as string | null;
  } catch {
    return null;
  }
}
