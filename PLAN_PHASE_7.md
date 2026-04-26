# B2DM — Phase 7 Plan: Inbox, AI Auto-Responder, Follow-up, Stories

> Continuation of `PLAN.md` (which ended at Phase 6 — Build & Distribution).
> This document covers four new feature areas, layered on top of the existing
> Electron + Playwright + SQLite base. They are intentionally interlinked:
> the Inbox is the storage and UI layer, the AI Responder reads/writes against
> it, the Follow-up engine consumes its events, and Stories is a Playwright
> primitive reused by Warmup and the pre-DM "warm touch" step.
>
> **Out of scope (per user decision):** anything tied to the existing `leads`
> / `categories` tables. New features must NOT depend on them; they can stay
> in the codebase but won't be extended.

---

## 0. Executive summary

Four new feature areas, in this order of dependency:

1. **Phase 7 — Unified Inbox.** A single conversation surface across every
   Instagram account the user has connected. Background polling pulls thread
   lists and messages into SQLite; UI reads from SQLite. Critically: when a
   user adds an IG account, we **backfill the existing thread history** so
   no past conversations are lost.
2. **Phase 8 — AI Auto-Responder.** BYO Anthropic API key. Per-account
   toggle. User edits a single Markdown system prompt in-app. When a new
   inbound message arrives in the Inbox, the responder builds a context
   window from the last N messages of the thread, calls the Claude API, and
   sends the reply through the same Playwright session. Includes a "suggest
   only" mode (drafts go to the composer; user reviews and sends).
