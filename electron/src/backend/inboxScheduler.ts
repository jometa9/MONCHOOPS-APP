// Drives background inbox polling per account and persists worker results
// into the inbox tables. Runs entirely in the main process.
//
// Cadence: 5 min idle / 90 s active monitoring (both ±25% jitter), defaults
// the user can override per-account via setActiveMonitoring.

import { listAccounts } from './accounts';
import { handleInboundMessage, type OnNewInboundEvent } from './aiResponder';
import { getSettings as getAiSettings, getApiKey as getAiApiKey } from './ai';
import { cancelOnReply } from './followups';
import { metaGet } from './db';
import {
  ensureSyncState,
  getThread,
  getThreadKnownState,
  listSyncStates,
  recordPollResult,
  recordPollStarted,
  upsertMessage,
  upsertThread,
  type ParsedMessage,
  type ParsedThread,
} from './inbox';
import {
  startInboxJob,
  subscribe as subscribeToJobs,
  type JobEvent,
} from './jobs';

const TICK_MS = 30_000;
const IDLE_BASE_MS = 5 * 60_000;
const ACTIVE_BASE_MS = 90_000;
const JITTER_PCT = 0.25;

let timer: ReturnType<typeof setInterval> | null = null;
let unsubscribe: (() => void) | null = null;

let broadcastFn: ((channel: string, payload?: unknown) => void) | null = null;

function scheduleNext(active: boolean): number {
  const base = active ? ACTIVE_BASE_MS : IDLE_BASE_MS;
  const jitter = base * (Math.random() * 2 - 1) * JITTER_PCT;
  return Math.floor(base + jitter);
}

export function startInboxScheduler(broadcast: (channel: string, payload?: unknown) => void): void {
  if (timer) return;
  broadcastFn = broadcast;
  unsubscribe = subscribeToJobs((evt) => onJobEvent(evt).catch((err) => {
    console.error('[inboxScheduler] event handler failed:', err);
  }));
  timer = setInterval(() => {
    try { tick(); } catch (err) { console.error('[inboxScheduler] tick failed:', err); }
  }, TICK_MS);
  // Run a tick immediately so newly-added accounts begin syncing without
  // waiting up to 30s.
  setImmediate(() => {
    try { tick(); } catch {}
  });
}

export function stopInboxScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  broadcastFn = null;
}

function tick(): void {
  if (metaGet('inbox_poller_paused') === 'true') return;
  const accounts = listAccounts().filter((a) => a.status === 'idle');
  const states = listSyncStates();
  const stateById = new Map(states.map((s) => [s.accountId, s]));
  const now = Date.now();
  for (const acc of accounts) {
    const state = stateById.get(acc.id);
    if (!state) {
      // Schedule the first poll right away — no prior state means we've
      // never synced this account; it'll get its proper backfill from the
      // explicit accounts.create() trigger, but if that's already done a
      // first poll now warms the cache.
      ensureSyncState(acc.id);
      enqueuePoll(acc.id);
      continue;
    }
    if (state.nextPollDueAt && state.nextPollDueAt > now) continue;
    enqueuePoll(acc.id);
  }
}

function enqueuePoll(accountId: string): void {
  try {
    const known = getThreadKnownState(accountId);
    recordPollStarted(accountId);
    startInboxJob({
      accountId,
      mode: 'poll',
      knownThreads: known,
      maxThreads: 50,
      maxMessagesPerThread: 30,
    });
  } catch (err) {
    // Most likely cause: account is busy with another job — try again on the
    // next tick. Don't escalate to error state.
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes('busy')
    ) {
      return;
    }
    console.warn('[inboxScheduler] enqueuePoll failed:', err);
  }
}

export function enqueueBackfill(accountId: string): string | null {
  try {
    return startInboxJob({
      accountId,
      mode: 'backfill',
      maxThreads: 500,
      maxMessagesPerThread: 200,
    });
  } catch (err) {
    console.warn('[inboxScheduler] enqueueBackfill failed:', err);
    return null;
  }
}

interface InboxWorkerResult {
  mode: string;
  threadsScanned?: number;
  threadsWithDeltas?: number;
  messagesAdded?: number;
  deltas?: Array<{
    thread: ParsedThread & { igThreadId: string };
    messages: ParsedMessage[];
  }>;
  igMessageId?: string | null;
  sentAt?: number;
}

