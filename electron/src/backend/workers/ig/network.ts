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

const DEFAULT_URL_FILTER = /instagram\.com\/(api|graphql)/;

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
