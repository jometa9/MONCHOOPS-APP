

import fs from 'fs';
import path from 'path';
import { isCancelled, launchBrowser, jitter, onInit, sendError, sendLog, sendProgress, sendResult, waitFor, type WindowBounds } from './lib';
import {
  attachDialogDismisser,
  ensureLoggedIn,
  getCommenters,
  getFollowers,
  getLikers,
  gotoHashtagGrid,
  gotoLocationGrid,
  iteratePostsOnGrid,
  iterUserPosts,
  iterUserReels,
  readLocationName,
  readPostAuthor,
} from './ig';
import type { AccountSecrets } from '../accounts';

type Page = any;

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
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

interface CsvSink {

  write(username: string, sourceDetail: string): boolean;
  count(): number;

  atCap(): boolean;
  close(): void;
}

function openCsv(csvPath: string, target: number): CsvSink {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const fd = fs.openSync(csvPath, 'w');
  fs.writeSync(fd, 'username,source,source_ref\n');
  const seen = new Set<string>();
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const atCap = () => seen.size >= target;
  return {
    write(username, sourceDetail) {
      if (atCap()) return false;
      if (seen.has(username)) return false;
      seen.add(username);
      const sep = sourceDetail.indexOf(' | ');
      const source = sep >= 0 ? sourceDetail.slice(0, sep) : sourceDetail;
      const ref = sep >= 0 ? sourceDetail.slice(sep + 3) : '';
      fs.writeSync(fd, `${esc(username)},${esc(source)},${esc(ref)}\n`);
      return true;
    },
    count() {
      return seen.size;
    },
    atCap,
    close() {
      try { fs.closeSync(fd); } catch {}
    },
  };
}

const DEFAULT_TARGET_LEADS = 10_000;

function readTarget(params: any): number {
  return typeof params.target === 'number' && params.target > 0 ? params.target : DEFAULT_TARGET_LEADS;
}

async function runByUsername(
  gridPage: Page,
  postPage: Page,
  params: any,
  sink: CsvSink
): Promise<string> {
  const username = String(params.username ?? '').replace(/^@+/, '').trim();
  if (!username) throw new Error('username is required');

  const target = readTarget(params);
  const shouldStop = () => sink.atCap() || isCancelled();

  sendLog('info', `[1/3] Collecting followers of @${username}`);
  await getFollowers(gridPage, username, {
    target,
    shouldStop,
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `followers | @${username}`)) sendProgress(sink.count(), target, u);
        if (shouldStop()) return;
      }
    },
  });
  sendLog('info', `[1/3] Followers done. Leads so far: ${sink.count()}/${target}`);
  if (shouldStop()) return `@${username}`;

  sendLog('info', `[2/3] Walking posts of @${username}`);
  let postIdx = 0;
  for await (const url of iterUserPosts(gridPage, username)) {
    if (shouldStop()) break;
    postIdx += 1;
    sendLog('info', `[2/3] → Post #${postIdx}: ${url}`);
    await walkEngagement(postPage, url, 'post', sink, target);
    sendLog('info', `[2/3] ← Post #${postIdx} done. Leads: ${sink.count()}/${target}`);
    await waitFor(jitter(1500));
  }
  if (shouldStop()) return `@${username}`;

  sendLog('info', `[3/3] Walking reels of @${username}`);
  let reelIdx = 0;
  for await (const url of iterUserReels(gridPage, username)) {
    if (shouldStop()) break;
    reelIdx += 1;
    sendLog('info', `[3/3] → Reel #${reelIdx}: ${url}`);
    await walkEngagement(postPage, url, 'reel', sink, target);
    sendLog('info', `[3/3] ← Reel #${reelIdx} done. Leads: ${sink.count()}/${target}`);
    await waitFor(jitter(1500));
  }

  sendLog('info', `[done] Total leads: ${sink.count()}`);
  return `@${username}`;
}

