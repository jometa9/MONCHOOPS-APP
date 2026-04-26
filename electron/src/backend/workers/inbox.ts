// Forked worker: drives one of three inbox modes per invocation —
//   poll        — refresh thread list, pull deltas for changed threads
//   backfill    — full history walk for a freshly-added account
//   thread_fetch — pull older messages for one specific thread on demand
//   send_message — type and submit a reply in a thread
//
// All four modes share the launchBrowser + ensureLoggedIn boilerplate. The
// main process forwards the parsed deltas to the SQLite inbox tables in
// inboxScheduler.ts.

import {
  isCancelled,
  launchBrowser,
  onInit,
  sendError,
  sendLog,
  sendProgress,
  sendResult,
  type WindowBounds,
} from './lib';
import {
  attachDialogDismisser,
  ensureLoggedIn,
  fetchInboxThreads,
  fetchThreadMessages,
  sendThreadMessage,
  type ParsedMessageDelta,
  type ParsedThreadDelta,
} from './ig';
import type { AccountSecrets } from '../accounts';

interface InboxInit {
  jobId: string;
  accountId: string;
  secrets: AccountSecrets;
  mode: 'poll' | 'backfill' | 'thread_fetch' | 'send_message';
  igThreadId?: string | null;
  text?: string | null;
  knownThreads?: Array<{ igThreadId: string; lastMessageAt: number | null }>;
  maxThreads?: number;
  maxMessagesPerThread?: number;
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

export interface InboxThreadDelta {
  thread: ParsedThreadDelta;
  messages: ParsedMessageDelta[];
}

export interface InboxPollResult {
  mode: 'poll' | 'backfill' | 'thread_fetch';
  threadsScanned: number;
  threadsWithDeltas: number;
  messagesAdded: number;
  deltas: InboxThreadDelta[];
}

export interface InboxSendResult {
  mode: 'send_message';
  igMessageId: string | null;
  sentAt: number;
}

onInit<InboxInit>(async (init) => {
  const { browser, context } = await launchBrowser({
    headless: init.headless,
    secrets: init.secrets,
    windowBounds: init.windowBounds,
    maximizeWindow: init.maximizeWindow,
  });
  const page = await context.newPage();
  const detachDismisser = attachDialogDismisser(page);

  try {
    await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });
    sendProgress(0);

    if (init.mode === 'send_message') {
      const text = (init.text ?? '').trim();
      if (!text) throw new Error('send_message requires non-empty text');
      if (!init.igThreadId) throw new Error('send_message requires igThreadId');
      const result = await sendThreadMessage(page, init.igThreadId, text);
      sendResult({ mode: 'send_message', ...result } satisfies InboxSendResult);
      return;
    }

    const maxThreads =
      init.mode === 'backfill'
        ? init.maxThreads ?? 500
        : init.maxThreads ?? 50;
    const maxMessages =
      init.mode === 'backfill'
        ? init.maxMessagesPerThread ?? 200
        : init.maxMessagesPerThread ?? 30;

    if (init.mode === 'thread_fetch') {
      if (!init.igThreadId) throw new Error('thread_fetch requires igThreadId');
      const { peerUsername, messages } = await fetchThreadMessages(page, {
        igThreadId: init.igThreadId,
        maxMessages,
      });
      const synthThread: ParsedThreadDelta = {
        igThreadId: init.igThreadId,
        peerUsername: peerUsername ?? '',
        peerDisplayName: null,
        peerPicUrl: null,
        isGroup: false,
        lastMessageAt: messages[0]?.sentAt ?? null,
        lastMessagePreview: messages[0]?.body ?? null,
        lastMessageFromMe: messages[0]?.direction === 'out',
        unreadCount: 0,
      };
      sendResult({
        mode: 'thread_fetch',
        threadsScanned: 1,
        threadsWithDeltas: messages.length > 0 ? 1 : 0,
        messagesAdded: messages.length,
        deltas: [{ thread: synthThread, messages }],
      } satisfies InboxPollResult);
      return;
    }

    const threads = await fetchInboxThreads(page, { maxThreads });
    sendProgress(0, threads.length);

    const known = new Map<string, number | null>();
    if (init.mode === 'poll') {
      for (const k of init.knownThreads ?? []) {
        known.set(k.igThreadId, k.lastMessageAt);
      }
    }

    const deltas: InboxThreadDelta[] = [];
    let messagesAdded = 0;
    let threadsWithDeltas = 0;

    for (let i = 0; i < threads.length; i++) {
      if (isCancelled()) break;
      const t = threads[i]!;
      let needsFetch = init.mode === 'backfill';
      if (init.mode === 'poll') {
        const prev = known.get(t.igThreadId);
        if (prev === undefined) needsFetch = true; // never seen
        else if (
          (t.lastMessageAt ?? 0) > (prev ?? 0) ||
          t.unreadCount > 0
        )
          needsFetch = true;
      }

      if (needsFetch) {
        try {
          const { messages } = await fetchThreadMessages(page, {
            igThreadId: t.igThreadId,
            maxMessages,
          });
          if (messages.length > 0) {
            threadsWithDeltas += 1;
            messagesAdded += messages.length;
            deltas.push({ thread: t, messages });
          } else {
            deltas.push({ thread: t, messages: [] });
          }
        } catch (err) {
          sendLog('warn', `Thread ${t.igThreadId} fetch failed: ${err instanceof Error ? err.message : String(err)}`);
          deltas.push({ thread: t, messages: [] });
        }
      } else {
        // No fetch needed; still report the thread metadata so main can keep
        // the row's preview fresh.
        deltas.push({ thread: t, messages: [] });
      }

      sendProgress(i + 1, threads.length, t.peerUsername);
    }

    sendResult({
      mode: init.mode,
      threadsScanned: threads.length,
      threadsWithDeltas,
      messagesAdded,
      deltas,
    } satisfies InboxPollResult);
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    detachDismisser();
    try { await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
});
