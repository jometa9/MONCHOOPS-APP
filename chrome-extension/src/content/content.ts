// Content script entry. Lives on every instagram.com / ig.me tab.
//
// Lifecycle:
//   1. The background SW picks the next pending lead for a campaign and
//      sends `ig/sendDm` to the IG tab via chrome.tabs.sendMessage.
//   2. We run pre-DM interactions (optional) → send the DM → verify.
//   3. We reply with the result. The SW persists it and reschedules.
//
// Concurrency: the SW guarantees only one ig/sendDm is in flight at a
// time. If a second one arrives while we're processing, we reject it so
// the SW can retry later instead of corrupting state.

import type { IgSendRequest, IgSendResult } from '@/shared/messages';
import { sendDm, SendVerificationError, runInteractions } from './ig-actions';
import { startDismisser } from './ig-dom';

let busy = false;

startDismisser();

chrome.runtime.onMessage.addListener((req: IgSendRequest, _sender, sendResponse) => {
  if (req?.type !== 'ig/sendDm') return false;

  if (busy) {
    sendResponse({ ok: false, error: 'busy' } satisfies IgSendResult);
    return false;
  }

  busy = true;
  (async () => {
    try {
      if (req.interactions) {
        try {
          await runInteractions(req.username, req.interactions);
        } catch (err) {
          // Interactions failing should not block the DM — log and keep going.
          console.warn('[b2dm] interactions failed for', req.username, err);
        }
      }
      const r = await sendDm(req.username, req.message);
      sendResponse({ ok: true, verified: r.verified } satisfies IgSendResult);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const verification = err instanceof SendVerificationError;
      sendResponse({
        ok: false,
        error: verification ? `verification_failed: ${error}` : error,
      } satisfies IgSendResult);
    } finally {
      busy = false;
    }
  })();

  // Tell Chrome we'll reply asynchronously.
  return true;
});
