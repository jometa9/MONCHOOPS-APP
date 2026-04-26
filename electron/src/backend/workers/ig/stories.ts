// Story-watching primitives. Non-destructive — we never reply, like or send.
// Used by the Warmup worker (own-feed stories) and the StoryWatcher worker
// (target users' stories).

import { jitter, safeGoto, waitFor } from '../lib';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface OwnFeedStoriesOpts {
  maxStoryRings: number;
  perStoryDwellMs: [min: number, max: number];
}

export interface OwnFeedStoriesResult {
  rings: number;
  stories: number;
  totalDwellMs: number;
}

export async function viewOwnFeedStories(
  page: Page,
  opts: OwnFeedStoriesOpts
): Promise<OwnFeedStoriesResult> {
  await safeGoto(page, 'https://www.instagram.com/');
  await waitFor(2500);

  // Click the first story ring (avatar tray at top of the feed). IG renders
  // these as <button>s inside an aria-labelled tray. We pick the first one,
  // then advance with the keyboard.
  const tray = page.locator('button:has(canvas), div[role="menu"] button:has(img)').first();
  if (!(await tray.count())) {
    return { rings: 0, stories: 0, totalDwellMs: 0 };
  }
  try {
    await tray.click({ timeout: 8000 });
  } catch {
    return { rings: 0, stories: 0, totalDwellMs: 0 };
  }
  await waitFor(1500);

  let rings = 0;
  let stories = 0;
  let totalDwellMs = 0;
  const maxRings = Math.max(1, Math.min(20, opts.maxStoryRings));
  const [minMs, maxMs] = opts.perStoryDwellMs;

  for (let r = 0; r < maxRings; r++) {
    rings += 1;
    // Each ring may contain multiple stories. We advance with ArrowRight up
    // to a reasonable cap; IG bounces us out after the last story.
    let storiesInRing = 0;
    while (storiesInRing < 8) {
      const dwell = jitter(Math.floor((minMs + maxMs) / 2), 0.4);
      await waitFor(Math.max(800, dwell));
      totalDwellMs += dwell;
      stories += 1;
      storiesInRing += 1;
      try {
        await page.keyboard.press('ArrowRight');
      } catch {
        break;
      }
      await waitFor(300);
      // If the URL bailed out of /stories/, we're done with this ring.
      const url = page.url();
      if (!url.includes('/stories/')) break;
    }
    // After exiting a ring, we either land on the next ring automatically
    // (depends on IG's player) or we stop.
    if (!page.url().includes('/stories/')) break;
  }

  // Best-effort exit: press Escape to close the player so subsequent steps
  // start from a clean slate.
  try { await page.keyboard.press('Escape'); } catch {}
  await waitFor(800);

  return { rings, stories, totalDwellMs };
}

export interface UserStoriesOpts {
  perStoryDwellMs: [min: number, max: number];
  maxStories?: number;
}

export interface UserStoriesResult {
  watched: number;
  totalDwellMs: number;
  hadStories: boolean;
}

export async function viewUserStories(
  page: Page,
  username: string,
  opts: UserStoriesOpts
): Promise<UserStoriesResult> {
  const cleanUsername = username.replace(/^@+/, '').trim();
  if (!cleanUsername) {
    return { watched: 0, totalDwellMs: 0, hadStories: false };
  }
  await safeGoto(page, `https://www.instagram.com/${cleanUsername}/`);
  await waitFor(2500);

  // The profile picture is wrapped in a button when there are unseen / seen
  // stories. We try to click it; if no story exists, IG just opens the
  // profile pic dialog instead of /stories/ — we detect that and bail.
  const pfp = page
    .locator(`a[href^="/stories/${cleanUsername}/"], header img`)
    .first();
  if (!(await pfp.count())) {
    return { watched: 0, totalDwellMs: 0, hadStories: false };
  }
  try {
    await pfp.click({ timeout: 8000 });
  } catch {
    return { watched: 0, totalDwellMs: 0, hadStories: false };
  }
  await waitFor(1500);
  if (!page.url().includes('/stories/')) {
    return { watched: 0, totalDwellMs: 0, hadStories: false };
  }

  let watched = 0;
  let totalDwellMs = 0;
  const cap = Math.max(1, Math.min(30, opts.maxStories ?? 8));
  const [minMs, maxMs] = opts.perStoryDwellMs;

  while (watched < cap) {
    const dwell = jitter(Math.floor((minMs + maxMs) / 2), 0.4);
    await waitFor(Math.max(800, dwell));
    totalDwellMs += dwell;
    watched += 1;
    try {
      await page.keyboard.press('ArrowRight');
    } catch {
      break;
    }
    await waitFor(300);
    if (!page.url().includes('/stories/')) break;
  }

  try { await page.keyboard.press('Escape'); } catch {}
  await waitFor(800);

  return { watched, totalDwellMs, hadStories: true };
}
