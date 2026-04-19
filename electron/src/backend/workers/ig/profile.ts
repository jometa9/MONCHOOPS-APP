// Profile-level primitives: enumerate a target user's posts, reels, and
// followers. Each function navigates on its own so callers can compose them
// freely. Post/reel iterators yield URLs lazily as the grid is scrolled.

import { safeGoto, sendLog, waitFor } from '../lib';
import { SELECTORS, RESERVED_PATHS } from './selectors';
import { collectByScrolling, iterateByScrolling, scrollDialog, scrollWindow } from './scroll';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function sanitizeUsername(raw: string): string {
  return raw.replace(/^@+/, '').trim();
}

export async function* iterUserPosts(
  page: Page,
  username: string
): AsyncGenerator<string, void, void> {
  const clean = sanitizeUsername(username);
  if (!clean) throw new Error('username is required');

  sendLog('info', `  [posts] navigating to /${clean}/`);
  await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/`);
  await waitFor(2500);

  const state = await waitForProfileGrid(page, 'post');
  sendLog('info', `  [posts] grid state: ${state}`);
  if (state === 'private' || state === 'empty') return;

  await dumpGridDiagnostics(page, 'p');
  yield* iterateByScrolling<string>({
    scroll: () => scrollWindow(page),
    extract: () => extractMediaLinks(page, 'p'),
  });
}

export async function* iterUserReels(
  page: Page,
  username: string
): AsyncGenerator<string, void, void> {
  const clean = sanitizeUsername(username);
  if (!clean) throw new Error('username is required');

  sendLog('info', `  [reels] navigating to /${clean}/reels/`);
  await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/reels/`);
  await waitFor(2500);

  const state = await waitForProfileGrid(page, 'reel');
  sendLog('info', `  [reels] grid state: ${state}`);
  if (state === 'private' || state === 'empty') return;

  await dumpGridDiagnostics(page, 'reel');
  yield* iterateByScrolling<string>({
    scroll: () => scrollWindow(page),
    extract: () => extractMediaLinks(page, 'reel'),
  });
}

// Robust media-link extractor. Scans every anchor on the page, normalises
// its pathname, and accepts any `/<kind>/<shortcode>/` segment anywhere in
// the path (not just at the start) — IG sometimes namespaces thumbnails
// under the profile path, e.g. `/username/p/ABC/`.
async function extractMediaLinks(page: Page, kind: 'p' | 'reel'): Promise<string[]> {
  return page.evaluate((mediaKind: string) => {
    const set = new Set<string>();
    const re = new RegExp(`/${mediaKind}/([A-Za-z0-9_-]{5,})`);
    document.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
      const m = (a.pathname || '').match(re);
      if (m) set.add(`https://www.instagram.com/${mediaKind}/${m[1]}/`);
    });
    return Array.from(set);
  }, kind);
}

// One-shot diagnostic: dump what the profile DOM actually looks like so we
// can iterate on selectors without asking the user to re-run repeatedly.
async function dumpGridDiagnostics(page: Page, kind: 'p' | 'reel'): Promise<void> {
  try {
    const diag = (await page.evaluate((mediaKind: string) => {
      const all = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
      const withP = all.filter((a) => (a.pathname || '').includes(`/${mediaKind}/`));
      const samplePaths = withP.slice(0, 8).map((a) => a.pathname);
      return {
        totalAnchors: all.length,
        withKindInPath: withP.length,
        hasMain: !!document.querySelector('main'),
        mainImgCount: document.querySelectorAll('main img').length,
        samplePaths,
        url: location.href,
        title: document.title,
      };
    }, kind)) as {
      totalAnchors: number;
      withKindInPath: number;
      hasMain: boolean;
      mainImgCount: number;
      samplePaths: string[];
      url: string;
      title: string;
    };
    sendLog('info', `  [${kind === 'p' ? 'posts' : 'reels'}] DOM dump: url=${diag.url} title=${diag.title}`);
    sendLog(
      'info',
      `  [${kind === 'p' ? 'posts' : 'reels'}] anchors=${diag.totalAnchors} withPath=${diag.withKindInPath} main=${diag.hasMain} mainImgs=${diag.mainImgCount}`
    );
    if (diag.samplePaths.length > 0) {
      sendLog('info', `  [${kind === 'p' ? 'posts' : 'reels'}] sample paths: ${diag.samplePaths.join(' | ')}`);
    }
  } catch (err) {
    sendLog('warn', `  diagnostic dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type GridState = 'ready' | 'empty' | 'private' | 'timeout';

/** Wait until the profile grid has rendered (or IG reported it's private /
 *  empty). Prevents us from scrolling for 7s against an empty DOM because
 *  the page was still hydrating. */
async function waitForProfileGrid(page: Page, kind: 'post' | 'reel'): Promise<GridState> {
  const anchorSel = kind === 'post' ? 'a[href*="/p/"]' : 'a[href*="/reel/"]';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const state = (await page.evaluate((sel: string) => {
      if (document.querySelector(sel)) return 'ready';
      const text = document.body.innerText.toLowerCase();
      if (
        text.includes('this account is private') ||
        text.includes('esta cuenta es privada') ||
        text.includes('cette adresse est privée')
      ) return 'private';
      if (
        text.includes('no posts yet') ||
        text.includes('sin publicaciones') ||
        text.includes('pas encore de publication')
      ) return 'empty';
      return 'loading';
    }, anchorSel)) as GridState | 'loading';
    if (state === 'ready') return 'ready';
    if (state === 'private') {
      sendLog('warn', 'Target profile is private — grid unavailable');
      return 'private';
    }
    if (state === 'empty') {
      sendLog('info', `No ${kind}s on this profile`);
      return 'empty';
    }
    await waitFor(700);
  }
  sendLog('warn', `${kind} grid did not appear within 15s — continuing anyway`);
  return 'timeout';
}

export interface FollowersOpts {
  max?: number;
  onBatch?: (added: string[]) => void;
  shouldStop?: () => boolean;
}

export async function getFollowers(
  page: Page,
  username: string,
  opts: FollowersOpts = {}
): Promise<string[]> {
  const clean = sanitizeUsername(username);
  if (!clean) throw new Error('username is required');

  await safeGoto(page, `https://www.instagram.com/${encodeURIComponent(clean)}/`);
  await waitFor(2500);

  const link = page.locator(SELECTORS.followersLinkAnchor(clean)).first();
  await link.waitFor({ state: 'visible', timeout: 15_000 });
  await link.click();
  await waitFor(2000);

  return collectByScrolling<string>({
    max: opts.max,
    shouldStop: opts.shouldStop,
    onBatch: opts.onBatch,
    scroll: () => scrollDialog(page),
    extract: () => extractUsernamesFromDialog(page),
  });
}

async function extractUsernamesFromDialog(page: Page): Promise<string[]> {
  return page.evaluate((reserved: string[]) => {
    const set = new Set<string>();
    document
      .querySelectorAll<HTMLAnchorElement>('div[role="dialog"] a[role="link"]')
      .forEach((a) => {
        const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && m[1] && !reserved.includes(m[1])) set.add(m[1]);
      });
    return Array.from(set);
  }, Array.from(RESERVED_PATHS));
}
