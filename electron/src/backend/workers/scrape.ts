// Forked worker: four scrape modes, writing usernames to a CSV file as they
// are collected. Streams progress back to main via process.send().

import fs from 'fs';
import path from 'path';
import { launchBrowser, jitter, onInit, safeGoto, sendError, sendLog, sendProgress, sendResult, waitFor } from './lib';
import type { AccountSecrets } from '../accounts';

type ScrapeKind = 'scrape_by_username' | 'scrape_by_post' | 'scrape_by_hashtag' | 'scrape_by_location';

interface ScrapeInit {
  jobId: string;
  kind: ScrapeKind;
  secrets: AccountSecrets;
  csvPath: string;
  params: Record<string, unknown>;
}

interface CsvSink {
  write(username: string, source: string, sourceRef: string): void;
  count(): number;
  close(): void;
}

function openCsv(csvPath: string): CsvSink {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  const fd = fs.openSync(csvPath, 'w');
  fs.writeSync(fd, 'username,source,source_ref\n');
  const seen = new Set<string>();
  return {
    write(username, source, sourceRef) {
      const key = `${source}:${username}`;
      if (seen.has(key)) return;
      seen.add(key);
      const esc = (s: string) => (s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
      fs.writeSync(fd, `${esc(username)},${esc(source)},${esc(sourceRef)}\n`);
    },
    count() {
      return seen.size;
    },
    close() {
      try { fs.closeSync(fd); } catch {}
    },
  };
}

// Scroll a list modal and yield `username` strings via the callback.
async function scrapeListModal(
  page: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  opts: { onUsername: (u: string) => void; scrollSelector?: string; maxIdleRounds?: number }
): Promise<void> {
  const idleMax = opts.maxIdleRounds ?? 8;
  let lastCount = -1;
  let idle = 0;
  while (idle < idleMax) {
    const usernames = (await page.evaluate(() => {
      const out = new Set<string>();
      document.querySelectorAll('a[href^="/"]').forEach((el) => {
        const href = (el as HTMLAnchorElement).getAttribute('href') || '';
        const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && m[1] && !['explore', 'direct', 'accounts', 'p', 'reel', 'stories', 'tv'].includes(m[1])) {
          out.add(m[1]);
        }
      });
      return Array.from(out);
    })) as string[];

    for (const u of usernames) opts.onUsername(u);

    if (usernames.length === lastCount) {
      idle += 1;
    } else {
      idle = 0;
      lastCount = usernames.length;
    }

    try {
      await page.evaluate(() => {
        const scrollable = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"] *'))
          .find((el) => el.scrollHeight > el.clientHeight + 10);
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
        else window.scrollTo(0, document.body.scrollHeight);
      });
    } catch {}
    await waitFor(1200);
  }
}

