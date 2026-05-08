

import { safeGoto, sendLog } from '../lib';
import { RESERVED_PATHS } from './selectors';
import { collectByScrolling, scrollCommentList, scrollDialog } from './scroll';
import { createNetworkTracker, waitForPageReady } from './network';

type Page = any;

export interface LikersResult {
  users: string[];

  partial: boolean;
}

export interface ExtractOpts {
  target?: number;
  onBatch?: (added: string[]) => void;

  shouldStop?: () => boolean;
}

export async function getCommenters(page: Page, postUrl: string, opts: ExtractOpts = {}): Promise<string[]> {
  if (!postUrl) throw new Error('postUrl is required');

  const isReel = /\/reel\//.test(postUrl);
  sendLog('info', `      navigating to ${postUrl} (${isReel ? 'reel' : 'post'})`);
  await safeGoto(page, postUrl);
  await waitForPageReady(page);

  if (isReel) await openReelCommentsPanel(page);

  await dumpPostDom(page, 'comments');

  await clickViewAllComments(page);
  await expandHiddenComments(page);

  const author = await readPostAuthor(page);
  if (author) sendLog('info', `      post author detected: @${author} (will be excluded)`);

  let iteration = 0;
  const tracker = createNetworkTracker(page);
  try {
    return await collectByScrolling<string>({
      target: opts.target,
      shouldStop: opts.shouldStop,

      maxIdleRounds: 3,
      pauseMs: 100,
      onBatch: (added) => {
        sendLog('info', `      +${added.length} commenter(s) (iter ${iteration})`);
        opts.onBatch?.(added);
      },
      scroll: async () => {
        iteration += 1;
        await expandHiddenComments(page);
        await expandReplies(page);
        const target = await scrollCommentList(page);

        const settled = await tracker.waitSettle(1500, 10_000);
        sendLog(
          'info',
          `      iter ${iteration}: scrolled [${target}] network=${settled ? 'quiet' : 'busy'} pending=${tracker.pending()}`
        );
      },
      extract: () => extractPostUsernames(page, author),
    });
  } finally {
    tracker.dispose();
  }
}

async function openReelCommentsPanel(page: Page): Promise<void> {
  const visibleUsernames = (await page
    .evaluate(() => {
      const set = new Set<string>();
      document
        .querySelectorAll<HTMLAnchorElement>('main a, article a')
        .forEach((a) => {
          const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m && m[1]) set.add(m[1]);
        });
      return set.size;
    })
    .catch(() => 0)) as number;

  if (visibleUsernames >= 3) {
    sendLog('info', `      reel uses inline layout (${visibleUsernames} username anchors) — no icon click`);
    return;
  }

  const selectors = [
    'svg[aria-label="Comment"]',
    'svg[aria-label="Comentar"]',
    'svg[aria-label="Comments"]',
    'svg[aria-label="Comentarios"]',
    '[aria-label="Comment"]',
    '[aria-label="Comentar"]',
    '[aria-label="Comments"]',
    '[aria-label="Comentarios"]',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      const n = await loc.count();
      if (n === 0) continue;
      await loc.click({ timeout: 3000 });
      sendLog('info', `      reel comments panel opened via ${sel}`);
      await waitForPageReady(page);
      return;
    } catch {

    }
  }
  sendLog('warn', '      could not find reel comment icon — comments may be empty');
}

