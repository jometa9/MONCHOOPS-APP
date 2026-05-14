

import { safeGoto, sendLog, waitFor } from '../lib';
import { SELECTORS, RESERVED_PATHS } from './selectors';
import { waitForLocatorReady, waitForPageReady } from './network';
import { collectByScrolling, iterateByScrolling, scrollDialog, scrollWindow } from './scroll';

type Page = any;

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
  await waitForPageReady(page);

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
  await waitForPageReady(page);

  const state = await waitForProfileGrid(page, 'reel');
  sendLog('info', `  [reels] grid state: ${state}`);
  if (state === 'private' || state === 'empty') return;

  await dumpGridDiagnostics(page, 'reel');
  yield* iterateByScrolling<string>({
    scroll: () => scrollWindow(page),
    extract: () => extractMediaLinks(page, 'reel'),
  });
}

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
  target?: number;
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
  await waitForPageReady(page);

  const link = await findFollowersLink(page, clean);
  await link.click();

  const dialog = page.locator('div[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  await waitForPageReady(page);

  return collectByScrolling<string>({
    target: opts.target,
    shouldStop: opts.shouldStop,
    onBatch: opts.onBatch,
    scroll: () => scrollDialog(page),
    extract: () => extractUsernamesFromDialog(page),
  });
}

async function findFollowersLink(page: Page, clean: string): Promise<any> {
  const byText = page
    .locator('a[role="link"], button[role="link"], a, button')
    .filter({ hasText: /\bfollowers\b/i })
    .first();
  try {
    await byText.waitFor({ state: 'visible', timeout: 10_000 });
    sendLog('info', '  [followers] using text-based selector (new IG UI)');
    return byText;
  } catch {}

  const byHref = page.locator(SELECTORS.followersLinkAnchor(clean)).first();
  try {
    await byHref.waitFor({ state: 'visible', timeout: 4000 });
    sendLog('info', '  [followers] using href-based selector (legacy IG UI)');
    return byHref;
  } catch (err) {
    throw new Error(
      `Could not find the "followers" link on @${clean}. ` +
        `Either the session is not logged in, the profile is private, or Instagram changed the UI again. ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`
    );
  }
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