async function onJobEvent(evt: JobEvent): Promise<void> {
  if (evt.type !== 'jobs:result') return;
  if (!evt.accountId) return;
  if (
    evt.kind !== 'inbox_poll' &&
    evt.kind !== 'inbox_backfill' &&
    evt.kind !== 'inbox_thread_fetch' &&
    evt.kind !== 'inbox_send'
  )
    return;

  const accountId = evt.accountId;
  const result = (evt.result ?? null) as InboxWorkerResult | null;
  const account = listAccounts().find((a) => a.id === accountId);

  if (evt.kind === 'inbox_send') {
    // Persist the outbound message row using the optimistic data we passed in.
    // The worker returns igMessageId (often null) + sentAt; we look up the
    // job's params to get the original text and thread id.
    // The text/thread were carried in params_json — easiest to get them from
    // a fresh query, but we already have everything we need on the result
    // event chain: we only need to broadcast that the inbox changed.
    if (broadcastFn) broadcastFn('inbox:changed', { accountId, threadIds: [] });
    return;
  }

  if (!result || !Array.isArray(result.deltas)) {
    if (evt.status !== 'cancelled') {
      recordPollResult(accountId, evt.status === 'failed' ? 'error' : 'success', 0, null, Date.now() + scheduleNext(false));
    }
    return;
  }

  const inboundEvents: OnNewInboundEvent[] = [];
  let messagesAdded = 0;
  const touchedThreadIds: string[] = [];

  for (const delta of result.deltas) {
    if (!delta?.thread) continue;
    const threadId = upsertThread(accountId, delta.thread);
    touchedThreadIds.push(threadId);
    if (Array.isArray(delta.messages) && delta.messages.length > 0) {
      // Insert oldest-first so chronological order is preserved.
      const ordered = [...delta.messages].sort((a, b) => a.sentAt - b.sentAt);
      // Detect inbound messages we hadn't seen so we can fire AI responder.
      const beforeThreadHadInbound = false; // simplified — caller fires for each fresh inbound after upsert
      void beforeThreadHadInbound;
      for (const m of ordered) {
        const msgId = upsertMessage(threadId, m, evt.kind === 'inbox_backfill' ? 'backfill' : 'poll');
        messagesAdded += 1;
        if (m.direction === 'in') {
          inboundEvents.push({
            threadId,
            accountId,
            accountUsername: account?.username ?? null,
            messageId: msgId,
            body: m.body,
          });
        }
      }
      // If this thread received any inbound message in this delta, cancel
      // any active follow-up enrollments for it.
      if (delta.messages.some((m) => m.direction === 'in')) {
        cancelOnReply(threadId);
      }
    }
  }

  // Mark sync state.
  const state = listSyncStates().find((s) => s.accountId === accountId);
  const active = state?.activeMonitoring ?? false;
  recordPollResult(
    accountId,
    evt.status === 'failed' ? 'error' : 'success',
    result.threadsScanned ?? 0,
    null,
    Date.now() + scheduleNext(active)
  );

  if (broadcastFn) {
    broadcastFn('inbox:changed', { accountId, threadIds: touchedThreadIds });
    if (inboundEvents.length > 0) {
      broadcastFn('inbox:newInbound', { accountId, count: inboundEvents.length });
    }
    void messagesAdded;
  }

  // Fire AI responder per fresh inbound (only when poller, not backfill — we
  // don't want to spam old leads when a user first connects an account).
  if (evt.kind === 'inbox_poll' && getAiApiKey()) {
    for (const ev of inboundEvents) {
      try {
        const outcome = await handleInboundMessage(ev);
        if (outcome?.kind === 'send') {
          // Auto-send: enqueue a send_message inbox job. Persist the
          // outbound message row optimistically so the UI sees it before the
          // worker confirms.
          const thread = getThread(ev.threadId);
          if (thread) {
            upsertMessage(
              ev.threadId,
              {
                igMessageId: null,
                direction: 'out',
                senderUsername: account?.username ?? 'me',
                body: outcome.body,
                mediaKind: null,
                mediaCaption: null,
                sentAt: Date.now(),
              },
              'ai_responder'
            );
            startInboxJob({
              accountId,
              mode: 'send_message',
              igThreadId: thread.igThreadId,
              text: outcome.body,
            });
            if (broadcastFn) broadcastFn('inbox:changed', { accountId, threadIds: [ev.threadId] });
          }
        } else if (outcome?.kind === 'draft') {
          if (broadcastFn) broadcastFn('inbox:changed', { accountId, threadIds: [ev.threadId] });
        }
      } catch (err) {
        console.error('[inboxScheduler] AI responder failed:', err);
      }
    }
  }

  // Quiet noisy result void — keep settings import semantically tied so the
  // scheduler picks up changes when added later.
  void getAiSettings;
}

// Small helper — manual refresh trigger for "Refresh now" buttons in the UI.
export function refreshAccount(accountId: string): string | null {
  try {
    return startInboxJob({
      accountId,
      mode: 'poll',
      knownThreads: getThreadKnownState(accountId),
      maxThreads: 50,
      maxMessagesPerThread: 30,
    });
  } catch (err) {
    console.warn('[inboxScheduler] refreshAccount failed:', err);
    return null;
  }
}