export async function getLikers(page: Page, postUrl: string, opts: ExtractOpts = {}): Promise<LikersResult> {
  if (!postUrl) throw new Error('postUrl is required');

  sendLog('info', `      navigating to ${postUrl}`);
  await safeGoto(page, postUrl);
  await waitForPageReady(page);

  const opened = await openLikesModal(page);
  sendLog('info', `      likes modal opened via: ${opened ?? 'none'}`);

  if (opened) {

    await waitForPageReady(page);
    let iteration = 0;
    const tracker = createNetworkTracker(page);
    try {
      const users = await collectByScrolling<string>({
        target: opts.target,
        shouldStop: opts.shouldStop,
        maxIdleRounds: 3,
        pauseMs: 100,
        onBatch: (added) => {
          sendLog('info', `      +${added.length} liker(s) (iter ${iteration})`);
          opts.onBatch?.(added);
        },
        scroll: async () => {
          iteration += 1;
          await scrollDialog(page);
          const settled = await tracker.waitSettle(1500, 10_000);
          sendLog(
            'info',
            `      iter ${iteration}: liker dialog scroll network=${settled ? 'quiet' : 'busy'} pending=${tracker.pending()}`
          );
        },
        extract: () => extractUsernamesFromDialog(page),
      });
      return { users, partial: false };
    } finally {
      tracker.dispose();
    }
  }

  const fallback = await page.evaluate((reserved: string[]) => {
    const set = new Set<string>();
    const root = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
    root.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
      const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (m && m[1] && !reserved.includes(m[1])) set.add(m[1]);
    });
    return Array.from(set);
  }, Array.from(RESERVED_PATHS));

  const capped = opts.target ? fallback.slice(0, opts.target) : fallback;
  if (capped.length > 0) opts.onBatch?.(capped);
  return { users: capped, partial: true };
}

async function openLikesModal(page: Page): Promise<string | null> {

  try {
    const a = page.locator('a[href$="/liked_by/"]').first();
    if ((await a.count()) > 0) {
      await a.click({ timeout: 3000 });
      return 'href';
    }
  } catch {}

  const textCandidates = [
    /\band others\b/i,
    /\by otros\b/i,
    /\bliked by\b/i,
    /\bme gusta de\b/i,
    /^\d+[\d.,KkMm]*\s+likes?$/i,
    /^\d+[\d.,KkMm]*\s+me gusta$/i,
  ];

  try {
    const matched = (await page.evaluate((patterns: string[]) => {
      const regexes = patterns.map((s) => new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1)));
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('main *, article *'));
      for (const node of nodes) {
        const text = (node.textContent ?? '').trim();
        if (!text || text.length > 120) continue;
        if (!regexes.some((re) => re.test(text))) continue;
        let cur: HTMLElement | null = node;
        while (cur) {
          const tag = cur.tagName;
          const role = cur.getAttribute('role');
          if (tag === 'A' || tag === 'BUTTON' || role === 'button' || role === 'link') {
            const r = cur.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
          cur = cur.parentElement;
        }
      }
      return null;
    }, textCandidates.map((re) => re.toString()))) as { x: number; y: number } | null;

    if (matched) {
      await page.mouse.click(matched.x, matched.y);
      return 'text';
    }
  } catch {}

  return null;
}

async function clickViewAllComments(page: Page): Promise<void> {
  const labels = [
    /view all \d+ comments?/i,
    /view all comments/i,
    /ver los \d+ comentarios/i,
    /ver todos los comentarios/i,
    /load more comments/i,
  ];
  try {
    const clickable = await page.evaluate((patterns: string[]) => {
      const regexes = patterns.map((s) => new RegExp(s.slice(1, s.lastIndexOf('/')), s.slice(s.lastIndexOf('/') + 1)));
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], span, div'));
      for (const b of buttons) {
        const text = (b.textContent ?? '').trim();
        if (!text || text.length > 60) continue;
        if (regexes.some((re) => re.test(text))) {
          const r = b.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    }, labels.map((re) => re.toString()));

    if (clickable) {
      await page.mouse.click((clickable as any).x, (clickable as any).y);
      sendLog('info', `      clicked "view all comments"`);
      await waitForPageReady(page);
    }
  } catch {}
}

async function expandHiddenComments(page: Page): Promise<void> {
  const sels = [
    'button:has-text("hidden comments")',
    'button:has-text("View hidden")',
    'button:has-text("comentarios ocultos")',
    '[role="button"]:has-text("hidden comments")',
    '[role="button"]:has-text("View hidden")',
    '[role="button"]:has-text("comentarios ocultos")',
  ];
  for (const sel of sels) {
    try {
      const buttons = page.locator(sel);
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        try { await buttons.nth(i).click({ timeout: 500 }); } catch {}
      }
    } catch {}
  }
}

