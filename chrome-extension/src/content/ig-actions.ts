// High-level IG flows orchestrated from the content script. Mirror the
// shape of the desktop massDm worker: try the ig.me shortlink first to
// land on the thread, fall back to /direct/new/ when IG won't redirect.
//
// Each function navigates by mutating location.href and then waits for
// either a URL match or the expected DOM signal. Because content scripts
// survive same-origin SPA navigations on instagram.com, we can drive the
// whole flow from a single script context — no tab reload needed.

import {
  clickFollowButton,
  clickLikeButton,
  confirmFollowAnywayIfPrompted,
  detectFollowState,
  detectLikeState,
  dismissIgPrompts,
  findComposer,
  humanType,
  jitter,
  pressEnter,
  sleep,
  threadContainsMessage,
  waitForUrl,
  waitForVisible,
} from './ig-dom';
import type { InteractionsConfig } from '@/shared/types';

export class SendVerificationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SendVerificationError';
  }
}

async function navigate(url: string): Promise<void> {
  if (location.href === url) return;
  // Use location.assign so IG's SPA router intercepts when possible —
  // location.href = falls back to a hard nav for cross-origin (ig.me) which
  // is what we want.
  location.href = url;
  await sleep(jitter(2500));
  dismissIgPrompts();
}

// --- DM ------------------------------------------------------------------

export async function sendDm(username: string, message: string): Promise<{ verified: boolean }> {
  try {
    return await sendDmViaShortlink(username, message);
  } catch (err) {
    if (err instanceof SendVerificationError) throw err;
    // shortlink path failed — fall back to /direct/new/.
    console.warn('[b2dm] shortlink failed, falling back to /direct/new/', err);
    return sendDmViaDirectNew(username, message);
  }
}

async function sendDmViaShortlink(
  username: string,
  message: string
): Promise<{ verified: boolean }> {
  await navigate(`https://ig.me/m/${encodeURIComponent(username)}`);
  // ig.me 3xx-redirects to instagram.com/direct/t/<thread_id>/. If IG can't
  // resolve the username it lands on the inbox or a 404 — the composer wait
  // will time out and the dispatcher falls through to /direct/new/.
  await waitForUrl(/instagram\.com\/direct\/(t|inbox)/i, { timeoutMs: 25_000 });
  const composer = await findComposer(15_000);
  composer.click();
  await sleep(jitter(400));
  await humanType(composer, message);
  await sleep(jitter(1200));
  pressEnter(composer);
  return verifyAndConfirm(message);
}

async function sendDmViaDirectNew(
  username: string,
  message: string
): Promise<{ verified: boolean }> {
  await navigate('https://www.instagram.com/direct/new/');

  const composeBtn = await waitForButtonByAriaLabel(
    ['New message', 'Mensaje nuevo', 'Nuevo mensaje'],
    15_000
  );
  composeBtn.click();
  await sleep(jitter(600));

  const dialog = await waitForVisible('div[role="dialog"]', { timeoutMs: 20_000 });
  const search = await waitFor<HTMLInputElement>(
    () => dialog.querySelector<HTMLInputElement>('input[type="text"], input:not([type])'),
    { timeoutMs: 10_000 }
  );
  search.focus();
  await humanType(search, username);
  await sleep(jitter(900));

  const firstRow = await waitFor<HTMLElement>(
    () =>
      dialog.querySelector<HTMLElement>(
        'div[role="listbox"] [role="option"], label:has(input[type="checkbox"]), div[role="button"]:has(input[type="checkbox"])'
      ),
    { timeoutMs: 8_000 }
  );
  firstRow.click();
  await sleep(jitter(700));

  const chatBtn = await waitFor<HTMLElement>(() => {
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')
    );
    return (
      buttons.find((b) => /^(Chat|Chatear)$/.test((b.textContent ?? '').trim())) ?? null
    );
  }, { timeoutMs: 10_000 });
  chatBtn.click();

  const composer = await findComposer(15_000);
  composer.click();
  await sleep(jitter(400));
  await humanType(composer, message);
  await sleep(jitter(1200));
  pressEnter(composer);
  return verifyAndConfirm(message);
}

