// Follow-up sequence scheduler: walks active enrollments due to fire,
// resolves a message variant, and enqueues a send via inbox or mass_dm.
// Cancel-on-reply happens in inboxScheduler (when a fresh inbound message
// is observed it calls cancelOnReply on this thread).

import {
  advanceEnrollment,
  getDueEnrollments,
  getSequence,
  getVariantBody,
} from './followups';
import { getAccount } from './accounts';
import { getDb } from './db';
import { startInboxJob } from './jobs';
import { getThread } from './inbox';

const TICK_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startFollowupScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  setImmediate(() => { void tick(); });
}

export function stopFollowupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick(): Promise<void> {
  const due = getDueEnrollments(Date.now(), 50);
  for (const e of due) {
    try {
      await dispatch(e);
    } catch (err) {
      console.error('[followupScheduler] dispatch failed:', err);
    }
  }
}

interface DueRow {
  id: string;
  sequence_id: string;
  account_id: string;
  thread_id: string | null;
  peer_username: string;
  current_step_index: number;
  enrolled_at: number;
  last_step_run_at: number | null;
}

async function dispatch(e: DueRow): Promise<void> {
  const account = getAccount(e.account_id);
  if (!account) {
    advanceEnrollment(e as any, 'failed', null, 'account_missing');
    return;
  }

  const seq = getSequence(e.sequence_id);
  const step = seq?.steps[e.current_step_index];
  if (!step) {
    advanceEnrollment(e as any, 'failed', null, 'step_missing');
    return;
  }

  // Cancel-on-reply: if we have a thread and any inbound message was
  // received after the prior step ran (or after enrollment when this is the
  // first follow-up), respect stop_on_reply.
  if (step.stopOnReply && e.thread_id) {
    const since = e.last_step_run_at ?? e.enrolled_at;
    const replied = getDb()
      .prepare<[string, number], { c: number }>(
        `SELECT COUNT(*) AS c FROM inbox_messages WHERE thread_id = ? AND direction = 'in' AND sent_at >= ?`
      )
      .get(e.thread_id, since);
    if ((replied?.c ?? 0) > 0) {
      advanceEnrollment(e as any, 'skipped', null, 'lead_replied');
      return;
    }
  }

  // Pick a random variant id and resolve to body text.
  const variantIds = step.variantIds;
  if (variantIds.length === 0) {
    advanceEnrollment(e as any, 'failed', null, 'no_variants');
    return;
  }
  const variantId = variantIds[Math.floor(Math.random() * variantIds.length)]!;
  const body = getVariantBody(variantId);
  if (!body) {
    advanceEnrollment(e as any, 'failed', variantId, 'variant_missing');
    return;
  }
  // Soft-substitute the username token.
  const text = body.replace(/\{\{\s*username\s*\}\}/g, e.peer_username);

  // Resolve thread_id: if not yet known, try by (accountId, peerUsername).
  let threadIgId: string | null = null;
  if (e.thread_id) {
    const t = getThread(e.thread_id);
    if (t) threadIgId = t.igThreadId;
  }
  if (!threadIgId) {
    const row = getDb()
      .prepare<[string, string], { ig_thread_id: string }>(
        `SELECT ig_thread_id FROM inbox_threads WHERE account_id = ? AND lower(peer_username) = lower(?) ORDER BY last_message_at DESC LIMIT 1`
      )
      .get(e.account_id, e.peer_username);
    threadIgId = row?.ig_thread_id ?? null;
  }
  if (!threadIgId) {
    // No thread to send into yet — skip this tick, retry in 1h.
    getDb()
      .prepare(`UPDATE followup_enrollments SET next_run_at = ? WHERE id = ?`)
      .run(Date.now() + 60 * 60_000, e.id);
    return;
  }

  try {
    startInboxJob({
      accountId: e.account_id,
      mode: 'send_message',
      igThreadId: threadIgId,
      text,
    });
    advanceEnrollment(e as any, 'sent', variantId, null);
  } catch (err) {
    advanceEnrollment(e as any, 'failed', variantId, err instanceof Error ? err.message : String(err));
  }
}
