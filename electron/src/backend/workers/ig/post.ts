// Post / reel primitives: commenters and likers for a single permalink.
// Strategy: IG's standalone /p/ and /reel/ pages in 2026 don't use stable
// selectors (role="list" etc. come and go with A/B tests, and the "Liked
// by" anchor has been removed in many markets since likes became optional
// to hide). So we:
//   1. Dump the post DOM once on entry to make debugging easier.
//   2. Extract commenters by scanning every username anchor in the main
//      content region — broader than a `role="list"` match, still
//      filtering reserved paths and the post author.
//   3. Open the likers modal via multiple fallback strategies: href,
//      aria-label, then text-based clicks on "likes" / "others" / "y otros".

import { safeGoto, sendLog } from '../lib';
import { RESERVED_PATHS } from './selectors';
import { collectByScrolling, scrollCommentList, scrollDialog } from './scroll';
import { createNetworkTracker, waitForPageReady } from './network';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface LikersResult {
  users: string[];
  /** True when IG did not expose a "Liked by" list (common on popular reels
   *  and accounts with hidden like counts). Callers can decide whether to
   *  treat a partial result as an error. */
  partial: boolean;
}

export interface ExtractOpts {
  target?: number;
  onBatch?: (added: string[]) => void;
  /** When it returns true, stop scrolling the comments/likers list right
   *  away — the caller has already hit its global lead cap and further
   *  extraction would be wasted work. */
  shouldStop?: () => boolean;
}

export async function getCommenters(page: Page, postUrl: string, opts: ExtractOpts = {}): Promise<string[]> {
  if (!postUrl) throw new Error('postUrl is required');

  const isReel = /\/reel\//.test(postUrl);
  sendLog('info', `      navigating to ${postUrl} (${isReel ? 'reel' : 'post'})`);
  await safeGoto(page, postUrl);
  await waitForPageReady(page);

  // Reels don't show comments inline — the player sidebar has a comment
  // icon we must click to open the comments panel.
  if (isReel) await openReelCommentsPanel(page);

  await dumpPostDom(page, 'comments');

  // Some layouts need a click on "View all N comments" before any
  // usernames render.
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
      // With the network tracker deciding when to advance, stale-idle
      // counting is a tiebreaker more than a timer. Keep it tight.
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
        // Wait for IG's "load more comments" XHR to land before extracting.
        // Scroll is considered complete once no API call fires for 1.5s.
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

// Reels render in one of two layouts:
//  A) Post-style (comments already visible as a side column) — no action.
//  B) Player-only (comments hidden behind a speech-bubble icon) — we click
//     the icon to open the side panel.
// We detect (A) by counting username anchors already present in main; if
// it looks empty, we fall back to clicking the icon.
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
      // Try next selector.
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
    // Wait for the likers list XHR to land before we start scrolling — an
    // empty dialog would make the scroll loop give up after `maxIdleRounds`.
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

  // Fallback: pull the visible "Liked by X and Y" inline usernames that
  // are rendered below the caption.
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

// Try several strategies to open the likers modal. Returns a label of
// the strategy that worked (for logs) or null.
//
// We deliberately avoid any aria-label match on "like" / "me gusta":
// those also hit the HEART action button (aria-label="Like"), and a stray
// click there would double-tap the post instead of opening the viewer
// list. Only safe, modal-specific signals below.
async function openLikesModal(page: Page): Promise<string | null> {
  // 1) The traditional /liked_by/ anchor.
  try {
    const a = page.locator('a[href$="/liked_by/"]').first();
    if ((await a.count()) > 0) {
      await a.click({ timeout: 3000 });
      return 'href';
    }
  } catch {}

  // 2) Text-based click. These strings only appear in the likers-count
  //    caption, never on the heart icon — safe.
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

// Post-page username extraction: look at every anchor inside the main
// content region. Exclude reserved routes and the post author.
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
      // IG puts the author link near the top of the post header.
      const header = document.querySelector('header') ?? document.querySelector('article header');
      if (header) {
        const a = header.querySelector<HTMLAnchorElement>('a');
        if (a) {
          const m = (a.pathname || '').match(/^\/([A-Za-z0-9._]+)\/?$/);
          if (m) return m[1];
        }
      }
      // Fallback: first anchor in <main> whose pathname looks like /username/.
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

// One-shot diagnostic: dump what the post DOM looks like. Helps us adapt
// selectors without asking for repeated re-runs.
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