async function scrapeByUsername(page: any, params: any, sink: CsvSink): Promise<void> {
  const username = String(params.username || '').replace(/^@+/, '').trim();
  if (!username) throw new Error('Username is required');

  await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(username)}/`);
  await waitFor(2000);

  if (params.collectFollowers) {
    // Open followers modal.
    const link = page.locator(`a[href*="/${username}/followers/"]`).first();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await link.click();
    await waitFor(1500);
    await scrapeListModal(page, {
      onUsername: (u) => {
        sink.write(u, 'followers', `@${username}`);
        sendProgress(sink.count(), undefined, u);
      },
    });
  } else {
    // Walk N posts and collect commenters/likers.
    const postsCount = Math.max(1, Number(params.postsCount) || 10);
    const postLinks = (await page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"]'))
        .map((a) => a.getAttribute('href'))
        .filter(Boolean) as string[];
    })) as string[];

    const picked = Array.from(new Set(postLinks)).slice(0, postsCount);
    for (let i = 0; i < picked.length; i++) {
      const rel = picked[i]!;
      const url = `https://www.instagram.com${rel}`;
      try {
        await safeGoto(page, url);
        await waitFor(1500);
        if (params.collectFromComments !== false) {
          const commenters = (await page.evaluate(() => {
            const out = new Set<string>();
            document.querySelectorAll('ul[role="list"] a[role="link"]').forEach((el) => {
              const href = (el as HTMLAnchorElement).getAttribute('href') || '';
              const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
              if (m && m[1]) out.add(m[1]);
            });
            return Array.from(out);
          })) as string[];
          for (const u of commenters) {
            sink.write(u, 'comment', rel);
            sendProgress(sink.count(), undefined, u);
          }
        }
      } catch (err) {
        sendLog('warn', `Post ${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await waitFor(jitter(2000));
    }
  }
}

async function scrapeByPost(page: any, params: any, sink: CsvSink): Promise<void> {
  const postUrl = String(params.postUrl || '').trim();
  if (!postUrl) throw new Error('Post URL is required');

  await safeGoto(page, postUrl);
  await waitFor(2000);

  const commenters = (await page.evaluate(() => {
    const out = new Set<string>();
    document.querySelectorAll('ul[role="list"] a[role="link"]').forEach((el) => {
      const href = (el as HTMLAnchorElement).getAttribute('href') || '';
      const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (m && m[1]) out.add(m[1]);
    });
    return Array.from(out);
  })) as string[];

  for (const u of commenters) {
    sink.write(u, 'comment', postUrl);
    sendProgress(sink.count(), undefined, u);
  }
}

async function scrapeByHashtag(page: any, params: any, sink: CsvSink): Promise<void> {
  const hashtag = String(params.hashtag || '').replace(/^#/, '').trim();
  if (!hashtag) throw new Error('Hashtag is required');
  const postsToCheck = Math.max(1, Number(params.postsToCheck) || 20);

  await safeGoto(page, `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtag)}/`);
  await waitFor(2000);

  const postLinks = (await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean) as string[];
  })) as string[];

  const picked = Array.from(new Set(postLinks)).slice(0, postsToCheck);
  for (let i = 0; i < picked.length; i++) {
    const rel = picked[i]!;
    try {
      await safeGoto(page, `https://www.instagram.com${rel}`);
      await waitFor(1500);
      const commenters = (await page.evaluate(() => {
        const out = new Set<string>();
        document.querySelectorAll('ul[role="list"] a[role="link"]').forEach((el) => {
          const href = (el as HTMLAnchorElement).getAttribute('href') || '';
          const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m && m[1]) out.add(m[1]);
        });
        return Array.from(out);
      })) as string[];
      for (const u of commenters) {
        sink.write(u, 'hashtag_comment', `#${hashtag}`);
        sendProgress(sink.count(), undefined, u);
      }
    } catch (err) {
      sendLog('warn', `Hashtag post ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await waitFor(jitter(2000));
  }
}

async function scrapeByLocation(page: any, params: any, sink: CsvSink): Promise<void> {
  const raw = String(params.locationUrl || params.locationSlug || '').trim();
  if (!raw) throw new Error('Location URL or slug is required');
  const url = raw.startsWith('http')
    ? raw
    : `https://www.instagram.com/explore/locations/${raw}/`;

  const postsToCheck = Math.max(1, Number(params.postsToCheck) || 20);
  await safeGoto(page, url);
  await waitFor(2000);

  const postLinks = (await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean) as string[];
  })) as string[];

  const picked = Array.from(new Set(postLinks)).slice(0, postsToCheck);
  for (let i = 0; i < picked.length; i++) {
    const rel = picked[i]!;
    try {
      await safeGoto(page, `https://www.instagram.com${rel}`);
      await waitFor(1500);
      const commenters = (await page.evaluate(() => {
        const out = new Set<string>();
        document.querySelectorAll('ul[role="list"] a[role="link"]').forEach((el) => {
          const href = (el as HTMLAnchorElement).getAttribute('href') || '';
          const m = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m && m[1]) out.add(m[1]);
        });
        return Array.from(out);
      })) as string[];
      for (const u of commenters) {
        sink.write(u, 'location_comment', url);
        sendProgress(sink.count(), undefined, u);
      }
    } catch (err) {
      sendLog('warn', `Location post ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await waitFor(jitter(2000));
  }
}

onInit<ScrapeInit>(async (init) => {
  const sink = openCsv(init.csvPath);
  const { browser, context } = await launchBrowser({ headless: false, secrets: init.secrets });
  const page = await context.newPage();
  sendProgress(0);

  try {
    switch (init.kind) {
      case 'scrape_by_username':
        await scrapeByUsername(page, init.params, sink);
        break;
      case 'scrape_by_post':
        await scrapeByPost(page, init.params, sink);
        break;
      case 'scrape_by_hashtag':
        await scrapeByHashtag(page, init.params, sink);
        break;
      case 'scrape_by_location':
        await scrapeByLocation(page, init.params, sink);
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
