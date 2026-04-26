// Wires inbox events → Anthropic → either a draft (suggest mode) or an
// enqueued send (auto mode). Per-account settings + global gates + rate
// limits decide whether each event becomes a reply.

import { getDb } from './db';
import {
  getApiKey,
  getDefaultMode,
  getExcludeKeywords,
  getHistoryDepth,
  getKillSwitch,
  getMaxAiStreak,
  getMinInboundLen,
  getPromptMd,
  getSettings,
  generateReply,
  type ConversationTurn,
  type ResponderMode,
} from './ai';
import {
  clearDraft,
  getThread,
  listMessages,
  setDraft,
} from './inbox';

export const DEFAULT_PROMPT_MD = `# You are responding on behalf of {{account_username}} on Instagram.

## Voice
Friendly, direct, lowercase, no hashtags, no emojis unless the lead used one first. Answers should feel like a busy founder typing on their phone.

## What we sell
<Replace this with a 2-4 paragraph description of your offer, pricing, and ideal customer.>

## How to respond
- If the lead asks for the price, share it directly.
- If the lead is vague ("hi", "info"), ask what they're trying to solve.
- If the lead is hostile or off-topic, reply once politely and stop.
- Never make up case studies, numbers, or guarantees not listed above.
- Keep replies under 60 words.

## When to escalate to a human
If the lead asks for a call, asks a question you can't answer from this prompt, or is clearly close to buying — reply: "let me check on that and get back to you in a bit". Then stop.

## Conversation memory
You will be shown the last {{history_depth}} messages of this thread. Use them; do not repeat anything you've already said.
`;

interface AccountSettingsRow {
  account_id: string;
  enabled: number;
  mode: ResponderMode;
  max_per_hour: number;
  max_per_day: number;
}

export interface AccountAiSettings {
  accountId: string;
  enabled: boolean;
  mode: ResponderMode;
  maxPerHour: number;
  maxPerDay: number;
}

function rowToPublic(row: AccountSettingsRow): AccountAiSettings {
  return {
    accountId: row.account_id,
    enabled: row.enabled !== 0,
    mode: row.mode === 'auto' ? 'auto' : 'suggest',
    maxPerHour: row.max_per_hour,
    maxPerDay: row.max_per_day,
  };
}

export function getAccountSettings(accountId: string): AccountAiSettings {
  const row = getDb()
    .prepare<[string], AccountSettingsRow>(
      `SELECT * FROM ai_responder_account_settings WHERE account_id = ?`
    )
    .get(accountId);
  if (row) return rowToPublic(row);
  // Default row: disabled, suggest mode.
  return {
    accountId,
    enabled: false,
    mode: getDefaultMode(),
    maxPerHour: 10,
    maxPerDay: 50,
  };
}

export function listAccountSettings(): AccountAiSettings[] {
  const rows = getDb()
    .prepare<[], AccountSettingsRow>('SELECT * FROM ai_responder_account_settings')
    .all();
  return rows.map(rowToPublic);
}

