// Story-watching primitives. Non-destructive — we never reply, like or send.
// Used by the Cold DM worker for the optional per-recipient story view.

import { jitter, safeGoto, waitFor } from '../lib';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface UserStoriesOpts {
  // Either cap by total time on the user's stories, or by per-story dwell.
  // When both are set, the function honours whichever runs out first.
  totalDurationMs?: number;
  perStoryDwellMs?: [min: number, max: number];
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

  const startedAt = Date.now();
  const deadline =
    typeof opts.totalDurationMs === 'number' && opts.totalDurationMs > 0
      ? startedAt + opts.totalDurationMs
      : Number.POSITIVE_INFINITY;
  const cap = Math.max(1, Math.min(30, opts.maxStories ?? 30));
  const [minMs, maxMs] = opts.perStoryDwellMs ?? [3000, 5000];

  let watched = 0;
  let totalDwellMs = 0;

  while (watched < cap && Date.now() < deadline) {
    const baseline = Math.floor((minMs + maxMs) / 2);
    const dwell = jitter(baseline, 0.4);
    const remaining = deadline - Date.now();
    const waitMs = Math.max(800, Math.min(dwell, remaining));
    await waitFor(waitMs);
    totalDwellMs += waitMs;
    watched += 1;
    if (Date.now() >= deadline) break;
    try {
      await page.keyboard.press('ArrowRight');
    } catch {
      break;
    }
    await waitFor(300);
    if (!page.url().includes('/stories/')) break;
  }

  try { await page.keyboard.press('Escape'); } catch {}
  await waitFor(500);

  return { watched, totalDwellMs, hadStories: true };
}
