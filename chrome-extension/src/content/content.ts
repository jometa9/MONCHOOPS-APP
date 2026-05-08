

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

console.log('[b2dm] content script loaded on', location.href);
startDismisser();

chrome.runtime.onMessage.addListener((req: CsRequest, _sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !('type' in req)) return false;
  if (!req.type.startsWith('b2dm/')) return false;

  (async () => {
    try {
      const data = await dispatch(req);
      sendResponse({ ok: true, data } satisfies CsResponse);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn('[b2dm] primitive failed', req.type, error);
      sendResponse({ ok: false, error } satisfies CsResponse);
    }
  })();
  return true;
});

async function dispatch(req: CsRequest): Promise<unknown> {
  switch (req.type) {
    case 'b2dm/ping':
      return undefined;
    case 'b2dm/url':
      return { url: getUrl() };
    case 'b2dm/dismissPrompts':
      dismissPrompts();
      return undefined;
    case 'b2dm/checkOnStories':
      return { value: isOnStories() };
    case 'b2dm/dwellStory':
      return await dwellOneStoryFrame(req.dwellMs);
    case 'b2dm/detectFollowState':
      return { state: detectFollowState() };
    case 'b2dm/clickFollow':
      return await clickFollow();
    case 'b2dm/findPostUrls':
      return { urls: findPostUrls(req.n) };
    case 'b2dm/detectLikeState':
      return { state: detectLikeState() };
    case 'b2dm/clickLike':
      return await clickLike();
    case 'b2dm/waitForComposer':
      return await waitForComposer(req.timeoutMs ?? 15_000);
    case 'b2dm/openNewDmDialog':
      return await openNewDmDialog();
    case 'b2dm/pickFirstSearchResult':
      return await pickFirstSearchResult(req.username);
    case 'b2dm/typeAndSendDm':
      return await typeAndSendDm(req.message);
    case 'b2dm/threadContains':
      return { value: threadContains(req.needle) };
    case 'b2dm/waitForUrlMatch':
      return await waitForUrlMatch(req.pattern, req.timeoutMs ?? 20_000);
    default: {
      const _exhaustive: never = req;
      void _exhaustive;
      throw new Error('unknown_primitive');
    }
  }
}
