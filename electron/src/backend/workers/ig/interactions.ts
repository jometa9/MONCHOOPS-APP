// Interaction primitives: like a post/reel, follow a user. Used by the
// Mass DM worker when the user opts into pre-DM interactions (like N
// recent posts of the recipient, follow them).
//
// Every action is idempotent-safe: liking an already-liked post is a noop
// (returns { ok:true, skipped:true, reason:'already_liked' }), following
// an already-followed user never unfollows. Actions return a structured
// result so the worker can persist counts without grepping logs.

import { safeGoto, sendLog, waitFor, jitter, isCancelled } from '../lib';
import { waitForPageReady } from './network';
import { iterUserPosts } from './profile';

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
async function likePost(page: Page, postUrl: string): Promise<InteractionOutcome> {
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

    // Confirmation modal race: IG sometimes drops a "Do you know this
    // person?" dialog after the click, blocking the follow until we
    // confirm. Poll briefly since the dialog takes a beat to render.
    for (let i = 0; i < 4; i++) {
      if (await confirmFollowAnywayIfPrompted(page)) {
        sendLog('info', '  [follow] confirmed "Do you know this person?" prompt');
        break;
      }
      await waitFor(400);
    }

    // The follow click fires an XHR; the button only re-renders to
    // "Following"/"Requested" after the response. Two timing hazards:
    //  1. waitForPageReady may return before the button label flips if the
    //     network settles momentarily between XHRs.
    //  2. IG sometimes drops a "Suggested for you" drawer that reparents
    //     the header, so the follow button becomes 'unavailable' even
    //     though the follow succeeded.
    // Poll a few times to absorb the render race, and treat 'unavailable'
    // after a successful click as success (we know we clicked Follow).
    await waitForPageReady(page);
    for (let i = 0; i < 5; i++) {
      const after = await detectFollowState(page);
      if (after === 'following' || after === 'requested') {
        return { ok: true, skipped: false };
      }
      if (after === 'unavailable') {
        return { ok: true, skipped: false };
      }
      await waitFor(700);
    }
    return { ok: false, reason: 'state_unchanged' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type FollowState = 'not_following' | 'following' | 'requested' | 'unavailable';

async function detectFollowState(page: Page): Promise<FollowState> {
  return (await page.evaluate(() => {
    // IG's follow button is a split button once followed: "Following ▾"
    // with an SVG icon that contributes alt text (e.g. "Down chevron icon"),
    // so the full textContent ends up like "FollowingDown chevron icon".
    // We match by prefix for FOLLOWING/REQUESTED so icon alt text doesn't
    // break detection. NOT_FOLLOWING stays as an exact match — "follow" is
    // a prefix of "following" and we must not conflate the two.
    const NOT_FOLLOWING = ['follow', 'seguir'];
    const FOLLOWING = ['following', 'siguiendo'];
    const REQUESTED = ['requested', 'solicitado'];

    const root =
      document.querySelector('main header') ??
      document.querySelector('header') ??
      document.querySelector('main') ??
      document.body;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));

    // First pass: FOLLOWING/REQUESTED via prefix match (tolerant of icon
    // alt text appended to the label).
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 60) continue;
      if (REQUESTED.some((t) => text === t || text.startsWith(t))) return 'requested';
      if (FOLLOWING.some((t) => text === t || text.startsWith(t))) return 'following';
    }
    // Second pass: NOT_FOLLOWING via exact match only.
    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 60) continue;
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

// IG occasionally pops a "Do you know this person?" confirmation after we
// click Follow — usually on suspicious/fresh accounts or after a burst of
// follows. It blocks the follow until we confirm by clicking "Follow
// anyway". Click the confirm button if it appears; no-op otherwise.
async function confirmFollowAnywayIfPrompted(page: Page): Promise<boolean> {
  return (await page.evaluate(() => {
    const TITLE_HINTS = [
      'do you know this person',
      'conoces a esta persona',
      '¿conoces a esta persona',
    ];
    const CONFIRM_LABELS = [
      'follow anyway',
      'seguir de todos modos',
      'seguir de todas formas',
      'seguir igual',
    ];

    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"]'));
    for (const d of dialogs) {
      const text = (d.textContent ?? '').toLowerCase();
      if (!TITLE_HINTS.some((h) => text.includes(h))) continue;

      const buttons = Array.from(d.querySelectorAll<HTMLElement>('button, [role="button"]'));
      for (const b of buttons) {
        const label = (b.textContent ?? '').trim().toLowerCase();
        if (!label || label.length > 40) continue;
        if (CONFIRM_LABELS.some((l) => label === l || label.startsWith(l))) {
          b.click();
          return true;
        }
      }
    }
    return false;
  })) as boolean;
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

