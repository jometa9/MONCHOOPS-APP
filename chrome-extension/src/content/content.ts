

import type { CsRequest, CsResponse } from '@/shared/messages';
import {
  clickFollow,
  clickLike,
  detectFollowState,
  detectLikeState,
  dismissPrompts,
  dwellOneStoryFrame,
  findPostUrls,
  getUrl,
  isOnStories,
  openNewDmDialog,
  pickFirstSearchResult,
  threadContains,
  typeAndSendDm,
  waitForComposer,
  waitForUrlMatch,
} from './ig-actions';
import { startDismisser } from './ig-dom';

console.log('[monchoops] content script loaded on', location.href);
startDismisser();

chrome.runtime.onMessage.addListener((req: CsRequest, _sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !('type' in req)) return false;
  if (!req.type.startsWith('monchoops/')) return false;

  (async () => {
    try {
      const data = await dispatch(req);
      sendResponse({ ok: true, data } satisfies CsResponse);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn('[monchoops] primitive failed', req.type, error);
      sendResponse({ ok: false, error } satisfies CsResponse);
    }
  })();
  return true;
});

async function dispatch(req: CsRequest): Promise<unknown> {
  switch (req.type) {
    case 'monchoops/ping':
      return undefined;
    case 'monchoops/url':
      return { url: getUrl() };
    case 'monchoops/dismissPrompts':
      dismissPrompts();
      return undefined;
    case 'monchoops/checkOnStories':
      return { value: isOnStories() };
    case 'monchoops/dwellStory':
      return await dwellOneStoryFrame(req.dwellMs);
    case 'monchoops/detectFollowState':
      return { state: detectFollowState() };
    case 'monchoops/clickFollow':
      return await clickFollow();
    case 'monchoops/findPostUrls':
      return { urls: findPostUrls(req.n) };
    case 'monchoops/detectLikeState':
      return { state: detectLikeState() };
    case 'monchoops/clickLike':
      return await clickLike();
    case 'monchoops/waitForComposer':
      return await waitForComposer(req.timeoutMs ?? 15_000);
    case 'monchoops/openNewDmDialog':
      return await openNewDmDialog();
    case 'monchoops/pickFirstSearchResult':
      return await pickFirstSearchResult(req.username);
    case 'monchoops/typeAndSendDm':
      return await typeAndSendDm(req.message);
    case 'monchoops/threadContains':
      return { value: threadContains(req.needle) };
    case 'monchoops/waitForUrlMatch':
      return await waitForUrlMatch(req.pattern, req.timeoutMs ?? 20_000);
    default: {
      const _exhaustive: never = req;
      void _exhaustive;
      throw new Error('unknown_primitive');
    }
  }
}
