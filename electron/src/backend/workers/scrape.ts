// Forked worker: runs one of four scrape modes, composing the primitives
// from ./ig/. Writes usernames to a CSV (one row per unique username per
// job) while streaming progress back to main via process.send(). The main
// process ingests the CSV into the `leads` table on completion if the job
// was tagged with a categoryId.

import fs from 'fs';
import path from 'path';
import { isCancelled, launchBrowser, jitter, onInit, sendError, sendLog, sendProgress, sendResult, waitFor } from './lib';
import {
  ensureLoggedIn,
  getCommenters,
  getFollowers,
  getLikers,
  getPostLinks,
  getReelLinks,
  postsByHashtag,
  postsByLocation,
} from './ig';
import type { AccountSecrets } from '../accounts';

type ScrapeKind =
  | 'scrape_by_username'
  | 'scrape_by_post'
  | 'scrape_by_hashtag'
  | 'scrape_by_location';

interface ScrapeInit {
  jobId: string;
  kind: ScrapeKind;
  secrets: AccountSecrets;
  csvPath: string;
  params: Record<string, unknown>;
  headless: boolean;
}

interface CsvSink {
  /** Write a (deduped) username row. Returns true if the username was new. */
  write(username: string, sourceDetail: string): boolean;
  count(): number;
  close(): void;
}

// Job-scoped dedup: one row per unique username per scrape, regardless of
// how many sub-sources (followers / likers / commenters) mention it.
function openCsv(csvPath: string): CsvSink {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const fd = fs.openSync(csvPath, 'w');
  fs.writeSync(fd, 'username,source,source_ref\n');
  const seen = new Set<string>();
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return {
    write(username, sourceDetail) {
      if (seen.has(username)) return false;
      seen.add(username);
      // Split sourceDetail on the first " | " — first half is category-ish
      // ("followers", "post_comment"), second half is the ref URL.
      const sep = sourceDetail.indexOf(' | ');
      const source = sep >= 0 ? sourceDetail.slice(0, sep) : sourceDetail;
      const ref = sep >= 0 ? sourceDetail.slice(sep + 3) : '';
      fs.writeSync(fd, `${esc(username)},${esc(source)},${esc(ref)}\n`);
      return true;
    },
    count() {
      return seen.size;
    },
    close() {
      try { fs.closeSync(fd); } catch {}
    },
  };
}