async function waitFor<T>(
  fn: () => T | null | undefined,
  { timeoutMs = 15_000, pollMs = 200 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(pollMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function waitForButtonByAriaLabel(labels: string[], timeoutMs: number): Promise<HTMLElement> {
  return waitFor<HTMLElement>(() => {
    for (const label of labels) {
      const svg = document.querySelector<HTMLElement>(`svg[aria-label="${label}"]`);
      if (!svg) continue;
      let cur: HTMLElement | null = svg;
      while (cur) {
        if (cur.getAttribute('role') === 'button' || cur.tagName === 'BUTTON') return cur;
        cur = cur.parentElement;
      }
    }
    return null;
  }, { timeoutMs });
}

async function verifyAndConfirm(message: string): Promise<{ verified: boolean }> {
  // Let IG commit the optimistic bubble + flush the send XHR.
  await sleep(jitter(2500));
  // Force a fetch from the server — the optimistic UI lies on rejected
  // sends. Reloading the SPA route is enough; IG re-fetches the thread.
  location.reload();
  await sleep(3500);
  const verified = threadContainsMessage(message);
  if (!verified) {
    throw new SendVerificationError('message text not found in thread after reload');
  }
  return { verified: true };
}

// --- interactions --------------------------------------------------------

export async function followUserFlow(
  username: string
): Promise<{ ok: boolean; skipped: boolean; reason?: string }> {
  await navigate(`https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(2500));

  const state = detectFollowState();
  if (state === 'following' || state === 'requested') {
    return { ok: true, skipped: true, reason: `already_${state}` };
  }
  if (state === 'unavailable') {
    return { ok: false, skipped: false, reason: 'follow_button_not_found' };
  }

  if (!clickFollowButton()) {
    return { ok: false, skipped: false, reason: 'click_failed' };
  }

  for (let i = 0; i < 4; i++) {
    if (confirmFollowAnywayIfPrompted()) break;
    await sleep(400);
  }
  for (let i = 0; i < 5; i++) {
    await sleep(700);
    const after = detectFollowState();
    if (after === 'following' || after === 'requested' || after === 'unavailable') {
      return { ok: true, skipped: false };
    }
  }
  return { ok: false, skipped: false, reason: 'state_unchanged' };
}

export async function likeNPosts(
  username: string,
  n: number
): Promise<{ liked: number; skipped: number; failed: number }> {
  if (n <= 0) return { liked: 0, skipped: 0, failed: 0 };
  await navigate(`https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(2200));

  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(
      'main a[href*="/p/"], main a[href*="/reel/"]'
    )
  );
  const urls = Array.from(
    new Set(links.map((a) => a.href).filter((h) => /\/(p|reel)\//.test(h)))
  ).slice(0, n);

  let liked = 0;
  let skipped = 0;
  let failed = 0;
  for (const url of urls) {
    await navigate(url);
    await sleep(jitter(2000));
    const state = detectLikeState();
    if (state === 'liked') {
      skipped += 1;
    } else if (state === 'not_liked') {
      if (clickLikeButton()) {
        await sleep(jitter(1500));
        const after = detectLikeState();
        if (after === 'liked') liked += 1;
        else failed += 1;
      } else {
        failed += 1;
      }
    } else {
      failed += 1;
    }
    await sleep(jitter(1800));
  }
  return { liked, skipped, failed };
}

// "Watch" the user's stories: open the stories tray for that handle and
// dwell on each frame for storyDwellSec. IG advances stories on tap; we
// simulate by clicking the right edge of the viewer.
export async function watchUserStories(username: string, storyDwellSec: number): Promise<{ watched: number }> {
  await navigate(`https://www.instagram.com/stories/${encodeURIComponent(username)}/`);
  await sleep(2500);
  const dwell = Math.max(1, storyDwellSec) * 1000;
  let watched = 0;
  for (let i = 0; i < 5; i++) {
    if (!/\/stories\//.test(location.href)) break;
    await sleep(jitter(dwell, 0.4));
    watched += 1;
    // Click the right edge to advance.
    const x = window.innerWidth - 100;
    const y = Math.floor(window.innerHeight / 2);
    const el = document.elementFromPoint(x, y);
    if (el instanceof HTMLElement) el.click();
    else break;
    await sleep(800);
  }
  return { watched };
}

export async function runInteractions(
  username: string,
  cfg: InteractionsConfig
): Promise<void> {
  if (cfg.watchStories) {
    try {
      await watchUserStories(username, cfg.storyDwellSec);
    } catch (err) {
      console.warn('[b2dm] watchStories failed', err);
    }
    await sleep(jitter(1500));
  }
  if (cfg.follow) {
    try {
      await followUserFlow(username);
    } catch (err) {
      console.warn('[b2dm] follow failed', err);
    }
    await sleep(jitter(2000));
  }
  if (cfg.likeCount > 0) {
    try {
      await likeNPosts(username, cfg.likeCount);
    } catch (err) {
      console.warn('[b2dm] likeNPosts failed', err);
    }
    await sleep(jitter(2000));
  }
}
