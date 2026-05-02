// DOM primitives for Instagram automation. Runs in the content-script
// world (full access to instagram.com's DOM), not in the page world — so
// React's internal state is opaque to us. To make IG's React composer
// accept text we have to dispatch native input events the way React tracks
// them, otherwise the value we set is silently discarded.
//
// Ported from electron/src/backend/workers/ig/ — same selectors, same
// dialog dismissals, same like/follow/story flows, just without Playwright.

export const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

export function jitter(baseMs: number, range = 0.4): number {
  const min = baseMs * (1 - range);
  const max = baseMs * (1 + range);
  return Math.floor(min + Math.random() * (max - min));
}

// --- waiters --------------------------------------------------------------

export async function waitFor<T>(
  fn: () => T | null | undefined,
  { timeoutMs = 15_000, pollMs = 200 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(pollMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

export async function waitForVisible(selector: string, opts?: { timeoutMs?: number }): Promise<HTMLElement> {
  return waitFor<HTMLElement>(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return el;
  }, opts);
}

export async function waitForUrl(matcher: RegExp, opts?: { timeoutMs?: number }): Promise<void> {
  await waitFor(() => (matcher.test(location.href) ? true : null), {
    timeoutMs: opts?.timeoutMs ?? 20_000,
    pollMs: 250,
  });
}

// --- composer (DM) --------------------------------------------------------

const COMPOSER_SELECTOR = [
  'main div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"][aria-label*="Message" i]',
  'div[contenteditable="true"][aria-label*="Mensaje" i]',
].join(', ');

export async function findComposer(timeoutMs = 15_000): Promise<HTMLElement> {
  return waitForVisible(COMPOSER_SELECTOR, { timeoutMs });
}

// Type into a contenteditable composer in a way that IG's React tree
// actually picks up. Setting innerText alone leaves React's internal
// shadow value blank — clicking Send afterwards either no-ops or sends
// an empty bubble. The fix is to fire a beforeinput + input pair with
// a real InputEvent that has inputType: "insertText" and the data
// payload. We do it character-by-character with human-ish jitter so the
// keystroke timing distribution doesn't scream "bot".
export async function humanType(el: HTMLElement, text: string): Promise<void> {
  el.focus();
  el.click();
  await sleep(jitter(250));

  // Some IG variants need a clean state — clear any draft text first.
  if (el.isContentEditable && (el.textContent ?? '').length > 0) {
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
  }

  for (const ch of text) {
    insertCharacter(el, ch);
    const thinking = Math.random() < 0.06 ? 250 + Math.random() * 250 : 0;
    await sleep(60 + Math.random() * 80 + thinking);
  }
}

function insertCharacter(el: HTMLElement, ch: string): void {
  // Newline support — IG composer treats Enter as send, so messages with
  // \n should use a Shift+Enter equivalent: insert a <br> via execCommand.
  if (ch === '\n') {
    document.execCommand('insertLineBreak');
    return;
  }
  // execCommand('insertText') is deprecated but still works in Chrome and
  // is the only API that fires beforeinput+input with the right payload
  // for React's contenteditable bridge. Falls back to manual event
  // dispatch on browsers where it returns false.
  const ok = document.execCommand('insertText', false, ch);
  if (ok) return;

  const before = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertText',
    data: ch,
  });
  el.dispatchEvent(before);
  el.append(ch);
  const after = new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: ch,
  });
  el.dispatchEvent(after);
}

export function pressEnter(el: HTMLElement): void {
  const ev = (type: string) =>
    new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
  el.dispatchEvent(ev('keydown'));
  el.dispatchEvent(ev('keypress'));
  el.dispatchEvent(ev('keyup'));
}

// --- dialog dismissers ----------------------------------------------------

const NOT_NOW = ['Not now', 'Not Now', 'Ahora no', 'Ahora No'];
const NOTIFICATIONS_TITLES = [
  'turn on notifications',
  'activar las notificaciones',
  'activar notificaciones',
];
const SAVE_LOGIN_TITLES = [
  'save your login info',
  'guardar tu información de inicio',
  'guardar tus datos de inicio',
];

function dismissByTitles(titles: string[]): boolean {
  const dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
  if (!dialog) return false;
  const text = (dialog.textContent ?? '').toLowerCase();
  if (!titles.some((t) => text.includes(t))) return false;
  const btns = Array.from(
    dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')
  );
  for (const b of btns) {
    const label = (b.textContent ?? '').trim();
    if (NOT_NOW.includes(label)) {
      b.click();
      return true;
    }
  }
  return false;
}

export function dismissIgPrompts(): void {
  dismissByTitles(SAVE_LOGIN_TITLES);
  dismissByTitles(NOTIFICATIONS_TITLES);
}

let dismisserHandle: number | null = null;
export function startDismisser(): () => void {
  if (dismisserHandle !== null) return () => {};
  dismisserHandle = window.setInterval(() => {
    try {
      dismissIgPrompts();
    } catch {}
  }, 2500);
  return () => {
    if (dismisserHandle !== null) {
      clearInterval(dismisserHandle);
      dismisserHandle = null;
    }
  };
}