async function runByUsername(page: any, params: any, sink: CsvSink): Promise<void> {
  const username = String(params.username ?? '').replace(/^@+/, '').trim();
  if (!username) throw new Error('username is required');

  const max: number | undefined = typeof params.max === 'number' && params.max > 0 ? params.max : undefined;
  const hitCap = () => (max ? sink.count() >= max : false);
  const shouldStop = () => hitCap() || isCancelled();

  // ─── Phase 1: followers ────────────────────────────────────────────────
  sendLog('info', `[1/3] Collecting followers of @${username}`);
  await getFollowers(page, username, {
    max,
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `followers | @${username}`)) sendProgress(sink.count(), max, u);
        if (shouldStop()) return;
      }
    },
  });
  sendLog('info', `[1/3] Followers done. Leads so far: ${sink.count()}${max ? `/${max}` : ''}`);
  if (shouldStop()) return;

  // ─── Phase 2 & 3: interleaved post/reel walking, lazy-enumerated ─────
  // We ask IG for just `position + 1` URLs each time we need the next
  // post/reel. collectByScrolling stops as soon as the cap is met, so
  // positions that are already in the initial DOM grid (typically the
  // first ~12) require zero scrolling; later positions trigger one
  // scroll per uncovered batch.
  let postLinks: string[] = [];
  let reelLinks: string[] = [];
  let postIdx = 0;
  let reelIdx = 0;
  let round = 0;
  let postsExhausted = false;
  let reelsExhausted = false;

  sendLog('info', `[2/3] Walking posts & reels interleaved (cap: ${max ?? 'none'})`);

  while (!postsExhausted || !reelsExhausted) {
    round += 1;
    if (shouldStop()) return;

    // ─── Post at current index ─────────────────────────────────────────
    if (postIdx >= postLinks.length && !postsExhausted) {
      sendLog('info', `[2/3] Need post #${postIdx + 1} — enumerating up to ${postIdx + 1}`);
      const refreshed = (await getPostLinks(page, username, postIdx + 1)).links;
      if (refreshed.length > postLinks.length) {
        postLinks = refreshed;
      } else {
        postsExhausted = true;
        sendLog('info', `[2/3] No more posts available (had ${postLinks.length})`);
      }
    }

    const postUrl = postLinks[postIdx];
    if (postUrl) {
      sendLog('info', `[3/3] → Post #${postIdx + 1} (round ${round}): ${postUrl}`);
      await walkEngagement(page, postUrl, 'post', sink, max);
      sendLog('info', `[3/3] ← Post #${postIdx + 1} done. Leads: ${sink.count()}${max ? `/${max}` : ''}`);
      postIdx += 1;
      if (shouldStop()) return;
      await waitFor(jitter(1500));
    }

    if (shouldStop()) return;

    // ─── Reel at current index ─────────────────────────────────────────
    if (reelIdx >= reelLinks.length && !reelsExhausted) {
      sendLog('info', `[2/3] Need reel #${reelIdx + 1} — enumerating up to ${reelIdx + 1}`);
      const refreshed = (await getReelLinks(page, username, reelIdx + 1)).links;
      if (refreshed.length > reelLinks.length) {
        reelLinks = refreshed;
      } else {
        reelsExhausted = true;
        sendLog('info', `[2/3] No more reels available (had ${reelLinks.length})`);
      }
    }

    const reelUrl = reelLinks[reelIdx];
    if (reelUrl) {
      sendLog('info', `[3/3] → Reel #${reelIdx + 1} (round ${round}): ${reelUrl}`);
      await walkEngagement(page, reelUrl, 'reel', sink, max);
      sendLog('info', `[3/3] ← Reel #${reelIdx + 1} done. Leads: ${sink.count()}${max ? `/${max}` : ''}`);
      reelIdx += 1;
      if (shouldStop()) return;
      await waitFor(jitter(1500));
    }

    // Nothing walked this round — both sides exhausted.
    if (!postUrl && !reelUrl) break;
  }

  sendLog('info', `[done] Total leads: ${sink.count()}`);
}

// Extract commenters + likers from a single post/reel, streaming each batch
// into the sink and short-circuiting when the global `max` cap is reached.
async function walkEngagement(
  page: any,
  url: string,
  kindPrefix: 'post' | 'reel',
  sink: CsvSink,
  max: number | undefined
): Promise<void> {
  const shouldStop = () => (max ? sink.count() >= max : false) || isCancelled();
  const startCount = sink.count();

  sendLog('info', `    ↳ commenters of ${url}`);
  try {
    await getCommenters(page, url, {
      onBatch: (batch) => {
        for (const u of batch) {
          if (sink.write(u, `${kindPrefix}_comment | ${url}`)) sendProgress(sink.count(), max, u);
          if (shouldStop()) return;
        }
      },
    });
    sendLog('info', `    ↳ commenters done (+${sink.count() - startCount})`);
  } catch (err) {
    sendLog('warn', `    ↳ commenters failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (shouldStop()) return;

  const afterComments = sink.count();
  sendLog('info', `    ↳ likers of ${url}`);
  try {
    const result = await getLikers(page, url, {
      onBatch: (batch) => {
        for (const u of batch) {
          if (sink.write(u, `${kindPrefix}_like | ${url}`)) sendProgress(sink.count(), max, u);
          if (shouldStop()) return;
        }
      },
    });
    sendLog('info', `    ↳ likers done (+${sink.count() - afterComments})${result.partial ? ' [partial]' : ''}`);
  } catch (err) {
    sendLog('warn', `    ↳ likers failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runByPost(page: any, params: any, sink: CsvSink): Promise<void> {
  const postUrl = String(params.postUrl ?? '').trim();
  if (!postUrl) throw new Error('postUrl is required');

  const isReel = /\/reel\//.test(postUrl);
  const kindPrefix = isReel ? 'reel' : 'post';

  sendLog('info', `Collecting commenters of ${postUrl}`);
  await getCommenters(page, postUrl, {
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `${kindPrefix}_comment | ${postUrl}`)) {
          sendProgress(sink.count(), undefined, u);
        }
        if (isCancelled()) return;
      }
    },
  });
  if (isCancelled()) return;

  sendLog('info', `Collecting likers of ${postUrl}`);
  const likers = await getLikers(page, postUrl, {
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `${kindPrefix}_like | ${postUrl}`)) {
          sendProgress(sink.count(), undefined, u);
        }
        if (isCancelled()) return;
      }
    },
  });
  if (likers.partial) {
    sendLog('warn', 'Likers list was partial — IG hid the full list for this post');
  }
}