3. **Phase 9 — Follow-up Engine.** A new screen lets the user define
   sequences ("if no reply in N days after a cold DM, send variant X; if
   still no reply at day N+M, send variant Y; cancel sequence on any reply").
   Patterned after ColdDMs / Dripify multi-step sequences.
4. **Phase 10 — Stories.** Two complementary capabilities: (a) view own-feed
   stories as an additional Warmup action, (b) optional "view target's
   stories" pre-DM warm-touch step in MassDM and as a standalone job.

Total estimated work: ~4–6 weeks, sequenced so each phase ships independently.

---

## 1. Architecture decisions (cross-phase)

### 1.1 Polling, not push
Instagram does not expose a public real-time event stream for personal /
creator accounts. The Inbox uses **scheduled Playwright polling** per
account. Cadence: every 3–10 minutes per account with ±25% jitter. The
user can mark accounts as "Active monitoring" to drop their cadence to
~60–90 s. Inactive accounts can be refreshed manually from the UI.

### 1.2 Workers, not long-lived browsers
Reuse the existing `child_process.fork` pattern from `electron/src/backend/jobs.ts`.
Each poll spawns a short-lived worker that opens Chromium with the account's
cookies, hits `/direct/inbox/`, parses the thread list, optionally pulls
deltas for changed threads, then exits. This keeps RAM bounded and respects
the per-account `status='busy'` lock that already exists in `accounts.ts`.

**Exception**: when the user has a thread open in the UI, optionally keep a
worker warm for that single account so reply send latency is low. Auto-close
after 2 minutes of inactivity.

### 1.3 SQLite is the source of truth
The renderer never waits on Playwright. It reads from SQLite via IPC and
subscribes to `inbox:changed` broadcasts emitted whenever a poll/sync
completes. This keeps the UI snappy and offline-tolerant.

### 1.4 Encryption
The Anthropic API key, OAuth tokens, and message bodies in the Inbox are
treated as sensitive. API key uses the existing `safeStorage`-backed AES-GCM
helper in `electron/src/backend/crypto.ts`. Message bodies in `inbox_messages`
are stored as plaintext for now (already inside the user's encrypted
SQLite-on-encrypted-disk on macOS; Windows is the gap — revisit if a user
demands at-rest encryption of the message table).

### 1.5 Rate limiting and safety
Every automated action that touches IG (poll, AI reply, follow-up send,
story view) must:
- Respect the per-account `status='busy'` lock (no two workers per account).
- Respect `windowSlots` (existing per-account allowed-hours config).
- Apply jitter (±25%) to any delay.
- Honor a global "kill switch" in Settings ("Pause all automation").
- Log to `jobs` table with `kind` indicating which subsystem (e.g.,
  `inbox_poll`, `ai_reply`, `followup_send`, `story_view`).

---

## 2. Phase 7 — Unified Inbox

### 2.1 Goal

> The user opens **Inbox** in the sidebar, sees a list of every conversation
> across every connected account, can filter by account or date, opens any
> thread to read its full history, and (Phase 7.4) can type and send a reply.

### 2.2 SQLite schema additions

```sql
-- Migration N+1
CREATE TABLE inbox_threads (
  id TEXT PRIMARY KEY,                 -- composite: account_id + ':' + ig_thread_id
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ig_thread_id TEXT NOT NULL,          -- IG's internal thread id, scraped from URL/DOM
  peer_username TEXT NOT NULL,         -- single peer for 1:1; first peer for groups
  peer_display_name TEXT,
  peer_pic_url TEXT,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,             -- ms epoch of most recent message we've seen
  last_message_preview TEXT,           -- first ~140 chars of last message
  last_message_from_me INTEGER NOT NULL DEFAULT 0,
  unread_count INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  ai_responder_enabled INTEGER NOT NULL DEFAULT 0,  -- per-thread override (Phase 8)
  followup_disabled INTEGER NOT NULL DEFAULT 0,     -- block follow-ups for this thread
  history_backfilled_at INTEGER,       -- ms epoch when full backfill last ran
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_id, ig_thread_id)
);
CREATE INDEX idx_inbox_threads_account_lastmsg
  ON inbox_threads(account_id, last_message_at DESC);
CREATE INDEX idx_inbox_threads_unread
  ON inbox_threads(unread_count) WHERE unread_count > 0;

CREATE TABLE inbox_messages (
  id TEXT PRIMARY KEY,                 -- composite: thread_id + ':' + ig_msg_id (or hash if no id)
  thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  ig_message_id TEXT,                  -- IG's id when scrapeable; nullable
  direction TEXT NOT NULL,             -- 'in' | 'out'
  sender_username TEXT NOT NULL,       -- echo of peer or our account.username
  body TEXT,                           -- text; null for media-only
  media_kind TEXT,                     -- null | 'image' | 'video' | 'voice' | 'reel' | 'story_reply' | 'unsupported'
  media_caption TEXT,                  -- e.g., reel caption, story preview text
  sent_at INTEGER NOT NULL,            -- ms epoch as best we can resolve
  source TEXT NOT NULL,                -- 'poll' | 'backfill' | 'self_send' | 'ai_responder' | 'followup'
  created_at INTEGER NOT NULL,
  UNIQUE(thread_id, ig_message_id)     -- when ig_message_id is null, dedup uses (thread_id, sent_at, body) hash
);
CREATE INDEX idx_inbox_messages_thread_sent
  ON inbox_messages(thread_id, sent_at ASC);

-- Tracks each poll execution so we can show "last synced N min ago" and
-- detect accounts that haven't polled in a long time.
CREATE TABLE inbox_sync_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_poll_started_at INTEGER,
  last_poll_finished_at INTEGER,
  last_poll_status TEXT,               -- 'success' | 'error' | 'cancelled'
  last_poll_error TEXT,
  threads_seen INTEGER NOT NULL DEFAULT 0,
  active_monitoring INTEGER NOT NULL DEFAULT 0,
  next_poll_due_at INTEGER             -- ms epoch; scheduler reads this
);
```

### 2.3 Worker: `inbox.ts`

New file: `electron/src/backend/workers/inbox.ts`. Init payload:

```ts
interface InboxPollInit {
  jobId: string;
  secrets: AccountSecrets;            // existing type
  mode: 'poll' | 'backfill' | 'thread_fetch';
  // poll: refresh thread list, pull deltas for any thread whose last_message_at advanced
  // backfill: full history walk for a freshly-added account (Phase 7.5)
  // thread_fetch: pull messages for one specific thread on demand from UI
  threadId?: string;                  // required for 'thread_fetch'
  knownThreads?: Array<{               // required for 'poll'
    igThreadId: string;
    lastMessageAt: number | null;
  }>;
  maxThreads?: number;                 // default 50 for poll, 500 for backfill
  maxMessagesPerThread?: number;       // default 30 for poll, 200 for backfill
}
```

Worker flow (poll mode):
1. `launchBrowser` (reuse `workers/lib.ts` helper) with account cookies + proxy.
2. Navigate to `https://www.instagram.com/direct/inbox/`.
3. Wait for thread list to render. Parse via DOM selectors:
   - thread `<a href="/direct/t/{ig_thread_id}/">` for the id
   - peer username + display name + pic
   - last-message preview snippet
   - unread badge presence + count
   - timestamp ("3h", "Yesterday", "Mar 12") — resolve to absolute ms via the account's timezone.
4. Diff against `knownThreads` from init. For each thread whose preview or
   timestamp changed (or is new), open the thread page, scroll up until the
   last-known-message-id is found OR `maxMessagesPerThread` is reached.
5. Stream parsed messages back via `process.send({ type: 'thread_delta', threadId, messages: [...] })`.
6. Emit `{ type: 'result', payload: { threadsScanned, messagesAdded } }`.

Worker flow (backfill mode):
- Same as poll, but ignores `knownThreads` and walks every visible thread,
  scrolling each thread to its top within `maxMessagesPerThread`.

Worker flow (thread_fetch mode):
- Open one thread URL, fully scroll up, return all messages.

### 2.4 Selector strategy and brittleness

IG changes the inbox DOM regularly. Mitigation:

- Encapsulate all inbox-specific selectors and parsing in a single module:
  `electron/src/backend/workers/ig/inbox.ts` (alongside the existing
  `profile.ts`, `post.ts`, `search.ts`). Nothing outside this module knows
  the DOM shape.
- Where possible, intercept the network responses (`page.on('response', ...)`)
  for IG's internal GraphQL/JSON inbox feeds and parse JSON instead of DOM.
  This is far more stable. Use DOM only as a fallback.
- Add a tiny fixture-based test suite (HTML snapshots saved from a real
  account, redacted) so regressions can be caught locally without burning
  a real session.

### 2.5 Backfill on account add (CRITICAL)

This is a hard requirement from the user: when they connect a new IG account,
**all existing chat history must be ingested** — they don't want to lose
historical context.

Flow:

1. User completes the existing Add Account flow (`workers/login.ts`).
2. On successful insert into `accounts`, the main process automatically
   enqueues an `inbox_backfill` job for that account.
3. The backfill worker walks every thread visible in `/direct/inbox/`
   (default cap: 500 threads) and pulls up to `maxMessagesPerThread` (default
   200) per thread.
4. UI shows a non-blocking banner on the Inbox screen: "Importing chat
   history for @username — N of M threads done". Other accounts stay
   usable.
5. On completion, set `inbox_threads.history_backfilled_at = now` for every
   thread of that account.
6. The backfill is idempotent: rerunning it just upserts.

Caveats:
- Threads with thousands of messages will hit the 200-cap. Add a
  per-thread "Load more history" button in the UI that triggers a one-off
  `thread_fetch` with a higher cap.
- Media in old messages: store metadata (`media_kind`, `media_caption`) but
  don't download files. The UI shows a placeholder.

### 2.6 Scheduler

New module: `electron/src/backend/inboxScheduler.ts`. On `app.ready`:

- Start a single `setInterval` tick at 30 s.
- Each tick: read `inbox_sync_state` rows where `next_poll_due_at <= now`
  AND the account's `status = 'idle'`. For each such account, enqueue a
  poll job.
- After enqueueing, set `next_poll_due_at = now + base ± jitter`, where
  `base` is 90 s for `active_monitoring=1` accounts, 5 min otherwise (both
  user-configurable in Settings).
- Skip accounts that are paused (per-account toggle) or under the global
  kill switch.

### 2.7 IPC surface

Add to `electron/src/backend/ipc/handlers.ts`:

| Channel | Direction | Payload |
|---|---|---|
| `inbox:list-threads` | invoke | `{ accountIds?: string[]; from?: number; to?: number; unreadOnly?: boolean; query?: string; limit?: number; offset?: number }` → `Thread[]` |
| `inbox:get-thread` | invoke | `{ threadId: string; limit?: number; before?: number }` → `{ thread: Thread; messages: Message[] }` |
| `inbox:refresh-account` | invoke | `{ accountId: string }` → enqueues a poll job; returns `jobId` |
| `inbox:fetch-thread` | invoke | `{ threadId: string; maxMessages?: number }` → enqueues `thread_fetch`; returns `jobId` |
| `inbox:set-active-monitoring` | invoke | `{ accountId: string; enabled: boolean }` |
| `inbox:set-thread-flags` | invoke | `{ threadId: string; flags: { aiResponderEnabled?: boolean; followupDisabled?: boolean; isPinned?: boolean } }` |
| `inbox:send-message` | invoke | `{ threadId: string; text: string }` → enqueues a send job; returns `jobId` |
| `inbox:changed` | broadcast | `{ accountId?: string; threadIds?: string[] }` |

Renderer wrapper lives in `src/lib/electron.ts` (extend the existing `b2dm.*` namespace).

### 2.8 UI: `Inbox.tsx`

New screen at `src/screens/Inbox.tsx`. Three-pane layout matching the rest
of the app's Tailwind look:

- **Left rail (240 px)**: account list with avatars, unread badges, "Active
  monitoring" pill, last-sync timestamp, and a "All inboxes" entry at the top.
- **Middle pane (~360 px)**: thread list, virtualized, sorted by
  `last_message_at` desc. Each row: peer avatar, peer handle, account-of-mine
  chip (small), last-message preview (italic if outbound), timestamp, unread
  dot. Top of pane has filters:
  - Date range picker (from / to) — required by user.
  - Unread only toggle.
  - Free-text search (case-insensitive `LIKE` on `peer_username` +
    `last_message_preview` for v1; FTS later if needed).
- **Right pane (flex)**: opened conversation. iMessage-style bubbles
  (outbound right, inbound left). Sticky composer at the bottom with:
  - Plain textarea
  - Send button (Phase 7.4)
  - "AI Suggest" button (Phase 8) — disabled until that phase ships.
  - "..." menu: pin thread, disable AI for this thread, disable follow-ups
    for this thread.
- Empty states: clear copy when (a) no accounts connected, (b) account is
  still backfilling, (c) account is paused.

### 2.9 Sending messages (Phase 7.4)

New worker mode in `inbox.ts`: `'send_message'`. Init payload:
`{ threadId, text }`. Worker opens the thread URL, focuses the composer,
types with realistic delays (50–120 ms per char with jitter), submits,
parses the resulting outbound message off the DOM to capture its
`ig_message_id` + `sent_at`, inserts into `inbox_messages` with
`source='self_send'`, returns.

The renderer optimistically appends the outbound message with `source='self_send'`
and `id` prefixed `pending:`. On send-complete it replaces the pending row.
On failure it marks the row with an error indicator and offers retry.

### 2.10 Acceptance criteria

- Adding a new IG account triggers a backfill that imports historical threads
  visible in `/direct/inbox/` within the cap; UI banner reflects progress;
  completion sets `history_backfilled_at` on all backfilled threads.
- With two accounts active, polling at the default cadence updates threads
  in both, and the UI reflects new messages within ~one poll cycle.
- Filters by account and by date narrow the thread list correctly.
- Sending a message from the composer reaches the peer's IG inbox and the
  outbound message appears persisted in our DB.
- Killing the app mid-poll leaves no stuck `accounts.status='busy'` row on
  next launch (reconciliation already runs in `jobs.ts`).

---

## 3. Phase 8 — AI Auto-Responder

### 3.1 Goal

> User pastes their Anthropic API key in Settings. They open the
> **Auto-Responder** screen, see a Markdown editor pre-populated with a
> default prompt, edit it freely, save. Per-account (and per-thread) toggle
> turns the responder on. When a new inbound message arrives, the responder
> drafts a reply using the prompt + last N messages of that thread + the
> new message, then either (a) sends it automatically, or (b) saves it as
> a "Suggested" draft visible in the composer.

### 3.2 Anthropic SDK integration

Use `@anthropic-ai/sdk` in the main process (Node). We support the three
current Claude 4.x models (as of 2026-04-26):

| Model id | Label in UI | When to pick |
|---|---|---|
| `claude-sonnet-4-6` | **Sonnet 4.6 (default)** | Balanced quality/cost. Right default for DM replies. |
| `claude-opus-4-7` | **Opus 4.7 (highest quality)** | Use when the user has a complex sales prompt and wants the strongest reasoning. ~5x cost vs Sonnet. |
| `claude-haiku-4-5-20251001` | **Haiku 4.5 (fastest, cheapest)** | High-volume accounts with simple replies. ~5x cheaper vs Sonnet. |

The list of supported models lives in `electron/src/backend/ai/anthropic.ts`
as a const array with `{ id, label, inputCostPerMTok, outputCostPerMTok }`
so the cost estimator and dropdown stay in sync. When Anthropic ships a
newer model, update this one file.

Request shape (illustrative, real call lives in `electron/src/backend/aiResponder.ts`):

```ts
const response = await client.messages.create({
  model: settings.model,
  max_tokens: 400,                    // DM-appropriate; settings-overridable
  system: [
    {
      type: 'text',
      text: USER_PROMPT_MD,            // the user's editable Markdown prompt
      cache_control: { type: 'ephemeral' },  // prompt caching: see §3.5
    },
  ],
  messages: buildMessageHistory(threadId, settings.historyDepth),
});
```

`buildMessageHistory` reads the last `historyDepth` rows from
`inbox_messages` (oldest first), maps `direction='in'` → `role: 'user'`,
`direction='out'` → `role: 'assistant'`. Anthropic requires alternating
roles; collapse consecutive same-role messages by joining their bodies with
a separator. The most recent inbound message is the one we're responding to.

### 3.3 BYO API key UX

In `Settings.tsx`, add an "AI Provider" section:

- API key input (password-masked, with "Show" toggle).
- "Test connection" button: makes a 1-token call to validate the key
  (`messages.create` with `max_tokens: 1` and a one-word user message).
  Shows ✓ + the model id on success, the API error verbatim on failure.
- Model dropdown — exactly the three options listed in §3.2 (Sonnet 4.6
  selected by default).
- "Default max tokens" number input (range 50–1500, default 400).
- Cost estimator: shows current Anthropic per-million-token pricing for the
  selected model and a rough "~$X / 1000 replies at avg 600 input + 300
  output tokens".
- Storage: encrypted via `crypto.ts`, persisted to `meta.api_key_anthropic`.

(Future-proofing: scaffold the provider abstraction now —
`electron/src/backend/ai/index.ts` exports `getProvider(): AiProvider` with
the Anthropic implementation in `electron/src/backend/ai/anthropic.ts`. When
we add OpenAI later it's a sibling file, not a refactor.)

### 3.4 The Markdown prompt editor

New screen: `src/screens/AutoResponder.tsx`. Layout:

- Top toolbar: "Save", "Preview" toggle, "Reset to default", "Test draft"
  (opens a side panel where the user pastes a sample inbound message and
  sees what the AI would reply).
- Main pane: a Markdown editor. Use `@uiw/react-md-editor` (already
  ecosystem-friendly, has split preview, supports themes). No fancy schema
  — the prompt is just freeform Markdown that the user writes for their
  own business voice.
- Default prompt template (shipped in `src/screens/AutoResponder.defaults.ts`):

  ```markdown
  # You are responding on behalf of {{account_username}} on Instagram.

  ## Voice
  Friendly, direct, lowercase, no hashtags, no emojis unless the lead used
  one first. Answers should feel like a busy founder typing on their phone.

  ## What we sell
  <Replace this with a 2-4 paragraph description of your offer, pricing,
  and ideal customer.>

  ## How to respond
  - If the lead asks for the price, share it directly.
  - If the lead is vague ("hi", "info"), ask what they're trying to solve.
  - If the lead is hostile or off-topic, reply once politely and stop.
  - Never make up case studies, numbers, or guarantees not listed above.
  - Keep replies under 60 words.

  ## When to escalate to a human
  If the lead asks for a call, asks a question you can't answer from this
  prompt, or is clearly close to buying — reply: "let me check on that and
  get back to you in a bit". Then stop.

  ## Conversation memory
  You will be shown the last {{history_depth}} messages of this thread.
  Use them; do not repeat anything you've already said.
  ```

- The `{{account_username}}` and `{{history_depth}}` tokens are substituted
  server-side at request time.
- Storage: `meta.ai_prompt_md` (TEXT). Single global prompt for v1; per-account
  prompts are a clean follow-up that just adds a `prompt_overrides` table.

### 3.5 Settings exposed in the AutoResponder screen

Below the editor, a settings card:

- **History depth** (slider, 4–40, default 12) — how many prior messages of
  the thread to include as context.
- **Mode** (radio): `Suggest only` / `Auto-send`. Default `Suggest only`.
- **Auto-send rate limit**: max replies per account per hour (default 10),
  per day (default 50), min seconds between replies on the same account
  (default 90 s, jitter ±50 %).
- **Allowed hours**: reuse the existing `windowSlots` per-account schedule.
- **Don't auto-respond if**:
  - Last inbound message is shorter than N characters (default 2).
  - Inbound message contains any of these keywords (textarea, one per line)
    — for opt-out / unsubscribe phrases.
  - Thread has had more than N AI replies in a row without a human-edited
    one (default 5; prevents runaway loops if the lead keeps replying).

### 3.6 Trigger pipeline

When the inbox poller inserts a new `inbox_messages` row with
`direction='in'`, it emits `inbox:new-inbound` on the internal event bus
with `{ threadId, accountId, messageId }`. The AI responder subscribes:

1. Check global AI on/off, account on/off, thread on/off, allowed hours,
   rate limits, exclusion keywords. If any check fails, drop the event.
2. Build the request (system prompt + history + new message).
3. Call Anthropic. On error: log to `ai_responder_log` table, emit
   `ai_responder:error` for the UI toast, do not retry automatically (avoid
   bill spikes).
4. On success:
   - **Suggest mode**: store the draft in a new `inbox_drafts` table
     (`thread_id PRIMARY KEY, body TEXT, model TEXT, created_at INTEGER`).
     UI shows it pre-filled in the composer with a "Suggested by AI" pill;
     the user can edit / delete / send.
   - **Auto-send mode**: enqueue a `send_message` job. Tag the resulting
     `inbox_messages` row with `source='ai_responder'`.

### 3.7 Schema additions (Phase 8)

```sql
CREATE TABLE ai_responder_account_settings (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'suggest', -- 'suggest' | 'auto'
  max_per_hour INTEGER NOT NULL DEFAULT 10,
  max_per_day INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE ai_responder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                -- 'sent' | 'suggested' | 'skipped' | 'error'
  reason TEXT,                          -- e.g., 'rate_limit', 'allowed_hours', 'kill_switch', exception text
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  cost_usd REAL,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_log_thread ON ai_responder_log(thread_id, created_at DESC);

CREATE TABLE inbox_drafts (
  thread_id TEXT PRIMARY KEY REFERENCES inbox_threads(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  model TEXT,
  created_at INTEGER NOT NULL
);
```

### 3.8 Cost visibility

The AutoResponder screen shows a small footer: "This month: N replies sent /
M suggested · ~$X.XX". Computed from `ai_responder_log` rows in the current
calendar month.

### 3.9 Acceptance criteria

- User saves an Anthropic key, hits "Test connection", sees ✓.
- User edits the Markdown prompt, saves, reloads the screen, sees the
  edited content preserved.
- With AI enabled in `suggest` mode on Account A, when Account A receives
  a new inbound DM, a draft appears in the composer for that thread within
  one poll cycle, tagged "Suggested by AI".
- Switching to `auto` mode causes the same flow to send automatically; the
  outbound message is recorded with `source='ai_responder'`.
- Rate limits hold: configuring 2 replies/hour and triggering 5 inbound
  messages results in 2 AI sends and 3 `skipped: rate_limit` log rows.

---

## 4. Phase 9 — Follow-up Engine

### 4.1 Competitor patterns to copy

Reviewed: ColdDMs (up to 10 steps, 15 variants per step), Dripify (LinkedIn,
multi-step sequences with branching on reply), InstantFlow (timed
follow-ups, reply-stop). Common, well-validated shape:

- A **Sequence** is an ordered list of **Steps**.
- Each Step has: a delay-from-previous-step (in days/hours), a message body
  (or a list of variants — pick one at random per send), and conditions:
  - Send only if the lead has not replied since the previous step.
  - Optional: send only if the lead has not viewed the previous DM (we
    don't have read receipts reliably, so omit for v1).
- A Sequence is enrolled when a user runs a MassDM job, or manually per
  thread from the Inbox ("Enroll in sequence...").
- Any inbound message in an enrolled thread cancels the sequence.
- The user can pause / resume / cancel a sequence per-enrollment.

### 4.2 SQLite schema

```sql
CREATE TABLE followup_sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE followup_steps (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,         -- 0-based; 0 is the cold DM itself when used in MassDM, else 0 is first follow-up
  delay_hours INTEGER NOT NULL,        -- offset from previous step (or from enrollment for index 0)
  variant_ids_json TEXT NOT NULL,      -- JSON array of message_variants.id; worker picks one at random
  stop_on_reply INTEGER NOT NULL DEFAULT 1,
  UNIQUE(sequence_id, step_index)
);

CREATE TABLE followup_enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES inbox_threads(id) ON DELETE SET NULL,
  peer_username TEXT NOT NULL,         -- redundant w/ thread.peer_username for resilience
  current_step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'completed' | 'cancelled' | 'replied'
  enrolled_at INTEGER NOT NULL,
  next_run_at INTEGER NOT NULL,        -- ms epoch the scheduler watches
  last_step_run_at INTEGER,
  cancelled_reason TEXT
);
CREATE INDEX idx_followup_due ON followup_enrollments(status, next_run_at)
  WHERE status = 'active';

CREATE TABLE followup_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id TEXT NOT NULL REFERENCES followup_enrollments(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  variant_id TEXT,
  message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL,                -- 'sent' | 'failed' | 'skipped'
  reason TEXT,
  ran_at INTEGER NOT NULL
);
```

Reuse existing `messageVariants` table for the actual message bodies; a
step references variant ids, doesn't store the text itself.

### 4.3 Scheduler

New module: `electron/src/backend/followupScheduler.ts`. Same pattern as
the inbox scheduler: 30 s tick, picks `followup_enrollments` rows where
`status='active' AND next_run_at <= now`, checks the account is `idle`,
checks `windowSlots`, then:

1. Look up `followup_steps` for the sequence at `current_step_index`.
2. Pick one variant at random from `variant_ids_json`.
3. Verify "no reply since enrollment / since last step": query
   `inbox_messages` for `direction='in'` rows in this thread newer than
   `enrolled_at` (or `last_step_run_at`). If any exist and the step has
   `stop_on_reply=1`, mark enrollment `status='replied'`, log skip, exit.
4. Resolve the thread: if `thread_id` is null (enrolled at MassDM time
   before the thread existed in our inbox), look up by `account_id +
   peer_username` and link.
5. Enqueue an `inbox.send_message` job with the variant body. Tag the
   resulting `inbox_messages.source='followup'`.
6. On send success: increment `current_step_index`. If next step exists,
   set `next_run_at = now + next_step.delay_hours * 3600_000`, jittered
   ±15 %. Else mark `status='completed'`.
7. On send failure: log to `followup_send_log`, retry once after 30 min,
   then mark enrollment `status='cancelled'` with reason.

### 4.4 UI: `Followups.tsx`

New screen, sidebar entry "Follow-ups". Two tabs:

- **Sequences**: list of saved sequences with name, step count, "active
  enrollments" count. Click → editor:
  - Sequence name input.
  - Step list: each step shows index, delay (with units), variants chosen,
    "stop on reply" toggle. Add/remove/reorder steps.
  - Variants picker: multi-select against existing `MessageVariants`.
- **Enrollments**: live list of all active/paused/completed enrollments.
  Columns: peer, account, sequence, current step, next run, status. Row
  actions: Pause, Resume, Cancel, Open in Inbox.

### 4.5 Wiring into existing flows

- **From MassDMs**: in `src/screens/MassDMs.tsx`, add a step "Optionally
  enroll all recipients into a follow-up sequence" with a sequence picker.
  When the cold DM job completes, for each successfully-sent recipient,
  insert a `followup_enrollments` row (`current_step_index = 0`,
  `next_run_at = now + step[0].delay_hours`).
- **From Inbox**: thread "..." menu → "Enroll in follow-up sequence" →
  picker → inserts an enrollment with `thread_id` set.
- **Cancel on reply**: the inbox poller, when it inserts a new
  `inbox_messages` row with `direction='in'`, checks for any active
  `followup_enrollments` for that thread and flips them to
  `status='replied'`.

### 4.6 Acceptance criteria

- User creates a sequence with 3 steps (1d, 3d, 7d), each pointing to a
  message variant.
- Running a MassDM with that sequence enrolls each recipient; after
  fast-forwarding the DB clock (or waiting), step 1 fires per the schedule.
- A reply from any recipient flips their enrollment to `replied` and
  stops further sends.
- Pausing an enrollment prevents the next scheduled send; resuming
  re-arms it.

---

## 5. Phase 10 — Stories

Two distinct capabilities, sharing one set of Playwright primitives.

### 5.1 Primitives

New module: `electron/src/backend/workers/ig/stories.ts`. Functions:

- `viewOwnFeedStories(page, opts: { maxStoryRings: number; perStoryDwellMs: [min, max] })`:
  open the feed home, click each ring in the top story tray in order,
  watch each story for a randomized dwell, advance, exit. Returns
  `{ rings: number, stories: number, totalDwellMs: number }`.
- `viewUserStories(page, username, opts: { perStoryDwellMs: [min, max], maxStories?: number })`:
  navigate to `/{username}/`, click the profile picture if a story ring is
  present, watch all available stories with dwell + advance, exit. Returns
  `{ watched: number, totalDwellMs: number, hadStories: boolean }`.

Both are non-destructive (no like, no reply, no send). Watching a story
silently is the lowest-risk warm touch.

### 5.2 Phase 10a — Stories in Warmup

Extend `WarmupAction` in `workers/warmup.ts`:

```ts
| { type: 'view_feed_stories'; durationSec: number; maxStoryRings: number }
| { type: 'view_target_stories'; usernames: string[]; perUserCap: number }
```

Add to the warmup config UI (`src/screens/Warmup.tsx`) two new action
types. The "combo" action type also gains optional fields
`storyRings: number` and `storyDwellSec: number` so a single combo can
include feed-story watching naturally.

### 5.3 Phase 10b — Standalone "Story Watcher" job

New worker: `electron/src/backend/workers/storyWatcher.ts`. Init payload:

```ts
interface StoryWatcherInit {
  jobId: string;
  secrets: AccountSecrets;
  source:
    | { kind: 'usernames'; list: string[] }
    | { kind: 'scrape_result'; jobId: string }   // pull usernames from a scrape CSV
    | { kind: 'csv'; path: string };
  perUserDwellMs: [min: number, max: number];
  intervalBetweenUsersMs: [min: number, max: number];
  skipIfNoStory: boolean;
  maxUsersPerRun: number;
}
```

Worker iterates the username list, calls `viewUserStories` for each,
sleeps the inter-user interval, emits progress, returns
`{ visited, watched, skipped }`.

### 5.4 Phase 10c — Pre-DM "warm touch" in MassDM

Add an optional toggle to the MassDM config: "Watch target's stories
before DM (if available)". When on, `workers/massDm.ts` calls
`viewUserStories` for each recipient (with a small dwell, e.g., 1.5–4 s
per story) just before navigating to `/direct/new/`. Adds ~5–15 s per
recipient on average, but increases reply rate based on competitor data.

### 5.5 UI

- Warmup screen: extend the action picker as in §5.2.
- New screen `src/screens/StoryWatcher.tsx`: source picker (paste list /
  upload CSV / pick from previous scrapes), per-user dwell range, interval
  range, "skip if no story" toggle, "Run" → enqueues a `story_watcher` job.
  Running view shows live progress (visited / N, watched / skipped).
- MassDM: a single new checkbox + dwell slider in the existing config form.

### 5.6 Acceptance criteria

- Warmup with `view_feed_stories` action runs end-to-end and reports
  `{ rings, stories, totalDwellMs }`.
- Standalone Story Watcher run on 5 usernames produces a progress stream
  and a final result with watched/skipped counts.
- MassDM with the warm-touch toggle on shows story-view step in the
  per-recipient log before each DM.

---

## 6. Files to create / modify

New (backend):
- `electron/src/backend/inboxScheduler.ts`
- `electron/src/backend/followupScheduler.ts`
- `electron/src/backend/aiResponder.ts`
- `electron/src/backend/ai/index.ts`
- `electron/src/backend/ai/anthropic.ts`
- `electron/src/backend/workers/inbox.ts`
- `electron/src/backend/workers/storyWatcher.ts`
- `electron/src/backend/workers/ig/inbox.ts`
- `electron/src/backend/workers/ig/stories.ts`

Modified (backend):
- `electron/src/backend/db.ts` — add migrations for inbox / ai / followup tables
- `electron/src/backend/index.ts` — wire schedulers + new IPC handlers
- `electron/src/backend/jobs.ts` — accept new `kind` values
  (`inbox_poll`, `inbox_backfill`, `inbox_thread_fetch`, `inbox_send`,
  `ai_reply`, `followup_send`, `story_watcher`)
- `electron/src/backend/accounts.ts` — on insert, enqueue an `inbox_backfill`
- `electron/src/backend/workers/warmup.ts` — add story actions
- `electron/src/backend/workers/massDm.ts` — optional pre-DM story view
- `electron/src/backend/workers/ig/index.ts` — re-export `stories`, `inbox`
- `electron/src/preload.ts` — extend `b2dm.*` IPC surface

New (frontend):
- `src/screens/Inbox.tsx`
- `src/screens/AutoResponder.tsx`
- `src/screens/AutoResponder.defaults.ts`
- `src/screens/Followups.tsx`
- `src/screens/StoryWatcher.tsx`
- `src/components/inbox/AccountRail.tsx`
- `src/components/inbox/ThreadList.tsx`
- `src/components/inbox/Conversation.tsx`
- `src/components/inbox/Composer.tsx`
- `src/lib/markdownEditor.ts` — thin wrapper around the chosen MD editor lib

Modified (frontend):
- `src/App.tsx` — routes for new screens
- `src/components/layout/Sidebar.tsx` — append entries for Inbox,
  Auto-Responder, Follow-ups, Story Watcher. Existing sidebar entries
  (Instagram Accounts, Actions, Mass DMs, Scrape, Data, Queue, Warmup,
  Message Variants, Categories, Cold DM History, Settings) all stay
  visible; we are *adding alongside*, not replacing.
- `src/screens/Settings.tsx` — AI provider section (key + model + cost preview)
- `src/screens/MassDMs.tsx` — sequence picker + story warm-touch toggle
- `src/screens/Warmup.tsx` — new story actions
- `src/lib/electron.ts` — typed wrappers for new IPC channels
- `src/types/ipc.ts`, `src/types/domain.ts` — new types

New deps:
- `@anthropic-ai/sdk`
- `@uiw/react-md-editor` (or equivalent lightweight Markdown editor; pick
  one that doesn't pull a CodeMirror megabundle if possible)
- `react-virtuoso` (virtualization for thread lists)
- `date-fns` if not already present

---

## 7. Phasing and acceptance gates

| # | Phase | Est. | Ships when |
|---|---|---|---|
| 7.1 | Inbox: schema + poller + read-only UI | 1 wk | New account triggers backfill; Inbox screen lists threads from all accounts; opening a thread shows full message history; filters by account + date work. |
| 7.2 | Inbox: send messages (manual) | 3 d | Composer sends; outbound persisted; optimistic update + retry on failure. |
| 8.1 | AI Responder: settings + prompt editor + Suggest mode | 1 wk | Key validates; editor saves Markdown; new inbound messages produce drafts in the composer for opted-in accounts. |
| 8.2 | AI Responder: Auto-send + rate limits + cost log | 4 d | Toggling auto-mode actually sends; rate limits and exclusion keywords enforced; cost footer accurate. |
| 9 | Follow-up: schema + scheduler + UI + MassDM hook | 1 wk | Sequence runs end-to-end on a real thread; replies cancel sequences; pause/resume work. |
| 10 | Stories: warmup actions + standalone watcher + MassDM warm-touch | 4 d | All three story entry points run, log results, are observable in the jobs UI. |

Total: ~5–6 weeks. Each phase is shippable independently.

---

## 8. Decisions

These were originally open questions; resolved with the user on 2026-04-26.

1. **Markdown editor**: `@uiw/react-md-editor`. Bundle cost is acceptable
   for the desktop app and the editor's split preview / toolbar is the
   right UX for users who don't write Markdown daily.
2. **Polling cadence**: 5 min idle / 90 s active monitoring, both with
   ±25 % jitter. Exposed in Settings so users can adjust per-account if
   they want; defaults are shipped values.
3. **Backfill cap**: 500 threads × 200 messages per thread on first add.
   Cancellable; resumable. Per-thread "Load more history" button surfaces
   older messages on demand without re-running the full backfill.
4. **AI default model**: `claude-sonnet-4-6`. Three-option dropdown lets
   users switch to Opus 4.7 (quality) or Haiku 4.5 (cost). Prompt caching
   on the system prompt drops effective input cost by ~10x for the second
   and subsequent replies in a session, so Sonnet is the right balance.
5. **Anti-echo post-processing**: deferred. Ship the responder, observe
   real reply patterns for a week, then decide whether a dedupe filter is
   worth the complexity. Captured in §11 (Future work).
6. **Existing `leads` / `categories` UI**: stays. The new screens (Inbox,
   Auto-Responder, Follow-ups, Story Watcher) are added as new sidebar
   entries alongside the existing ones. No deletion, no hiding. The new
   features simply do not consume the leads tables.

---

## 9. Future work (explicitly deferred)

- **Anti-echo dedupe** for AI replies (see §8.5).
- **Per-account prompt overrides**: a single global prompt is enough for
  v1; if users ask, add a `prompt_overrides (account_id, prompt_md)` table
  and a small selector in the AutoResponder screen.
- **OpenAI / other providers**: provider abstraction is scaffolded in
  `electron/src/backend/ai/index.ts` so adding `ai/openai.ts` is a sibling
  file, not a refactor. Wait until a paying user asks.
- **Image / voice / reel rendering** in the Inbox conversation pane.
  Placeholders for v1.
- **FTS** on `inbox_messages.body` for full-conversation search. `LIKE`
  on `peer_username` + `last_message_preview` is enough for v1.

---

## 10. Non-goals (explicit, this phase)

- Lead scoring, lead categorization, "interested / not interested" classification.
- CRM integrations, Zapier, webhooks-out, Google Sheets sync.
- Multi-language UI.
- Voice / image / reel rendering inside the Inbox (placeholders only).
- Read receipts / "seen" detection.
- Group thread send (read-only is fine; sending is 1:1 only).
- Stripe / in-app purchase flows for the AI feature (BYO key; no resale of tokens).
- Meta Graph API / official Instagram Business webhook integration. Considered
  and rejected for now: onboarding friction is incompatible with the user
  base (multiple personal/creator accounts per user, no Facebook Pages).
  Revisit only as a "Compliance Pro" tier later.
