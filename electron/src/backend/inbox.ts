// Data layer for the unified Inbox. Mirrors the public/private split used in
// jobs.ts and accounts.ts: rows in SQLite stay private to this module, the
// renderer reads typed `*Public` shapes via IPC.

import crypto from 'crypto';
import { getDb } from './db';

export interface InboxThreadPublic {
  id: string;
  accountId: string;
  accountUsername: string | null;
  accountProfilePicUrl: string | null;
  igThreadId: string;
  peerUsername: string;
  peerDisplayName: string | null;
  peerPicUrl: string | null;
  isGroup: boolean;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  isPinned: boolean;
  aiResponderEnabled: boolean;
  followupDisabled: boolean;
  historyBackfilledAt: number | null;
  createdAt: number;
  updatedAt: number;
  draft: { body: string; model: string | null; createdAt: number } | null;
}

export interface InboxMessagePublic {
  id: string;
  threadId: string;
  igMessageId: string | null;
  direction: 'in' | 'out';
  senderUsername: string;
  body: string | null;
  mediaKind: string | null;
  mediaCaption: string | null;
  sentAt: number;
  source: string;
}

export interface InboxSyncStatePublic {
  accountId: string;
  lastPollStartedAt: number | null;
  lastPollFinishedAt: number | null;
  lastPollStatus: string | null;
  lastPollError: string | null;
  threadsSeen: number;
  activeMonitoring: boolean;
  nextPollDueAt: number | null;
}

interface ThreadRow {
  id: string;
  account_id: string;
  account_username: string | null;
  account_profile_pic_url: string | null;
  ig_thread_id: string;
  peer_username: string;
  peer_display_name: string | null;
  peer_pic_url: string | null;
  is_group: number;
  last_message_at: number | null;
  last_message_preview: string | null;
  last_message_from_me: number;
  unread_count: number;
  is_pinned: number;
  ai_responder_enabled: number;
  followup_disabled: number;
  history_backfilled_at: number | null;
  created_at: number;
  updated_at: number;
  draft_body: string | null;
  draft_model: string | null;
  draft_created_at: number | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  ig_message_id: string | null;
  direction: 'in' | 'out';
  sender_username: string;
  body: string | null;
  media_kind: string | null;
  media_caption: string | null;
  sent_at: number;
  source: string;
  created_at: number;
}

interface SyncStateRow {
  account_id: string;
  last_poll_started_at: number | null;
  last_poll_finished_at: number | null;
  last_poll_status: string | null;
  last_poll_error: string | null;
  threads_seen: number;
  active_monitoring: number;
  next_poll_due_at: number | null;
}

const THREAD_SELECT = `
  SELECT
    t.*,
    a.username AS account_username,
    a.profile_pic_url AS account_profile_pic_url,
    d.body AS draft_body,
    d.model AS draft_model,
    d.created_at AS draft_created_at
  FROM inbox_threads t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN inbox_drafts d ON d.thread_id = t.id
`;

function threadRowToPublic(row: ThreadRow): InboxThreadPublic {
  return {
    id: row.id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    accountProfilePicUrl: row.account_profile_pic_url,
    igThreadId: row.ig_thread_id,
    peerUsername: row.peer_username,
    peerDisplayName: row.peer_display_name,
    peerPicUrl: row.peer_pic_url,
    isGroup: row.is_group !== 0,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    lastMessageFromMe: row.last_message_from_me !== 0,
    unreadCount: row.unread_count,
    isPinned: row.is_pinned !== 0,
    aiResponderEnabled: row.ai_responder_enabled !== 0,
    followupDisabled: row.followup_disabled !== 0,
    historyBackfilledAt: row.history_backfilled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    draft:
      row.draft_body != null && row.draft_created_at != null
        ? { body: row.draft_body, model: row.draft_model, createdAt: row.draft_created_at }
        : null,
  };
}

function messageRowToPublic(row: MessageRow): InboxMessagePublic {
  return {
    id: row.id,
    threadId: row.thread_id,
    igMessageId: row.ig_message_id,
    direction: row.direction,
    senderUsername: row.sender_username,
    body: row.body,
    mediaKind: row.media_kind,
    mediaCaption: row.media_caption,
    sentAt: row.sent_at,
    source: row.source,
  };
}

function syncRowToPublic(row: SyncStateRow): InboxSyncStatePublic {
  return {
    accountId: row.account_id,
    lastPollStartedAt: row.last_poll_started_at,
    lastPollFinishedAt: row.last_poll_finished_at,
    lastPollStatus: row.last_poll_status,
    lastPollError: row.last_poll_error,
    threadsSeen: row.threads_seen,
    activeMonitoring: row.active_monitoring !== 0,
    nextPollDueAt: row.next_poll_due_at,
  };
}

export interface ListThreadsArgs {
  accountIds?: string[];
  from?: number | null;
  to?: number | null;
  unreadOnly?: boolean;
  query?: string | null;
  limit?: number;
  offset?: number;
}

