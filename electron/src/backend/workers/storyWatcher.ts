// Forked worker: watches stories of a list of usernames. Non-destructive
// (no like, no reply). Emits per-username progress so the UI can show a
// live counter, and a final result with watched / skipped totals.

import {
  isCancelled,
  jitter,
  launchBrowser,
  onInit,
  sendError,
  sendLog,
  sendProgress,
  sendResult,
  waitFor,
  type WindowBounds,
} from './lib';
import { attachDialogDismisser, ensureLoggedIn, viewUserStories } from './ig';
import type { AccountSecrets } from '../accounts';

interface StoryWatcherInit {
  jobId: string;
  secrets: AccountSecrets;
  usernames: string[];
  perUserDwellMs: [min: number, max: number];
  intervalBetweenUsersMs: [min: number, max: number];
  skipIfNoStory: boolean;
  maxStoriesPerUser: number;
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

export interface StoryWatcherResult {
  visited: number;
  watched: number;
  skipped: number;
  totalStoriesViewed: number;
  totalDwellMs: number;
}

onInit<StoryWatcherInit>(async (init) => {
  const { browser, context } = await launchBrowser({
    headless: init.headless,
    secrets: init.secrets,
    windowBounds: init.windowBounds,
    maximizeWindow: init.maximizeWindow,
  });
  const page = await context.newPage();
  const detachDismisser = attachDialogDismisser(page);

  let visited = 0;
  let watched = 0;
  let skipped = 0;
  let totalStoriesViewed = 0;
  let totalDwellMs = 0;

  try {
    await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });
    sendProgress(0, init.usernames.length);

    for (let i = 0; i < init.usernames.length; i++) {
      if (isCancelled()) break;
      const username = init.usernames[i]!;
      visited += 1;
      try {
        const r = await viewUserStories(page, username, {
          perStoryDwellMs: init.perUserDwellMs,
          maxStories: init.maxStoriesPerUser,
        });
        if (!r.hadStories) {
          if (init.skipIfNoStory) {
            skipped += 1;
            sendLog('info', `Skipped @${username} (no story)`);
          }
        } else {
          watched += 1;
          totalStoriesViewed += r.watched;
          totalDwellMs += r.totalDwellMs;
        }
      } catch (err) {
        skipped += 1;
        sendLog(
          'warn',
          `Could not watch stories for @${username}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      sendProgress(i + 1, init.usernames.length, username);

      if (i < init.usernames.length - 1) {
        const [minMs, maxMs] = init.intervalBetweenUsersMs;
        const wait = jitter(Math.floor((minMs + maxMs) / 2), 0.4);
        await waitFor(Math.max(500, wait));
      }
    }

    sendResult({
      visited,
      watched,
      skipped,
      totalStoriesViewed,
      totalDwellMs,
    } satisfies StoryWatcherResult);
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    detachDismisser();
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
});
