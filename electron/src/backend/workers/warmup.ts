// Forked worker: runs one warmup action against a single account. The
// main process picks the action shape in jobs.ts and forwards it in the
// init payload. Each action composes primitives from ./ig/interactions
// and reports per-step progress back to main via sendProgress(done,total).

import {
  isCancelled,
  launchBrowser,
  onInit,
  sendError,
  sendLog,
  sendProgress,
  sendResult,
  type WindowBounds,
} from './lib';
import {
  attachDialogDismisser,
  ensureLoggedIn,
  iterHashtagAndAct,
  iterLocationAndAct,
  viewExplore,
  viewFeed,
  viewReels,
} from './ig';
import type { AccountSecrets } from '../accounts';

export type WarmupAction =
  | { type: 'view_feed'; durationSec: number }
  | { type: 'view_explore'; durationSec: number }
  | { type: 'view_reels'; durationSec: number }
  | { type: 'hashtag_like'; hashtag: string; count: number }
  | { type: 'hashtag_follow'; hashtag: string; count: number }
  | { type: 'location_like'; location: string; count: number }
  | { type: 'location_follow'; location: string; count: number }
  | {
      type: 'combo';
      feedSec: number;
      exploreSec: number;
      reelsSec: number;
      hashtag: string | null;
      location: string | null;
      likeCount: number;
      followCount: number;
    };

interface WarmupInit {
  jobId: string;
  secrets: AccountSecrets;
  action: WarmupAction;
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

export interface WarmupResult {
  action: WarmupAction['type'];
  visited?: number;
  liked?: number;
  followed?: number;
  skipped?: number;
  failed?: number;
  viewedMs?: number;
}

onInit<WarmupInit>(async (init) => {
  const { browser, context } = await launchBrowser({
    headless: init.headless,
    secrets: init.secrets,
    windowBounds: init.windowBounds,
    maximizeWindow: init.maximizeWindow,
  });
  const page = await context.newPage();
  const detachDismisser = attachDialogDismisser(page);

  try {
    await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });
    sendProgress(0);

    const result = await runAction(page, init.action);

    sendResult(result);
    detachDismisser();
    await browser.close();
    process.exit(0);
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
    detachDismisser();
    try { await browser.close(); } catch {}
    process.exit(1);
  }
});

