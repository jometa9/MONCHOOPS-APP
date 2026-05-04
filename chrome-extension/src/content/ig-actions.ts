// Atomic IG operations callable from the service worker.
//
// Each function in here MUST complete before any navigation happens — the
// SW drives all navigation via chrome.tabs.update. If a primitive needs to
// land on a different URL it returns first; the SW navigates and then calls
// the next primitive on the new page.

import {
  clickFollowButton,
  clickLikeButton,
  confirmFollowAnywayIfPrompted,
  detectFollowState as detectFollowStateImpl,
  detectLikeState as detectLikeStateImpl,
  dismissIgPrompts,
  findComposer,
  humanType,
  jitter,
  pressEnter,
  sleep,
  threadContainsMessage,
  waitFor,
  waitForVisible,
} from './ig-dom';

export type FollowState = ReturnType<typeof detectFollowStateImpl>;
export type LikeState = ReturnType<typeof detectLikeStateImpl>;

export function getUrl(): string {
  return location.href;
}

export function dismissPrompts(): void {
  dismissIgPrompts();
}

export function isOnStories(): boolean {
  return /\/stories\//.test(location.href);
}

// "Watch" one frame of a story: dwell for the configured time, then click
// the right edge to advance. Returns whether IG kept us on /stories/ — if
// false, the user is out of stories (or never had any).
export async function dwellOneStoryFrame(dwellMs: number): Promise<{ stillOnStories: boolean }> {
  if (!isOnStories()) return { stillOnStories: false };
  await sleep(jitter(Math.max(500, dwellMs), 0.3));
  if (!isOnStories()) return { stillOnStories: false };
  const x = window.innerWidth - 100;
  const y = Math.floor(window.innerHeight / 2);
  const el = document.elementFromPoint(x, y);
  if (el instanceof HTMLElement) el.click();
  await sleep(800);
  return { stillOnStories: isOnStories() };
}

export function detectFollowState(): FollowState {
  return detectFollowStateImpl();
}

// One follow attempt: click the button + confirm "Follow anyway" if IG
// pops the guard. Does not poll for state changes — the SW will re-call
// detectFollowState a moment later to see if it stuck.
export async function clickFollow(): Promise<{ clicked: boolean }> {
  const clicked = clickFollowButton();
  if (!clicked) return { clicked: false };
  for (let i = 0; i < 4; i++) {
    if (confirmFollowAnywayIfPrompted()) break;
    await sleep(400);
  }
  return { clicked: true };
}

export function findPostUrls(n: number): string[] {
  if (n <= 0) return [];
  const links = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('main a[href*="/p/"], main a[href*="/reel/"]')
  );
  return Array.from(
    new Set(links.map((a) => a.href).filter((h) => /\/(p|reel)\//.test(h)))
  ).slice(0, n);
}

export function detectLikeState(): LikeState {
  return detectLikeStateImpl();
}

// One like attempt: click + brief settle. The SW can re-check state.
export async function clickLike(): Promise<{ clicked: boolean }> {
  const clicked = clickLikeButton();
  if (!clicked) return { clicked: false };
  await sleep(jitter(1500));
  return { clicked: true };
}

export async function waitForComposer(timeoutMs: number): Promise<{ found: boolean }> {
  try {
    await findComposer(timeoutMs);
    return { found: true };
  } catch {
    return { found: false };
  }
}

export async function openNewDmDialog(): Promise<{ ok: boolean }> {
  const labels = ['New message', 'Mensaje nuevo', 'Nuevo mensaje'];
  const btn = await waitFor<HTMLElement>(() => {
    for (const label of labels) {
      const svg = document.querySelector<HTMLElement>(`svg[aria-label="${label}"]`);
      if (!svg) continue;
      let cur: HTMLElement | null = svg;
      while (cur) {
        if (cur.getAttribute('role') === 'button' || cur.tagName === 'BUTTON') return cur;
        cur = cur.parentElement;
      }
    }
    return null;
  }, { timeoutMs: 15_000 }).catch(() => null);
  if (!btn) return { ok: false };
  btn.click();
  await waitForVisible('div[role="dialog"]', { timeoutMs: 20_000 }).catch(() => null);
  return { ok: true };
}

export async function pickFirstSearchResult(username: string): Promise<{ ok: boolean }> {
  const dialog = await waitForVisible('div[role="dialog"]', { timeoutMs: 10_000 }).catch(() => null);
  if (!dialog) return { ok: false };
  const search = await waitFor<HTMLInputElement>(
    () => dialog.querySelector<HTMLInputElement>('input[type="text"], input:not([type])'),
    { timeoutMs: 10_000 }
  ).catch(() => null);
  if (!search) return { ok: false };
  search.focus();
  await humanType(search, username);
  await sleep(jitter(900));

  const firstRow = await waitFor<HTMLElement>(
    () =>
      dialog.querySelector<HTMLElement>(
        'div[role="listbox"] [role="option"], label:has(input[type="checkbox"]), div[role="button"]:has(input[type="checkbox"])'
      ),
    { timeoutMs: 8_000 }
  ).catch(() => null);
  if (!firstRow) return { ok: false };
  firstRow.click();
  await sleep(jitter(700));

  const chatBtn = await waitFor<HTMLElement>(() => {
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')
    );
    return buttons.find((b) => /^(Chat|Chatear)$/.test((b.textContent ?? '').trim())) ?? null;
  }, { timeoutMs: 10_000 }).catch(() => null);
  if (!chatBtn) return { ok: false };
  chatBtn.click();
  return { ok: true };
}

// Type the message into the composer and press Enter. No navigation, no
// reload — verification happens later via a SW-driven reload + threadContains.
export async function typeAndSendDm(message: string): Promise<{ ok: boolean }> {
  const composer = await findComposer(15_000).catch(() => null);
  if (!composer) return { ok: false };
  composer.click();
  await sleep(jitter(400));
  await humanType(composer, message);
  await sleep(jitter(1200));
  pressEnter(composer);
  await sleep(jitter(2500));
  return { ok: true };
}

export function threadContains(needle: string): boolean {
  return threadContainsMessage(needle);
}

export async function waitForUrlMatch(pattern: string, timeoutMs: number): Promise<{ matched: boolean }> {
  const re = new RegExp(pattern, 'i');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (re.test(location.href)) return { matched: true };
    await sleep(250);
  }
  return { matched: false };
}
