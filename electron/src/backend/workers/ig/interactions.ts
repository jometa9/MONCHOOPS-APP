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
import { waitForPageReady } from './network';
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
    // Wait for IG to hydrate the post page — the heart svg is rendered by
    // the SPA after fetching post data, so checking too early would falsely
    // return 'unavailable' on a post that's actually likeable.
    await waitForPageReady(page);

    const state = await detectLikeState(page);
    if (state === 'liked') return { ok: true, skipped: true, reason: 'already_liked' };
    if (state === 'unavailable') return { ok: false, reason: 'like_button_not_found' };

    const clicked = await clickLikeButton(page);
    if (!clicked) return { ok: false, reason: 'click_failed' };

    // The like XHR has to round-trip before the heart re-renders as
    // "Unlike". waitForPageReady catches that XHR via the permissive filter.
    await waitForPageReady(page);
    const after = await detectLikeState(page);
    if (after === 'liked') return { ok: true, skipped: false };
    return { ok: false, reason: 'state_unchanged' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type LikeState = 'not_liked' | 'liked' | 'unavailable';

// Decide whether a heart svg belongs to the POST itself rather than a
// comment / reply. Both share the exact same aria-label, so we have to
// disambiguate. Two signals are combined:
//
//   1. Rendered size. The post's main heart is ~24px on every IG layout
//      (it lives in the action bar). Comment / reply hearts are ~12-16px.
//      A `getBoundingClientRect()` width >= 20 reliably picks only the
//      post heart even on layouts where the comment list isn't a <ul>.
//   2. Ancestry as a defensive fallback. If somehow a small post heart
//      ever shipped, we still skip svgs found inside list semantics
//      (<ul>, <li>, [role="list"], [role="listitem"]).
//
// Implementation note: stringified for `page.evaluate` so it executes in
// the browser context. Keep self-contained, no TypeScript helpers.
const POST_HEART_PROBE = `
  function isPostHeart(svg) {
    var rect = svg.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return false;
    var cur = svg;
    while (cur) {
      var tag = cur.tagName;
      var role = cur.getAttribute && cur.getAttribute('role');
      if (tag === 'UL' || tag === 'LI' || role === 'list' || role === 'listitem') return false;
      if (tag === 'ARTICLE') return true;
      cur = cur.parentElement;
    }
    return true;
  }
`;

async function detectLikeState(page: Page): Promise<LikeState> {
  return (await page.evaluate(`(() => {
    ${POST_HEART_PROBE}
    var LIKED = ['Unlike', 'Ya no me gusta'];
    var UNLIKED = ['Like', 'Me gusta'];
    var svgs = Array.from(document.querySelectorAll('svg[aria-label]'))
      .filter(isPostHeart);
    for (var i = 0; i < svgs.length; i++) {
      var label = svgs[i].getAttribute('aria-label') || '';
      if (LIKED.indexOf(label) !== -1) return 'liked';
    }
    for (var j = 0; j < svgs.length; j++) {
      var l = svgs[j].getAttribute('aria-label') || '';
      if (UNLIKED.indexOf(l) !== -1) return 'not_liked';
    }
    return 'unavailable';
  })()`)) as LikeState;
}

async function clickLikeButton(page: Page): Promise<boolean> {
  // Find the POST's like heart (not a comment's). Same aria-label —
  // disambiguated inside POST_HEART_PROBE by SVG size + ancestry. Walk up
  // from the chosen svg to the nearest button/role="button" and click it.
  return (await page.evaluate(`(() => {
    ${POST_HEART_PROBE}
    var POST_LABELS = ['Like', 'Me gusta'];
    var svgs = Array.from(document.querySelectorAll('svg[aria-label]'))
      .filter(function (s) {
        var label = s.getAttribute('aria-label') || '';
        return POST_LABELS.indexOf(label) !== -1 && isPostHeart(s);
      });
    for (var i = 0; i < svgs.length; i++) {
      var target = svgs[i];
      while (target) {
        var tag = target.tagName;
        var role = target.getAttribute && target.getAttribute('role');
        if (tag === 'BUTTON' || role === 'button') {
          target.click();
          return true;
        }
        target = target.parentElement;
      }
    }
    return false;
  })()`)) as boolean;
}

/** Navigate to a user's profile and follow them. If the user is already
 *  followed (button says "Following" / "Siguiendo"), we do NOT unfollow
 *  — return skipped=true. */
export async function followUser(page: Page, username: string): Promise<InteractionOutcome> {
  const clean = sanitizeUsername(username);
  if (!clean) return { ok: false, reason: 'missing_username' };

  try {
    await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/`);
    // Profile header is rendered by the SPA after the userinfo XHR returns
    // — checking before that gave false 'follow_button_not_found' on slow
    // loads. waitForPageReady gates progression on the actual fetch.
    await waitForPageReady(page);

    const state = await detectFollowState(page);
    if (state === 'following' || state === 'requested') {
      return { ok: true, skipped: true, reason: `already_${state}` };
    }
    if (state === 'unavailable') {
      await dumpFollowButtons(page);
      return { ok: false, reason: 'follow_button_not_found' };
    }

    const clicked = await clickFollowButton(page);
    if (!clicked) return { ok: false, reason: 'click_failed' };

    // The follow click fires an XHR; the button only re-renders to
    // "Following"/"Requested" after the response.
    await waitForPageReady(page);
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
    // Lowercase exact matching: IG sometimes capitalizes differently
    // across A/B variants and locale switches. We also search inside
    // <main> (not just <header>) because the profile header has been
    // re-parented under <section> in newer layouts — the literal <header>
    // tag isn't always present.
    const NOT_FOLLOWING = ['follow', 'seguir'];
    const FOLLOWING = ['following', 'siguiendo'];
    const REQUESTED = ['requested', 'solicitado'];

    const root =
      document.querySelector('main header') ??
      document.querySelector('header') ??
      document.querySelector('main') ??
      document.body;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));

    // Order matters: check FOLLOWING/REQUESTED before NOT_FOLLOWING since
    // "follow" is a substring of "following" — a `text.includes('follow')`
    // would match both.
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 30) continue;
      if (REQUESTED.includes(text)) return 'requested';
      if (FOLLOWING.includes(text)) return 'following';
    }
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 30) continue;
      if (NOT_FOLLOWING.includes(text)) return 'not_following';
    }
    return 'unavailable';
  })) as FollowState;
}

// Diagnostic: when detectFollowState returns 'unavailable', dump the
// candidate button texts so we can see what IG is actually rendering and
// adjust the matchers without asking the user to inspect DOM by hand.
async function dumpFollowButtons(page: Page): Promise<void> {
  try {
    const sample = (await page.evaluate(() => {
      const root =
        document.querySelector('main header') ??
        document.querySelector('header') ??
        document.querySelector('main') ??
        document.body;
      return Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'))
        .map((b) => (b.textContent ?? '').trim())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 12);
    })) as string[];
    sendLog('warn', `  [follow] candidate buttons: ${sample.length === 0 ? '(none)' : sample.join(' | ')}`);
  } catch {
    // diagnostic — never block the caller
  }
}

async function clickFollowButton(page: Page): Promise<boolean> {
  // Match buttons by their lowercase text inside the profile root —
  // mirrors detectFollowState so a state of 'not_following' guarantees
  // we'll find the same button to click.
  return (await page.evaluate(() => {
    const NOT_FOLLOWING = ['follow', 'seguir'];
    const root =
      document.querySelector('main header') ??
      document.querySelector('header') ??
      document.querySelector('main') ??
      document.body;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 30) continue;
      if (NOT_FOLLOWING.includes(text)) {
        b.click();
        return true;
      }
    }
    return false;
  })) as boolean;
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
  await waitForPageReady(page);
  await scrollForDuration(page, durationMs);
}

/** Same idea on /explore/: loads the grid and scrolls through it for the
 *  given duration. */
export async function viewExplore(page: Page, durationMs: number): Promise<void> {
  await safeGoto(page, 'https://www.instagram.com/explore/');
  await waitForPageReady(page);
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
      await waitForPageReady(page);

      if (opts.like) {
        const state = await detectLikeState(page);
        if (state === 'not_liked') {
          const clicked = await clickLikeButton(page);
          if (clicked) {
            await waitForPageReady(page);
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