async function runAction(page: any, action: WarmupAction): Promise<WarmupResult> {
  switch (action.type) {
    case 'view_feed': {
      const ms = Math.max(10, action.durationSec) * 1000;
      sendLog('info', `Browsing feed for ${action.durationSec}s`);
      sendProgress(0, 1);
      await viewFeed(page, ms);
      sendProgress(1, 1);
      return { action: 'view_feed', viewedMs: ms };
    }
    case 'view_explore': {
      const ms = Math.max(10, action.durationSec) * 1000;
      sendLog('info', `Browsing explore for ${action.durationSec}s`);
      sendProgress(0, 1);
      await viewExplore(page, ms);
      sendProgress(1, 1);
      return { action: 'view_explore', viewedMs: ms };
    }
    case 'view_reels': {
      const ms = Math.max(10, action.durationSec) * 1000;
      sendLog('info', `Browsing reels for ${action.durationSec}s`);
      sendProgress(0, 1);
      await viewReels(page, ms);
      sendProgress(1, 1);
      return { action: 'view_reels', viewedMs: ms };
    }
    case 'hashtag_like': {
      const count = Math.max(1, action.count);
      sendLog('info', `Liking ${count} posts from #${action.hashtag}`);
      sendProgress(0, count);
      const r = await iterHashtagAndAct(page, action.hashtag, {
        like: true,
        count,
        onStep: (t) => sendProgress(t.liked, count),
      });
      sendProgress(r.liked, count);
      return { action: 'hashtag_like', ...r };
    }
    case 'hashtag_follow': {
      const count = Math.max(1, action.count);
      sendLog('info', `Following ${count} authors from #${action.hashtag}`);
      sendProgress(0, count);
      const r = await iterHashtagAndAct(page, action.hashtag, {
        follow: true,
        count,
        onStep: (t) => sendProgress(t.followed, count),
      });
      sendProgress(r.followed, count);
      return { action: 'hashtag_follow', ...r };
    }
    case 'location_like': {
      const count = Math.max(1, action.count);
      sendLog('info', `Liking ${count} posts from location ${action.location}`);
      sendProgress(0, count);
      const r = await iterLocationAndAct(page, action.location, {
        like: true,
        count,
        onStep: (t) => sendProgress(t.liked, count),
      });
      sendProgress(r.liked, count);
      return { action: 'location_like', ...r };
    }
    case 'location_follow': {
      const count = Math.max(1, action.count);
      sendLog('info', `Following ${count} authors from location ${action.location}`);
      sendProgress(0, count);
      const r = await iterLocationAndAct(page, action.location, {
        follow: true,
        count,
        onStep: (t) => sendProgress(t.followed, count),
      });
      sendProgress(r.followed, count);
      return { action: 'location_follow', ...r };
    }
    case 'combo': {
      // Sequence a realistic warmup: browse feed → explore → reels → like +
      // follow on the enabled sources (hashtag and/or location). The UI
      // provides total seconds and total counts; we split here across
      // enabled phases/sources.
      const feedMs = Math.max(0, action.feedSec) * 1000;
      const exploreMs = Math.max(0, action.exploreSec) * 1000;
      const reelsMs = Math.max(0, action.reelsSec) * 1000;

      const hashtag = action.hashtag;
      const location = action.location;
      const bothSources = !!hashtag && !!location;
      const hashtagLikes = hashtag
        ? bothSources
          ? Math.ceil(action.likeCount / 2)
          : action.likeCount
        : 0;
      const locationLikes = location
        ? bothSources
          ? Math.floor(action.likeCount / 2)
          : action.likeCount
        : 0;
      const hashtagFollows = hashtag
        ? bothSources
          ? Math.ceil(action.followCount / 2)
          : action.followCount
        : 0;
      const locationFollows = location
        ? bothSources
          ? Math.floor(action.followCount / 2)
          : action.followCount
        : 0;

      const totalSteps =
        (feedMs > 0 ? 1 : 0) +
        (exploreMs > 0 ? 1 : 0) +
        (reelsMs > 0 ? 1 : 0) +
        (hashtagLikes > 0 ? 1 : 0) +
        (locationLikes > 0 ? 1 : 0) +
        (hashtagFollows > 0 ? 1 : 0) +
        (locationFollows > 0 ? 1 : 0);
      let step = 0;
      sendProgress(step, totalSteps);

      let totalLiked = 0;
      let totalFollowed = 0;
      let totalSkipped = 0;
      let totalFailed = 0;
      let totalVisited = 0;

      if (feedMs > 0 && !isCancelled()) {
        sendLog('info', `[combo] Browsing feed for ${action.feedSec}s`);
        await viewFeed(page, feedMs);
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (exploreMs > 0 && !isCancelled()) {
        sendLog('info', `[combo] Browsing explore for ${action.exploreSec}s`);
        await viewExplore(page, exploreMs);
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (reelsMs > 0 && !isCancelled()) {
        sendLog('info', `[combo] Browsing reels for ${action.reelsSec}s`);
        await viewReels(page, reelsMs);
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (hashtagLikes > 0 && hashtag && !isCancelled()) {
        sendLog('info', `[combo] Liking ${hashtagLikes} posts from #${hashtag}`);
        const r = await iterHashtagAndAct(page, hashtag, {
          like: true,
          count: hashtagLikes,
        });
        totalLiked += r.liked;
        totalSkipped += r.skipped;
        totalFailed += r.failed;
        totalVisited += r.visited;
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (locationLikes > 0 && location && !isCancelled()) {
        sendLog('info', `[combo] Liking ${locationLikes} posts from location`);
        const r = await iterLocationAndAct(page, location, {
          like: true,
          count: locationLikes,
        });
        totalLiked += r.liked;
        totalSkipped += r.skipped;
        totalFailed += r.failed;
        totalVisited += r.visited;
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (hashtagFollows > 0 && hashtag && !isCancelled()) {
        sendLog('info', `[combo] Following ${hashtagFollows} authors from #${hashtag}`);
        const r = await iterHashtagAndAct(page, hashtag, {
          follow: true,
          count: hashtagFollows,
        });
        totalFollowed += r.followed;
        totalSkipped += r.skipped;
        totalFailed += r.failed;
        totalVisited += r.visited;
        step += 1;
        sendProgress(step, totalSteps);
      }
      if (locationFollows > 0 && location && !isCancelled()) {
        sendLog('info', `[combo] Following ${locationFollows} authors from location`);
        const r = await iterLocationAndAct(page, location, {
          follow: true,
          count: locationFollows,
        });
        totalFollowed += r.followed;
        totalSkipped += r.skipped;
        totalFailed += r.failed;
        totalVisited += r.visited;
        step += 1;
        sendProgress(step, totalSteps);
      }

      return {
        action: 'combo',
        visited: totalVisited,
        liked: totalLiked,
        followed: totalFollowed,
        skipped: totalSkipped,
        failed: totalFailed,
      };
    }
  }
}