export function listThreads(args: ListThreadsArgs = {}): InboxThreadPublic[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (args.accountIds && args.accountIds.length > 0) {
    where.push(`t.account_id IN (${args.accountIds.map(() => '?').join(',')})`);
    params.push(...args.accountIds);
  }
  if (typeof args.from === 'number') {
    where.push('t.last_message_at >= ?');
    params.push(args.from);
  }
  if (typeof args.to === 'number') {
    where.push('t.last_message_at <= ?');
    params.push(args.to);
  }
  if (args.unreadOnly) {
    where.push('t.unread_count > 0');
  }
  if (args.query && args.query.trim()) {
    where.push('(t.peer_username LIKE ? OR t.peer_display_name LIKE ? OR t.last_message_preview LIKE ?)');
    const pat = `%${args.query.trim()}%`;
    params.push(pat, pat, pat);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, args.limit ?? 100));
  const offset = Math.max(0, args.offset ?? 0);

  const rows = getDb()
    .prepare<unknown[], ThreadRow>(
      `${THREAD_SELECT} ${whereClause}
       ORDER BY t.is_pinned DESC, COALESCE(t.last_message_at, 0) DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return rows.map(threadRowToPublic);
}

export function getThread(threadId: string): InboxThreadPublic | null {
  const row = getDb()
    .prepare<[string], ThreadRow>(`${THREAD_SELECT} WHERE t.id = ?`)
    .get(threadId);
  return row ? threadRowToPublic(row) : null;
}

export interface ListMessagesArgs {
  threadId: string;
  limit?: number;
  before?: number | null;
}

export function listMessages(args: ListMessagesArgs): InboxMessagePublic[] {
  const limit = Math.max(1, Math.min(500, args.limit ?? 100));
  const params: unknown[] = [args.threadId];
  let whereExtra = '';
  if (typeof args.before === 'number') {
    whereExtra = ' AND sent_at < ?';
    params.push(args.before);
  }
  const rows = getDb()
    .prepare<unknown[], MessageRow>(
      `SELECT * FROM inbox_messages
       WHERE thread_id = ?${whereExtra}
       ORDER BY sent_at DESC LIMIT ?`
    )
    .all(...params, limit);
  // Return oldest-first for the UI.
  return rows.reverse().map(messageRowToPublic);
}

export function listSyncStates(): InboxSyncStatePublic[] {
  const rows = getDb()
    .prepare<[], SyncStateRow>('SELECT * FROM inbox_sync_state')
    .all();
  return rows.map(syncRowToPublic);
}

export function getSyncState(accountId: string): InboxSyncStatePublic | null {
  const row = getDb()
    .prepare<[string], SyncStateRow>('SELECT * FROM inbox_sync_state WHERE account_id = ?')
    .get(accountId);
  return row ? syncRowToPublic(row) : null;
}

export function setActiveMonitoring(accountId: string, enabled: boolean): void {
  const exists = getDb()
    .prepare<[string], { c: number }>(
      'SELECT COUNT(*) AS c FROM inbox_sync_state WHERE account_id = ?'
    )
    .get(accountId);
  if ((exists?.c ?? 0) > 0) {
    getDb()
      .prepare(
        `UPDATE inbox_sync_state SET active_monitoring = ?, next_poll_due_at = ? WHERE account_id = ?`
      )
      .run(enabled ? 1 : 0, Date.now(), accountId);
  } else {
    getDb()
      .prepare(
        `INSERT INTO inbox_sync_state(account_id, active_monitoring, next_poll_due_at, threads_seen)
         VALUES (?, ?, ?, 0)`
      )
      .run(accountId, enabled ? 1 : 0, Date.now());
  }
}

export function ensureSyncState(accountId: string): void {
  getDb()
    .prepare(
      `INSERT INTO inbox_sync_state(account_id, threads_seen, active_monitoring, next_poll_due_at)
       VALUES (?, 0, 0, ?)
       ON CONFLICT(account_id) DO NOTHING`
    )
    .run(accountId, Date.now());
}

export function setThreadFlags(
  threadId: string,
  flags: { aiResponderEnabled?: boolean; followupDisabled?: boolean; isPinned?: boolean }
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (typeof flags.aiResponderEnabled === 'boolean') {
    sets.push('ai_responder_enabled = ?');
    params.push(flags.aiResponderEnabled ? 1 : 0);
  }
  if (typeof flags.followupDisabled === 'boolean') {
    sets.push('followup_disabled = ?');
    params.push(flags.followupDisabled ? 1 : 0);
  }
  if (typeof flags.isPinned === 'boolean') {
    sets.push('is_pinned = ?');
    params.push(flags.isPinned ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(threadId);
  getDb()
    .prepare(`UPDATE inbox_threads SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params);
}

export interface ParsedThread {
  igThreadId: string;
  peerUsername: string;
  peerDisplayName: string | null;
  peerPicUrl: string | null;
  isGroup: boolean;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
}

export interface ParsedMessage {
  igMessageId: string | null;
  direction: 'in' | 'out';
  senderUsername: string;
  body: string | null;
  mediaKind: string | null;
  mediaCaption: string | null;
  sentAt: number;
}

