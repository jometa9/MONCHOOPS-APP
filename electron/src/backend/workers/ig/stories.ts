

import { jitter, safeGoto, waitFor } from '../lib';
import { confirmViewStoryPrompt } from './dialogs';

type Page = any;

export interface UserStoriesOpts {

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

  for (let i = 0; i < 4; i++) {
    if (!(await confirmViewStoryPrompt(page))) break;
    await waitFor(500);
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
    if (await confirmViewStoryPrompt(page)) {
      await waitFor(500);
    }
  }

  try { await page.keyboard.press('Escape'); } catch {}
  await waitFor(500);

  return { watched, totalDwellMs, hadStories: true };
}
