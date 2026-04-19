// Generic "scroll-until-stable" helper. Callers supply an extract function
// that returns the current snapshot of items visible in the DOM; the helper
// tracks what's new, calls scroll(), and stops when the count is unchanged
// for `maxIdleRounds` consecutive iterations — or when `max` is reached.

import { waitFor } from '../lib';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CollectOptions<T> {
  extract: () => Promise<T[]>;
  scroll: () => Promise<void>;
  /** Optional cap. Collection stops once the result reaches this length. */
  max?: number;
  /** Idle rounds with no growth before stopping. Default 6. */
  maxIdleRounds?: number;
  /** Delay between extract + scroll cycles. Default 1200ms. */
  pauseMs?: number;
  /** Optional per-iteration hook — receives only the items added this round. */
  onBatch?: (added: T[]) => void;
  /** Custom dedup key. Defaults to `String(item)`. */
  keyOf?: (item: T) => string;
  /** Short-circuit: when it returns true we stop scrolling immediately. Lets
   *  upstream code halt a per-post comment slurp once the global lead cap
   *  has been hit. */
  shouldStop?: () => boolean;
}

/** Lazy variant of `collectByScrolling`: yields each new item as soon as it
 *  appears in the DOM. Lets callers act on items one at a time (e.g. walk a
 *  post for leads) without pre-scrolling the whole grid. Stops when the DOM
 *  yields no new items for `maxIdleRounds` consecutive scrolls. */
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

/** Incrementally collect items from a page, deduplicating by a string key. */
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
      if (opts.max && out.length >= opts.max) break;
    }
    if (added.length > 0) opts.onBatch?.(added);

    if (opts.max && out.length >= opts.max) break;
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

/** Scroll the tallest scrollable element inside a [role="dialog"] modal. */
export async function scrollDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollable = Array.from(
      document.querySelectorAll<HTMLElement>('div[role="dialog"] *')
    ).find((el) => el.scrollHeight > el.clientHeight + 10);
    if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
  });
}

/** Scroll the main window. */
export async function scrollWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

/** Scroll the comments panel on a post/reel detail page. Instagram uses
 *  different containers depending on layout (post modal, reel player
 *  sidebar, reel-as-post column), so we search for the tallest scrollable
 *  element in the dialog/main and scroll it. Returns a short label
 *  describing which strategy hit, for diagnostic logging. */
export async function scrollCommentList(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    function pickTallestScrollable(root: Element | Document): HTMLElement | null {
      const candidates = Array.from(root.querySelectorAll<HTMLElement>('*')).filter((el) => {
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

    // Priority 1: scrollable inside an open dialog (covers reel comments
    // panel and post modal).
    const dialog = document.querySelector('div[role="dialog"]');
    const dialogTarget = dialog ? pickTallestScrollable(dialog) : null;
    if (dialogTarget) {
      dialogTarget.scrollTop = dialogTarget.scrollHeight;
      return 'dialog';
    }

    // Priority 2: the canonical role="list" comment container.
    const list =
      document.querySelector<HTMLElement>('article ul[role="list"]') ??
      document.querySelector<HTMLElement>('ul[role="list"]');
    if (list && list.scrollHeight > list.clientHeight + 10) {
      list.scrollTop = list.scrollHeight;
      return 'ul[role=list]';
    }

    // Priority 3: tallest scrollable inside <main> (reel-as-post side column).
    const main = document.querySelector('main');
    const mainTarget = main ? pickTallestScrollable(main) : null;
    if (mainTarget) {
      mainTarget.scrollTop = mainTarget.scrollHeight;
      return 'main';
    }

    // Fallback: the window itself.
    window.scrollTo(0, document.body.scrollHeight);
    return 'window';
  })) as string;
}