async function walkEngagement(
  page: Page,
  url: string,
  kindPrefix: 'post' | 'reel',
  sink: CsvSink,
  target: number
): Promise<void> {
  const shouldStop = () => sink.atCap() || isCancelled();
  const startCount = sink.count();

  sendLog('info', `    ↳ commenters of ${url}`);
  try {
    await getCommenters(page, url, {
      shouldStop,
      onBatch: (batch) => {
        for (const u of batch) {
          if (sink.write(u, `${kindPrefix}_comment | ${url}`)) sendProgress(sink.count(), target, u);
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
      shouldStop,
      onBatch: (batch) => {
        for (const u of batch) {
          if (sink.write(u, `${kindPrefix}_like | ${url}`)) sendProgress(sink.count(), target, u);
          if (shouldStop()) return;
        }
      },
    });
    sendLog('info', `    ↳ likers done (+${sink.count() - afterComments})${result.partial ? ' [partial]' : ''}`);
  } catch (err) {
    sendLog('warn', `    ↳ likers failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runByPost(page: Page, params: any, sink: CsvSink): Promise<string | null> {
  const postUrl = String(params.postUrl ?? '').trim();
  if (!postUrl) throw new Error('postUrl is required');

  const target = readTarget(params);
  const isReel = /\/reel\//.test(postUrl);
  const kindPrefix = isReel ? 'reel' : 'post';
  const shouldStop = () => sink.atCap() || isCancelled();

  sendLog('info', `Collecting commenters of ${postUrl}`);
  await getCommenters(page, postUrl, {
    shouldStop,
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `${kindPrefix}_comment | ${postUrl}`)) {
          sendProgress(sink.count(), target, u);
        }
        if (shouldStop()) return;
      }
    },
  });

  const author = await readPostAuthor(page);
  if (shouldStop()) return author ? `@${author}` : null;

  sendLog('info', `Collecting likers of ${postUrl}`);
  const likers = await getLikers(page, postUrl, {
    shouldStop,
    onBatch: (batch) => {
      for (const u of batch) {
        if (sink.write(u, `${kindPrefix}_like | ${postUrl}`)) {
          sendProgress(sink.count(), target, u);
        }
        if (shouldStop()) return;
      }
    },
  });
  if (likers.partial) {
    sendLog('warn', 'Likers list was partial — IG hid the full list for this post');
  }
  return author ? `@${author}` : null;
}

async function runByHashtag(
  gridPage: Page,
  postPage: Page,
  params: any,
  sink: CsvSink
): Promise<string> {
  const hashtag = String(params.hashtag ?? '').replace(/^#+/, '').trim();
  if (!hashtag) throw new Error('hashtag is required');

  const target = readTarget(params);
  sendLog('info', `Walking #${hashtag} (target: ${target} leads)`);
  await gotoHashtagGrid(gridPage, hashtag);
  await walkGrid(
    iteratePostsOnGrid(gridPage),
    postPage,
    sink,
    `hashtag:#${hashtag}`,
    target
  );
  return `#${hashtag}`;
}

async function runByLocation(
  gridPage: Page,
  postPage: Page,
  params: any,
  sink: CsvSink
): Promise<string | null> {
  const locationInput = String(params.locationUrl ?? params.locationSlug ?? '').trim();
  if (!locationInput) throw new Error('location URL or slug is required');

  const target = readTarget(params);
  sendLog('info', `Walking location ${locationInput} (recent) (target: ${target} leads)`);
  await gotoLocationGrid(gridPage, locationInput, { recent: true });
  const locationName = await readLocationName(gridPage);
  if (locationName) sendLog('info', `Location resolved as "${locationName}"`);
  await walkGrid(
    iteratePostsOnGrid(gridPage),
    postPage,
    sink,
    `location:${locationInput}`,
    target
  );
  return locationName;
}

async function walkGrid(
  urls: AsyncIterable<string>,
  postPage: Page,
  sink: CsvSink,
  refTag: string,
  target: number
): Promise<void> {
  const shouldStop = () => sink.atCap() || isCancelled();
  let idx = 0;

  for await (const url of urls) {
    if (shouldStop()) break;
    idx += 1;
    const isReel = /\/reel\//.test(url);
    const prefix = isReel ? 'reel' : 'post';
    sendLog('info', `→ #${idx} ${url}`);
    try {
      await getCommenters(postPage, url, {
        shouldStop,
        onBatch: (batch) => {
          for (const u of batch) {
            if (sink.write(u, `${prefix}_comment | ${refTag} | ${url}`)) {
              sendProgress(sink.count(), target, u);
            }
            if (shouldStop()) return;
          }
        },
      });
      if (shouldStop()) break;
      await getLikers(postPage, url, {
        shouldStop,
        onBatch: (batch) => {
          for (const u of batch) {
            if (sink.write(u, `${prefix}_like | ${refTag} | ${url}`)) {
              sendProgress(sink.count(), target, u);
            }
            if (shouldStop()) return;
          }
        },
      });
    } catch (err) {
      sendLog('warn', `${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
    sendLog('info', `← #${idx} done. Leads: ${sink.count()}/${target}`);
    await waitFor(jitter(1800));
  }
}

onInit<ScrapeInit>(async (init) => {
  const sink = openCsv(init.csvPath, readTarget(init.params));
  const { browser, context } = await launchBrowser({ headless: init.headless, secrets: init.secrets, windowBounds: init.windowBounds, maximizeWindow: init.maximizeWindow });
  const gridPage = await context.newPage();
  const postPage = await context.newPage();
  const detachGrid = attachDialogDismisser(gridPage);
  const detachPost = attachDialogDismisser(postPage);
  sendProgress(0);

  try {
    await ensureLoggedIn(gridPage, { captchaTimeoutMs: 5 * 60_000 });

    let targetName: string | null = null;
    switch (init.kind) {
      case 'scrape_by_username':
        targetName = await runByUsername(gridPage, postPage, init.params, sink);
        break;
      case 'scrape_by_post':
        targetName = await runByPost(postPage, init.params, sink);
        break;
      case 'scrape_by_hashtag':
        targetName = await runByHashtag(gridPage, postPage, init.params, sink);
        break;
      case 'scrape_by_location':
        targetName = await runByLocation(gridPage, postPage, init.params, sink);
        break;
      default:
        throw new Error(`Unknown scrape kind: ${init.kind}`);
    }

    sink.close();
    sendResult({ count: sink.count(), csvPath: init.csvPath, targetName });
    detachGrid();
    detachPost();
    await browser.close();
    process.exit(0);
  } catch (err) {
    sink.close();
    sendError(err instanceof Error ? err.message : String(err));
    detachGrid();
    detachPost();
    try { await browser.close(); } catch {}
    process.exit(1);
  }
});