// Upsert a thread observed by the poll worker. Returns the internal thread id.
export function upsertThread(accountId: string, parsed: ParsedThread): string {
  const composite = `${accountId}:${parsed.igThreadId}`;
  const existing = getDb()
    .prepare<[string], { id: string }>('SELECT id FROM inbox_threads WHERE id = ?')
    .get(composite);
  const now = Date.now();
  if (existing) {
    getDb()
      .prepare(
        `UPDATE inbox_threads SET
           peer_username = ?,
           peer_display_name = ?,
           peer_pic_url = ?,
           is_group = ?,
           last_message_at = ?,
           last_message_preview = ?,
           last_message_from_me = ?,
           unread_count = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        parsed.peerUsername,
        parsed.peerDisplayName,
        parsed.peerPicUrl,
        parsed.isGroup ? 1 : 0,
        parsed.lastMessageAt,
        parsed.lastMessagePreview,
        parsed.lastMessageFromMe ? 1 : 0,
        parsed.unreadCount,
        now,
        composite
      );
    return composite;
  }
  getDb()
    .prepare(
      `INSERT INTO inbox_threads(
         id, account_id, ig_thread_id, peer_username, peer_display_name, peer_pic_url,
         is_group, last_message_at, last_message_preview, last_message_from_me,
         unread_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      composite,
      accountId,
      parsed.igThreadId,
      parsed.peerUsername,
      parsed.peerDisplayName,
      parsed.peerPicUrl,
      parsed.isGroup ? 1 : 0,
      parsed.lastMessageAt,
      parsed.lastMessagePreview,
      parsed.lastMessageFromMe ? 1 : 0,
      parsed.unreadCount,
      now,
      now
    );
  return composite;
}

// Upsert a message observed by the poll worker. When ig_message_id is null we
// dedup by (thread_id, sent_at, body) hash to avoid double-inserting on
// repeated polls.
export function upsertMessage(
  threadId: string,
  parsed: ParsedMessage,
  source: 'poll' | 'backfill' | 'self_send' | 'ai_responder' | 'followup'
): string {
  const id = parsed.igMessageId
    ? `${threadId}:${parsed.igMessageId}`
    : `${threadId}:${parsed.sentAt}:${crypto
        .createHash('sha256')
        .update(`${parsed.direction}|${parsed.body ?? ''}|${parsed.mediaKind ?? ''}`)
        .digest('hex')
        .slice(0, 12)}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO inbox_messages(
         id, thread_id, ig_message_id, direction, sender_username, body,
         media_kind, media_caption, sent_at, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(
      id,
      threadId,
      parsed.igMessageId,
      parsed.direction,
      parsed.senderUsername,
      parsed.body,
      parsed.mediaKind,
      parsed.mediaCaption,
      parsed.sentAt,
      source,
      now
    );
  return id;
}

export function recordPollResult(
  accountId: string,
  status: 'success' | 'error' | 'cancelled',
  threadsSeen: number,
  errorMsg: string | null,
  nextDueAt: number | null
): void {
  ensureSyncState(accountId);
  getDb()
    .prepare(
      `UPDATE inbox_sync_state SET
         last_poll_finished_at = ?,
         last_poll_status = ?,
         last_poll_error = ?,
         threads_seen = ?,
         next_poll_due_at = ?
       WHERE account_id = ?`
    )
    .run(Date.now(), status, errorMsg, threadsSeen, nextDueAt, accountId);
}

export function recordPollStarted(accountId: string): void {
  ensureSyncState(accountId);
  getDb()
    .prepare(
      `UPDATE inbox_sync_state SET last_poll_started_at = ? WHERE account_id = ?`
    )
    .run(Date.now(), accountId);
}

export function getThreadKnownState(accountId: string): Array<{ igThreadId: string; lastMessageAt: number | null }> {
  const rows = getDb()
    .prepare<[string], { ig_thread_id: string; last_message_at: number | null }>(
      `SELECT ig_thread_id, last_message_at FROM inbox_threads WHERE account_id = ?`
    )
    .all(accountId);
  return rows.map((r) => ({ igThreadId: r.ig_thread_id, lastMessageAt: r.last_message_at }));
}

export function getLastInboundMessage(threadId: string): InboxMessagePublic | null {
  const row = getDb()
    .prepare<[string], MessageRow>(
      `SELECT * FROM inbox_messages WHERE thread_id = ? AND direction = 'in' ORDER BY sent_at DESC LIMIT 1`
    )
    .get(threadId);
  return row ? messageRowToPublic(row) : null;
}

export function setDraft(threadId: string, body: string, model: string | null): void {
  if (!body || body.trim().length === 0) {
    getDb().prepare(`DELETE FROM inbox_drafts WHERE thread_id = ?`).run(threadId);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO inbox_drafts(thread_id, body, model, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET body = excluded.body, model = excluded.model, created_at = excluded.created_at`
    )
    .run(threadId, body, model, Date.now());
}

export function clearDraft(threadId: string): void {
  getDb().prepare(`DELETE FROM inbox_drafts WHERE thread_id = ?`).run(threadId);
}