export function setAccountSettings(input: AccountAiSettings): AccountAiSettings {
  const existing = getDb()
    .prepare<[string], { c: number }>(
      'SELECT COUNT(*) AS c FROM ai_responder_account_settings WHERE account_id = ?'
    )
    .get(input.accountId);
  const mode: ResponderMode = input.mode === 'auto' ? 'auto' : 'suggest';
  const maxPerHour = Math.max(1, Math.min(100, Math.floor(input.maxPerHour)));
  const maxPerDay = Math.max(1, Math.min(1000, Math.floor(input.maxPerDay)));
  if ((existing?.c ?? 0) > 0) {
    getDb()
      .prepare(
        `UPDATE ai_responder_account_settings
         SET enabled = ?, mode = ?, max_per_hour = ?, max_per_day = ?
         WHERE account_id = ?`
      )
      .run(input.enabled ? 1 : 0, mode, maxPerHour, maxPerDay, input.accountId);
  } else {
    getDb()
      .prepare(
        `INSERT INTO ai_responder_account_settings(account_id, enabled, mode, max_per_hour, max_per_day)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.accountId, input.enabled ? 1 : 0, mode, maxPerHour, maxPerDay);
  }
  return getAccountSettings(input.accountId);
}

interface AiLogRow {
  id: number;
  thread_id: string;
  message_id: string | null;
  status: string;
  reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cost_usd: number | null;
  model: string | null;
  created_at: number;
}

export interface AiLogEntry {
  id: number;
  threadId: string;
  messageId: string | null;
  status: string;
  reason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  model: string | null;
  createdAt: number;
}

function logRowToPublic(row: AiLogRow): AiLogEntry {
  return {
    id: row.id,
    threadId: row.thread_id,
    messageId: row.message_id,
    status: row.status,
    reason: row.reason,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: row.cost_usd,
    model: row.model,
    createdAt: row.created_at,
  };
}

export function listLog(limit = 100): AiLogEntry[] {
  const rows = getDb()
    .prepare<[number], AiLogRow>(
      `SELECT * FROM ai_responder_log ORDER BY created_at DESC LIMIT ?`
    )
    .all(Math.max(1, Math.min(500, limit)));
  return rows.map(logRowToPublic);
}

export interface AiCostSummary {
  monthSentCount: number;
  monthSuggestedCount: number;
  monthCostUsd: number;
}

export function getMonthCostSummary(): AiCostSummary {
  const start = startOfMonth();
  const sent = getDb()
    .prepare<[number], { c: number }>(
      `SELECT COUNT(*) AS c FROM ai_responder_log WHERE status = 'sent' AND created_at >= ?`
    )
    .get(start);
  const sugg = getDb()
    .prepare<[number], { c: number }>(
      `SELECT COUNT(*) AS c FROM ai_responder_log WHERE status = 'suggested' AND created_at >= ?`
    )
    .get(start);
  const cost = getDb()
    .prepare<[number], { c: number | null }>(
      `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_responder_log WHERE created_at >= ?`
    )
    .get(start);
  return {
    monthSentCount: Number(sent?.c) || 0,
    monthSuggestedCount: Number(sugg?.c) || 0,
    monthCostUsd: Number(cost?.c) || 0,
  };
}

function startOfMonth(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function logEvent(entry: {
  threadId: string;
  messageId: string | null;
  status: string;
  reason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  costUsd?: number | null;
  model?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO ai_responder_log(
         thread_id, message_id, status, reason,
         prompt_tokens, completion_tokens, cost_usd, model, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      entry.threadId,
      entry.messageId,
      entry.status,
      entry.reason ?? null,
      entry.promptTokens ?? null,
      entry.completionTokens ?? null,
      entry.costUsd ?? null,
      entry.model ?? null,
      Date.now()
    );
}

function recentReplyCount(accountId: string, sinceMs: number): number {
  const row = getDb()
    .prepare<[string, number], { c: number }>(
      `SELECT COUNT(*) AS c FROM ai_responder_log
       WHERE status IN ('sent','suggested')
         AND created_at >= ?
         AND thread_id IN (SELECT id FROM inbox_threads WHERE account_id = ?)`
    )
    .get(accountId, sinceMs);
  return Number(row?.c) || 0;
}

function consecutiveAiOutbound(threadId: string): number {
  // Walk messages newest-first, count outbound rows with source='ai_responder'
  // until we hit anything else.
  const rows = getDb()
    .prepare<[string], { direction: string; source: string }>(
      `SELECT direction, source FROM inbox_messages
       WHERE thread_id = ?
       ORDER BY sent_at DESC LIMIT 50`
    )
    .all(threadId);
  let n = 0;
  for (const r of rows) {
    if (r.direction === 'out' && r.source === 'ai_responder') n += 1;
    else break;
  }
  return n;
}

export interface OnNewInboundEvent {
  threadId: string;
  accountId: string;
  accountUsername: string | null;
  messageId: string;
  body: string | null;
}

// Decide what to do about a freshly inserted inbound message. Called by the
// inbox sync code right after upsertMessage(). Returns either:
//   - null            → not eligible (gates failed); a 'skipped' log row is written
//   - { kind: 'draft', body, model }
//   - { kind: 'send',  body, model }
export type ResponderOutcome =
  | { kind: 'draft'; body: string; model: string }
  | { kind: 'send'; body: string; model: string }
  | null;

export interface OnInboundOptions {
  // When true, skip rate limit / mode / kill-switch checks and always
  // generate. Used by the manual "Suggest" button in the composer.
  forceSuggest?: boolean;
}

export async function handleInboundMessage(
  evt: OnNewInboundEvent,
  options: OnInboundOptions = {}
): Promise<ResponderOutcome> {
  const apiKey = getApiKey();
  if (!apiKey) {
    if (!options.forceSuggest) return null;
    throw new Error('Anthropic API key is not configured');
  }

  const thread = getThread(evt.threadId);
  if (!thread) return null;

  const acct = getAccountSettings(evt.accountId);

  if (!options.forceSuggest) {
    if (getKillSwitch()) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'kill_switch' });
      return null;
    }
    if (!acct.enabled) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'account_disabled' });
      return null;
    }
    const minLen = getMinInboundLen();
    if ((evt.body ?? '').trim().length < minLen) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'inbound_too_short' });
      return null;
    }
    const lower = (evt.body ?? '').toLowerCase();
    for (const kw of getExcludeKeywords()) {
      if (kw && lower.includes(kw.toLowerCase())) {
        logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: `exclude_keyword:${kw}` });
        return null;
      }
    }
    if (consecutiveAiOutbound(evt.threadId) >= getMaxAiStreak()) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'ai_streak' });
      return null;
    }
    const hourCount = recentReplyCount(evt.accountId, Date.now() - 60 * 60_000);
    if (hourCount >= acct.maxPerHour) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'rate_limit_hour' });
      return null;
    }
    const dayCount = recentReplyCount(evt.accountId, Date.now() - 24 * 60 * 60_000);
    if (dayCount >= acct.maxPerDay) {
      logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'skipped', reason: 'rate_limit_day' });
      return null;
    }
  }

  const settings = getSettings();
  const historyDepth = getHistoryDepth();
  const promptMd = renderPromptTokens(getPromptMd(DEFAULT_PROMPT_MD), {
    accountUsername: evt.accountUsername ?? '',
    historyDepth,
  });

  const recent = listMessages({ threadId: evt.threadId, limit: historyDepth + 1 });
  const tail = recent[recent.length - 1];
  const tailIsCurrent = !!tail && tail.id === evt.messageId;
  const historyMessages = tailIsCurrent ? recent.slice(0, -1) : recent;
  const newMessage = (evt.body ?? '').trim() || (tail?.body ?? '').trim() || '...';

  const history: ConversationTurn[] = historyMessages
    .map((m) => ({
      role: m.direction === 'in' ? ('user' as const) : ('assistant' as const),
      body: (m.body ?? '').trim(),
    }))
    .filter((t) => t.body.length > 0);

  let result;
  try {
    result = await generateReply({
      systemPrompt: promptMd,
      history,
      newMessage,
    });
  } catch (err) {
    logEvent({
      threadId: evt.threadId,
      messageId: evt.messageId,
      status: 'error',
      reason: err instanceof Error ? err.message : String(err),
    });
    if (options.forceSuggest) throw err;
    return null;
  }

  const text = result.text.trim();
  if (!text) {
    logEvent({ threadId: evt.threadId, messageId: evt.messageId, status: 'error', reason: 'empty_response', model: result.model });
    return null;
  }

  const mode: ResponderMode = options.forceSuggest ? 'suggest' : acct.mode;
  if (mode === 'suggest') {
    setDraft(evt.threadId, text, result.model);
    logEvent({
      threadId: evt.threadId,
      messageId: evt.messageId,
      status: 'suggested',
      promptTokens: result.inputTokens,
      completionTokens: result.outputTokens,
      costUsd: result.costUsd,
      model: result.model,
    });
    return { kind: 'draft', body: text, model: result.model };
  }
  // Auto-send mode: caller is responsible for enqueueing the send job.
  logEvent({
    threadId: evt.threadId,
    messageId: evt.messageId,
    status: 'sent',
    promptTokens: result.inputTokens,
    completionTokens: result.outputTokens,
    costUsd: result.costUsd,
    model: result.model,
  });
  // Clear any stale draft now that we're auto-sending.
  clearDraft(evt.threadId);
  return { kind: 'send', body: text, model: result.model };

  void settings; // keep settings import semantically tied to the function
}

function renderPromptTokens(
  md: string,
  vars: { accountUsername: string; historyDepth: number }
): string {
  return md
    .replace(/\{\{\s*account_username\s*\}\}/g, vars.accountUsername)
    .replace(/\{\{\s*history_depth\s*\}\}/g, String(vars.historyDepth));
}
