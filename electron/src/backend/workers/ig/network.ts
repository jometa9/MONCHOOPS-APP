

type Page = any;

export interface NetworkTracker {

  pending(): number;

  idleMs(): number;

  waitSettle(quietMs?: number, maxWaitMs?: number): Promise<boolean>;

  dispose(): void;
}

const DEFAULT_URL_FILTER = /instagram\.com\/(api|graphql)/;

const READY_URL_FILTER =
  /^https?:\/\/[^/]*(instagram\.com|ig\.me|cdninstagram\.com|fbcdn\.net)\//;

export function createNetworkTracker(
  page: Page,
  urlFilter: RegExp = DEFAULT_URL_FILTER
): NetworkTracker {
  let lastActivity = Date.now();
  let pending = 0;
  let disposed = false;

  function matches(req: { url(): string; resourceType?: () => string }): boolean {
    try {
      const rt = req.resourceType?.();
      if (rt && rt !== 'xhr' && rt !== 'fetch') return false;
    } catch {}
    try {
      return urlFilter.test(req.url());
    } catch {
      return false;
    }
  }

  const onRequest = (req: any) => {
    if (disposed) return;
    if (!matches(req)) return;
    pending += 1;
    lastActivity = Date.now();
  };

  const onDone = (req: any) => {
    if (disposed) return;
    if (!matches(req)) return;
    pending = Math.max(0, pending - 1);
    lastActivity = Date.now();
  };

  page.on('request', onRequest);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);

  return {
    pending() {
      return pending;
    },
    idleMs() {
      return Date.now() - lastActivity;
    },
    async waitSettle(quietMs = 1500, maxWaitMs = 12_000): Promise<boolean> {
      const deadline = Date.now() + maxWaitMs;
      while (Date.now() < deadline) {
        if (pending === 0 && Date.now() - lastActivity >= quietMs) return true;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { page.off('request', onRequest); } catch {}
      try { page.off('requestfinished', onDone); } catch {}
      try { page.off('requestfailed', onDone); } catch {}
    },
  };
}

export async function waitForPageReady(
  page: Page,
  opts: {
    quietMs?: number;
    maxWaitMs?: number;
    minWaitMs?: number;
    loadTimeoutMs?: number;
    urlFilter?: RegExp;
  } = {}
): Promise<void> {
  const quietMs = opts.quietMs ?? 1500;
  const maxWaitMs = opts.maxWaitMs ?? 15_000;
  const minWaitMs = opts.minWaitMs ?? 2000;
  const loadTimeoutMs = opts.loadTimeoutMs ?? 10_000;
  const urlFilter = opts.urlFilter ?? READY_URL_FILTER;
  const startedAt = Date.now();

  try {
    await page.waitForLoadState('load', { timeout: loadTimeoutMs });
  } catch {

  }

  const tracker = createNetworkTracker(page, urlFilter);
  try {
    await tracker.waitSettle(quietMs, maxWaitMs);
  } finally {
    tracker.dispose();
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < minWaitMs) {
    await new Promise((r) => setTimeout(r, minWaitMs - elapsed));
  }
}

export async function waitForLocatorReady(
  page: Page,
  locator: any,
  opts: {
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    timeout?: number;
    readyTimeout?: number;
  } = {}
): Promise<void> {
  const locatorMs = opts.timeout ?? 15_000;
  const readyMs = opts.readyTimeout ?? 12_000;
  await waitForPageReady(page, { maxWaitMs: readyMs });
  await locator.waitFor({ state: opts.state ?? 'visible', timeout: locatorMs });
}