async function runByHashtag(page: any, params: any, sink: CsvSink): Promise<void> {
  const hashtag = String(params.hashtag ?? '').replace(/^#+/, '').trim();
  if (!hashtag) throw new Error('hashtag is required');

  const { from, to, max } = readSearchOpts(params);
  sendLog('info', `Collecting posts for #${hashtag}`);
  const urls = await postsByHashtag(page, hashtag, { from, to, max });
  await walkPosts(page, urls, sink, `hashtag:#${hashtag}`);
}

async function runByLocation(page: any, params: any, sink: CsvSink): Promise<void> {
  const locationInput = String(params.locationUrl ?? params.locationSlug ?? '').trim();
  if (!locationInput) throw new Error('location URL or slug is required');

  const { from, to, max } = readSearchOpts(params);
  sendLog('info', `Collecting posts for location ${locationInput}`);
  const urls = await postsByLocation(page, locationInput, { from, to, max });
  await walkPosts(page, urls, sink, `location:${locationInput}`);
}

function readSearchOpts(params: any): { from?: number; to?: number; max?: number } {
  const out: { from?: number; to?: number; max?: number } = {};
  if (typeof params.from === 'number' && Number.isFinite(params.from)) out.from = params.from;
  if (typeof params.to === 'number' && Number.isFinite(params.to)) out.to = params.to;
  if (typeof params.max === 'number' && params.max > 0) out.max = params.max;
  return out;
}

async function walkPosts(page: any, urls: string[], sink: CsvSink, refTag: string): Promise<void> {
  for (const url of urls) {
    if (isCancelled()) return;
    const isReel = /\/reel\//.test(url);
    const prefix = isReel ? 'reel' : 'post';
    try {
      await getCommenters(page, url, {
        onBatch: (batch) => {
          for (const u of batch) {
            if (sink.write(u, `${prefix}_comment | ${refTag} | ${url}`)) {
              sendProgress(sink.count(), undefined, u);
            }
            if (isCancelled()) return;
          }
        },
      });
      if (isCancelled()) return;
      await getLikers(page, url, {
        onBatch: (batch) => {
          for (const u of batch) {
            if (sink.write(u, `${prefix}_like | ${refTag} | ${url}`)) {
              sendProgress(sink.count(), undefined, u);
            }
            if (isCancelled()) return;
          }
        },
      });
    } catch (err) {
      sendLog('warn', `${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await waitFor(jitter(1800));
  }
}

onInit<ScrapeInit>(async (init) => {
  const sink = openCsv(init.csvPath);
  const { browser, context } = await launchBrowser({ headless: init.headless, secrets: init.secrets });
  const page = await context.newPage();
  sendProgress(0);

  try {
    await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });

    switch (init.kind) {
      case 'scrape_by_username':
        await runByUsername(page, init.params, sink);
        break;
      case 'scrape_by_post':
        await runByPost(page, init.params, sink);
        break;
      case 'scrape_by_hashtag':
        await runByHashtag(page, init.params, sink);
        break;
      case 'scrape_by_location':
        await runByLocation(page, init.params, sink);
        break;
      default:
        throw new Error(`Unknown scrape kind: ${init.kind}`);
    }

    sink.close();
    sendResult({ count: sink.count(), csvPath: init.csvPath });
    await browser.close();
    process.exit(0);
  } catch (err) {
    sink.close();
    sendError(err instanceof Error ? err.message : String(err));
    try { await browser.close(); } catch {}
    process.exit(1);
  }
});
