// Per-page network activity tracker. Used to detect "end of infinite
// scroll": we wait until Instagram stops firing XHR/fetch requests for
// a quiet window, at which point no more comments/likers can arrive.

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface NetworkTracker {
  /** Number of in-flight tracked requests. */
  pending(): number;
  /** ms since the last tracked request started / finished. */
  idleMs(): number;
  /** Wait until `idleMs() >= quietMs` OR `maxWaitMs` elapses. Returns true
   *  if we exited cleanly (network went quiet), false on timeout. */
  waitSettle(quietMs?: number, maxWaitMs?: number): Promise<boolean>;
  /** Detach listeners. Safe to call multiple times. */
  dispose(): void;
}

// Narrow filter for the scrolling tracker: only count Instagram's REST and
// GraphQL endpoints. Used by collectByScrolling to detect when "load more
// comments / likers" has finished and there's nothing to scroll for.
const DEFAULT_URL_FILTER = /instagram\.com\/(api|graphql)/;

// Permissive filter for page-readiness: catches every XHR/fetch IG fires
// after a navigation, not just the api/graphql subset. IG actually serves
// DM data from /direct_v2/, profile data from /web/, search from /ajax/,
// etc., none of which would match the narrow filter — so the readiness
// helper would think the network was already quiet and return immediately.
// We also include ig.me (the shortlink redirector) and IG's CDN hosts so
// resource fetches that block first-paint are observed too.
const READY_URL_FILTER =
  /^https?:\/\/[^/]*(instagram\.com|ig\.me|cdninstagram\.com|fbcdn\.net)\//;

/** Install listeners that count interesting XHR/fetch requests. Only
 *  Instagram's API surface is tracked so navigation / image loads don't
 *  keep the tracker "busy" forever. */
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

/**
 * Wait until the page is "settled" enough to act on. Three signals are
 * combined; we don't return until ALL are satisfied:
 *
 *   1. The `load` event has fired (HTML/JS/CSS parsed and initial assets
 *      requested). Without this we can race the SPA's first script execution.
 *   2. Instagram's XHR/fetch traffic has been quiet for `quietMs`. Uses the
 *      permissive READY_URL_FILTER so we catch /direct_v2/, /web/, /ajax/,
 *      /api/ and /graphql/ — not just the narrow scroll-time filter.
 *   3. A minimum floor of `minWaitMs` has elapsed since entry. Guards the
 *      common race where the SPA hasn't *started* its data fetches yet when
 *      the tracker is installed: pending=0 satisfies "quiet" instantly even
 *      though we should wait.
 *
 * `maxWaitMs` is a hard cap for the network-quiet wait. IG keeps long-poll
 * connections open in many flows, so we don't insist on a perfectly quiet
 * network forever — we proceed once the cap is reached and let downstream
 * locator waits decide if the page is actually usable.
 */
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
    // SPA in-place navs sometimes don't trigger a fresh `load`; fall through
    // and let the network/floor checks gate progression.
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

/**
 * Like `locator.waitFor({ state, timeout })`, but first waits for the page
 * to be ready (load + IG XHR quiet + min floor). This way a timeout truly
 * means the element isn't there — not that we raced the page's loading.
 *
 * `timeout` and `readyTimeout` are SEPARATE budgets so the locator always
 * gets its full window regardless of how long the readiness phase took.
 */
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