async function expandReplies(page: Page): Promise<void> {
  const sels = [
    'button:has-text("View replies")',
    'button:has-text("Ver respuestas")',
    'button:has-text("more replies")',
    'button:has-text("más respuestas")',
    '[role="button"]:has-text("View replies")',
    '[role="button"]:has-text("Ver respuestas")',
    '[role="button"]:has-text("more replies")',
    '[role="button"]:has-text("más respuestas")',
  ];
  for (const sel of sels) {
    try {
      const buttons = page.locator(sel);
      const n = await buttons.count();
      for (let i = 0; i < n; i++) {
        try { await buttons.nth(i).click({ timeout: 500 }); } catch {}
      }
    } catch {}
  }
}

async function extractPostUsernames(page: Page, author: string | null): Promise<string[]> {
  return page.evaluate(
    (params: { reserved: string[]; author: string | null }) => {
      const set = new Set<string>();
      const roots = [
        document.querySelector('div[role="dialog"]'),
        document.querySelector('main'),
        document.querySelector('article'),
        document.body,
      ].filter(Boolean) as Element[];
      const root = roots[0];
      root.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
        const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (!m) return;
        const u = m[1];
        if (!u) return;
        if (params.reserved.includes(u)) return;
        if (params.author && u.toLowerCase() === params.author.toLowerCase()) return;
        set.add(u);
      });
      return Array.from(set);
    },
    { reserved: Array.from(RESERVED_PATHS), author }
  );
}

async function extractUsernamesFromDialog(page: Page): Promise<string[]> {
  return page.evaluate((reserved: string[]) => {
    const set = new Set<string>();
    document
      .querySelectorAll<HTMLAnchorElement>('div[role="dialog"] a[role="link"], div[role="dialog"] a')
      .forEach((a) => {
        const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
        if (m && m[1] && !reserved.includes(m[1])) set.add(m[1]);
      });
    return Array.from(set);
  }, Array.from(RESERVED_PATHS));
}

export async function readPostAuthor(page: Page): Promise<string | null> {
  try {
    return (await page.evaluate(() => {

      const header = document.querySelector('header') ?? document.querySelector('article header');
      if (header) {
        const a = header.querySelector<HTMLAnchorElement>('a');
        if (a) {
          const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m) return m[1];
        }
      }

      const main = document.querySelector('main');
      if (main) {
        const anchors = Array.from(main.querySelectorAll<HTMLAnchorElement>('a'));
        for (const a of anchors) {
          const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m) return m[1];
        }
      }
      return null;
    })) as string | null;
  } catch {
    return null;
  }
}

async function dumpPostDom(page: Page, phase: string): Promise<void> {
  try {
    const diag = (await page.evaluate(() => {
      const body = document.body;
      const textSample = (body?.innerText ?? '').slice(0, 400).replace(/\s+/g, ' ');
      return {
        url: location.href,
        title: document.title,
        hasMain: !!document.querySelector('main'),
        hasArticle: !!document.querySelector('article'),
        hasDialog: !!document.querySelector('div[role="dialog"]'),
        mainImgCount: document.querySelectorAll('main img').length,
        allAnchors: document.querySelectorAll('a').length,
        uListRoles: document.querySelectorAll('ul[role="list"]').length,
        sections: document.querySelectorAll('section').length,
        buttonsWithLike: Array.from(document.querySelectorAll('button, [role="button"]'))
          .filter((b) => /like|me gusta|liked|others|otros/i.test(b.textContent ?? ''))
          .slice(0, 3)
          .map((b) => (b.textContent ?? '').trim().slice(0, 60)),
        anchorsLikedBy: document.querySelectorAll('a[href*="liked_by"]').length,
        textSample,
      };
    })) as Record<string, unknown>;
    sendLog('info', `      [dom ${phase}] url=${diag.url}`);
    sendLog(
      'info',
      `      [dom ${phase}] main=${diag.hasMain} article=${diag.hasArticle} dialog=${diag.hasDialog} anchors=${diag.allAnchors} mainImgs=${diag.mainImgCount} ul_list=${diag.uListRoles} sections=${diag.sections} liked_by=${diag.anchorsLikedBy}`
    );
    if (Array.isArray(diag.buttonsWithLike) && diag.buttonsWithLike.length > 0) {
      sendLog('info', `      [dom ${phase}] like-ish buttons: ${(diag.buttonsWithLike as string[]).join(' | ')}`);
    }
    sendLog('info', `      [dom ${phase}] text: ${String(diag.textSample).slice(0, 220)}`);
  } catch (err) {
    sendLog('warn', `      dom dump failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