// --- like state -----------------------------------------------------------

const LIKED_LABELS = ['Unlike', 'Ya no me gusta'];
const NOT_LIKED_LABELS = ['Like', 'Me gusta'];

function isPostHeart(svg: Element): boolean {
  const rect = (svg as SVGElement).getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return false;
  let cur: Element | null = svg;
  while (cur) {
    const tag = cur.tagName;
    const role = cur.getAttribute?.('role');
    if (tag === 'UL' || tag === 'LI' || role === 'list' || role === 'listitem') return false;
    if (tag === 'ARTICLE') return true;
    cur = cur.parentElement;
  }
  return true;
}

export type LikeState = 'not_liked' | 'liked' | 'unavailable';

export function detectLikeState(): LikeState {
  const svgs = Array.from(document.querySelectorAll<SVGElement>('svg[aria-label]')).filter(
    isPostHeart
  );
  for (const s of svgs) {
    const l = s.getAttribute('aria-label') ?? '';
    if (LIKED_LABELS.includes(l)) return 'liked';
  }
  for (const s of svgs) {
    const l = s.getAttribute('aria-label') ?? '';
    if (NOT_LIKED_LABELS.includes(l)) return 'not_liked';
  }
  return 'unavailable';
}

export function clickLikeButton(): boolean {
  const svgs = Array.from(document.querySelectorAll<SVGElement>('svg[aria-label]')).filter(
    (s) => NOT_LIKED_LABELS.includes(s.getAttribute('aria-label') ?? '') && isPostHeart(s)
  );
  for (const s of svgs) {
    let target: HTMLElement | null = s as unknown as HTMLElement;
    while (target) {
      if (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') {
        target.click();
        return true;
      }
      target = target.parentElement;
    }
  }
  return false;
}

// --- follow state ---------------------------------------------------------

export type FollowState = 'not_following' | 'following' | 'requested' | 'unavailable';

export function detectFollowState(): FollowState {
  const NOT_FOLLOWING = ['follow', 'seguir'];
  const FOLLOWING = ['following', 'siguiendo'];
  const REQUESTED = ['requested', 'solicitado'];
  const root =
    document.querySelector('main header') ??
    document.querySelector('header') ??
    document.querySelector('main') ??
    document.body;
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
  for (const b of buttons) {
    const text = (b.textContent ?? '').trim().toLowerCase();
    if (!text || text.length > 60) continue;
    if (REQUESTED.some((t) => text === t || text.startsWith(t))) return 'requested';
    if (FOLLOWING.some((t) => text === t || text.startsWith(t))) return 'following';
  }
  for (const b of buttons) {
    const text = (b.textContent ?? '').trim().toLowerCase();
    if (!text || text.length > 60) continue;
    if (NOT_FOLLOWING.includes(text)) return 'not_following';
  }
  return 'unavailable';
}

export function clickFollowButton(): boolean {
  const NOT_FOLLOWING = ['follow', 'seguir'];
  const root =
    document.querySelector('main header') ??
    document.querySelector('header') ??
    document.querySelector('main') ??
    document.body;
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]'));
  for (const b of buttons) {
    const text = (b.textContent ?? '').trim().toLowerCase();
    if (!text || text.length > 30) continue;
    if (NOT_FOLLOWING.includes(text)) {
      b.click();
      return true;
    }
  }
  return false;
}

// IG sometimes pops a "Do you know this person?" guard after a follow click.
// Confirms by clicking "Follow anyway" if the dialog is up.
export function confirmFollowAnywayIfPrompted(): boolean {
  const TITLE_HINTS = [
    'do you know this person',
    'conoces a esta persona',
    '¿conoces a esta persona',
  ];
  const CONFIRM_LABELS = [
    'follow anyway',
    'seguir de todos modos',
    'seguir de todas formas',
    'seguir igual',
  ];
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"]'));
  for (const d of dialogs) {
    const text = (d.textContent ?? '').toLowerCase();
    if (!TITLE_HINTS.some((h) => text.includes(h))) continue;
    const buttons = Array.from(d.querySelectorAll<HTMLElement>('button, [role="button"]'));
    for (const b of buttons) {
      const label = (b.textContent ?? '').trim().toLowerCase();
      if (CONFIRM_LABELS.some((l) => label === l || label.startsWith(l))) {
        b.click();
        return true;
      }
    }
  }
  return false;
}

// --- thread verification --------------------------------------------------

export function threadContainsMessage(needle: string): boolean {
  const main = document.querySelector('main');
  if (!main) return false;
  const target = needle.trim().replace(/\s+/g, ' ');
  if (!target) return false;
  let acc = '';
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let p: HTMLElement | null = (node as Text).parentElement;
      while (p && p !== main) {
        if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
        p = p.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n: Node | null = walker.nextNode();
  while (n) {
    acc += ' ' + (n.textContent ?? '');
    n = walker.nextNode();
  }
  return acc.replace(/\s+/g, ' ').includes(target);
}
