

import { safeGoto, sendLog, waitFor, jitter, isCancelled } from '../lib';
import { waitForPageReady } from './network';
import { iterUserPosts } from './profile';

type Page = any;

export type InteractionOutcome =
  | { ok: true; skipped: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; reason: string };

function sanitizeUsername(raw: string): string {
  return raw.replace(/^@+/, '').trim();
}

async function likePost(page: Page, postUrl: string): Promise<InteractionOutcome> {
  if (!postUrl) return { ok: false, reason: 'missing_post_url' };

  try {
    await safeGoto(page, postUrl);

    await waitForPageReady(page);

    const state = await detectLikeState(page);
    if (state === 'liked') return { ok: true, skipped: true, reason: 'already_liked' };
    if (state === 'unavailable') return { ok: false, reason: 'like_button_not_found' };

    const clicked = await clickLikeButton(page);
    if (!clicked) return { ok: false, reason: 'click_failed' };

    await waitForPageReady(page);
    const after = await detectLikeState(page);
    if (after === 'liked') return { ok: true, skipped: false };
    return { ok: false, reason: 'state_unchanged' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

type LikeState = 'not_liked' | 'liked' | 'unavailable';

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

export async function followUser(page: Page, username: string): Promise<InteractionOutcome> {
  const clean = sanitizeUsername(username);
  if (!clean) return { ok: false, reason: 'missing_username' };

  try {
    await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/`);

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

    for (let i = 0; i < 4; i++) {
      if (await confirmFollowAnywayIfPrompted(page)) {
        sendLog('info', '  [follow] confirmed "Do you know this person?" prompt');
        break;
      }
      await waitFor(400);
    }

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

    const NOT_FOLLOWING = ['follow', 'seguir'];
    const FOLLOWING = ['following', 'siguiendo'];
    const REQUESTED = ['requested', 'solicitado'];

    const root =
      document.querySelector('main header') ??
      document.querySelector('header') ??
      document.querySelector('main') ??
      document.body;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));

    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 60) continue;
      if (REQUESTED.some((t) => text === t || text.startsWith(t))) return 'requested';
      if (FOLLOWING.some((t) => text === t || text.startsWith(t))) return 'following';
    }

    for (const b of buttons) {
      const text = (b.textContent ?? '').trim().toLowerCase();
      if (!text || text.length > 60) continue;
      if (NOT_FOLLOWING.includes(text)) return 'not_following';
    }
    return 'unavailable';
  })) as FollowState;
}

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

  }
}

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

