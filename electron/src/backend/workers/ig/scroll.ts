

import { waitFor } from '../lib';

type Page = any;

export interface CollectOptions<T> {
  extract: () => Promise<T[]>;
  scroll: () => Promise<void>;

  target?: number;

  maxIdleRounds?: number;

  pauseMs?: number;

  onBatch?: (added: T[]) => void;

  keyOf?: (item: T) => string;

  shouldStop?: () => boolean;
}

export async function* iterateByScrolling<T>(opts: {
  extract: () => Promise<T[]>;
  scroll: () => Promise<void>;
  maxIdleRounds?: number;
  pauseMs?: number;
  keyOf?: (item: T) => string;
  shouldStop?: () => boolean;
}): AsyncGenerator<T, void, void> {
  const keyOf = opts.keyOf ?? ((item: T) => String(item));
  const idleMax = opts.maxIdleRounds ?? 6;
  const pause = opts.pauseMs ?? 1200;

  const seen = new Set<string>();
  let idle = 0;
  let prevSize = 0;

  while (idle < idleMax) {
    if (opts.shouldStop?.()) return;
    const batch = await opts.extract();
    for (const item of batch) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      yield item;
      if (opts.shouldStop?.()) return;
    }

    if (seen.size === prevSize) {
      idle += 1;
    } else {
      idle = 0;
      prevSize = seen.size;
    }

    await opts.scroll();
    await waitFor(pause);
  }
}

export async function collectByScrolling<T>(opts: CollectOptions<T>): Promise<T[]> {
  const keyOf = opts.keyOf ?? ((item: T) => String(item));
  const idleMax = opts.maxIdleRounds ?? 6;
  const pause = opts.pauseMs ?? 1200;

  const seen = new Set<string>();
  const out: T[] = [];
  let idle = 0;
  let lastSize = -1;

  while (idle < idleMax) {
    if (opts.shouldStop?.()) break;
    const batch = await opts.extract();
    const added: T[] = [];
    for (const item of batch) {
      const key = keyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      added.push(item);
      if (opts.target && out.length >= opts.target) break;
    }
    if (added.length > 0) opts.onBatch?.(added);

    if (opts.target && out.length >= opts.target) break;
    if (opts.shouldStop?.()) break;

    if (out.length === lastSize) {
      idle += 1;
    } else {
      idle = 0;
      lastSize = out.length;
    }

    await opts.scroll();
    await waitFor(pause);
  }

  return out;
}

export async function scrollDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollable = Array.from(
      document.querySelectorAll<HTMLElement>('div[role="dialog"] *')
    ).find((el) => el.scrollHeight > el.clientHeight + 10);
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });
}

export async function scrollWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

export async function scrollCommentList(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const isReelViewer = /\/reels?\//.test(location.pathname);

    function pickTallestScrollable(root: Element | Document): HTMLElement | null {
      const all: HTMLElement[] = [];
      if (root instanceof HTMLElement) all.push(root);
      all.push(...Array.from(root.querySelectorAll<HTMLElement>('*')));
      const candidates = all.filter((el) => {
        const overflow = el.scrollHeight - el.clientHeight;
        if (overflow < 40) return false;
        const style = getComputedStyle(el);
        const ok = ['auto', 'scroll', 'overlay'];
        return ok.includes(style.overflowY) || ok.includes(style.overflow);
      });
      if (candidates.length === 0) return null;
      candidates.sort(
        (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
      );
      return candidates[0] ?? null;
    }

    const dialog = document.querySelector('div[role="dialog"]');
    const dialogTarget = dialog ? pickTallestScrollable(dialog) : null;
    if (dialogTarget) {
      dialogTarget.scrollTop = dialogTarget.scrollHeight;
      return 'dialog';
    }

    const dialogList = dialog?.querySelector<HTMLElement>('ul[role="list"]');
    if (dialogList && dialogList.scrollHeight > dialogList.clientHeight + 10) {
      dialogList.scrollTop = dialogList.scrollHeight;
      return 'dialog>ul';
    }

    if (isReelViewer) {
      return 'reel-noop';
    }

    const list =
      document.querySelector<HTMLElement>('article ul[role="list"]') ??
      document.querySelector<HTMLElement>('ul[role="list"]');
    if (list && list.scrollHeight > list.clientHeight + 10) {
      list.scrollTop = list.scrollHeight;
      return 'ul[role=list]';
    }

    const main = document.querySelector('main');
    const mainTarget = main ? pickTallestScrollable(main) : null;
    if (mainTarget) {
      mainTarget.scrollTop = mainTarget.scrollHeight;
      return 'main';
    }

    window.scrollTo(0, document.body.scrollHeight);
    return 'window';
  })) as string;
}
