import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type { Database } from 'better-sqlite3';

let cached: Database | null = null;

function dbPath(): string {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'b2dm.sqlite');
}

function loadDriver(): typeof import('better-sqlite3') {

  const mod = require('better-sqlite3') as typeof import('better-sqlite3');
  return mod;
}

export function getDb(): Database {
  if (cached) return cached;
  const DriverCtor = loadDriver();
  const db = new DriverCtor(dbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  cached = db;
  return cached;
}

function migrate(db: Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0;

  if (current < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  if (current < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        profile_pic_url TEXT,
        cookies_encrypted BLOB NOT NULL,
        user_agent TEXT NOT NULL,
        proxy_url TEXT,
        proxy_username TEXT,
        proxy_password_encrypted BLOB,
        status TEXT NOT NULL DEFAULT 'idle',
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
    `);
  }

  if (current < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        progress_done INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

      CREATE TABLE IF NOT EXISTS scrape_results (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        username_count INTEGER NOT NULL,
        csv_path TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scrape_results_completed ON scrape_results(completed_at DESC);
    `);
  }

  if (current < 4) {

    db.exec(`
      CREATE TABLE jobs_new (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        params_json TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        progress_done INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER,
        error TEXT
      );
      INSERT INTO jobs_new SELECT * FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_new RENAME TO jobs;
      CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `);
  }

  if (current < 5) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS lead_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id TEXT NOT NULL REFERENCES lead_categories(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        source_detail TEXT,
        scraped_at INTEGER NOT NULL,
        UNIQUE(category_id, username)
      );
      CREATE INDEX IF NOT EXISTS idx_leads_category ON leads(category_id);
      CREATE INDEX IF NOT EXISTS idx_leads_job ON leads(source_job_id);

      CREATE TABLE IF NOT EXISTS category_scrapes (
        category_id TEXT NOT NULL REFERENCES lead_categories(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        added_count INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (category_id, job_id)
      );
    `);
  }

  if (current < 6) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS mass_dm_results (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        sent_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        total_count INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mass_dm_results_completed
        ON mass_dm_results(completed_at DESC);
    `);
  }

  if (current < 7) {

    db.exec(`
      ALTER TABLE jobs ADD COLUMN running_at INTEGER;
      UPDATE jobs SET running_at = started_at WHERE running_at IS NULL;
    `);
  }

  if (current < 8) {

    db.exec(`ALTER TABLE accounts ADD COLUMN password_encrypted BLOB;`);
  }

  if (current < 9) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS warmup_results (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        action_type TEXT NOT NULL,
        action_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_warmup_results_completed
        ON warmup_results(completed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_warmup_results_account
        ON warmup_results(account_id);
    `);
  }

  if (current < 10) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS warmup_schedules (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        start_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        time_of_day_sec INTEGER NOT NULL,
        actions_json TEXT NOT NULL,
        last_fired_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_warmup_schedules_account
        ON warmup_schedules(account_id);
    `);
  }

  if (current < 11) {

    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_enabled INTEGER NOT NULL DEFAULT 1;`);
  }

  if (current < 12) {

    db.exec(`
      CREATE TABLE scrape_results_new (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        username_count INTEGER NOT NULL,
        csv_path TEXT,
        duration_ms INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        error TEXT
      );
      INSERT INTO scrape_results_new
        (job_id, kind, summary, username_count, csv_path, duration_ms, completed_at, status, error)
        SELECT job_id, kind, summary, username_count, csv_path, duration_ms, completed_at, 'completed', NULL
        FROM scrape_results;
      DROP TABLE scrape_results;
      ALTER TABLE scrape_results_new RENAME TO scrape_results;
      CREATE INDEX IF NOT EXISTS idx_scrape_results_completed
        ON scrape_results(completed_at DESC);
    `);
  }

  if (current < 13) {

    db.exec(`ALTER TABLE scrape_results ADD COLUMN target_name TEXT;`);
  }

  if (current < 14) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS message_variant_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL REFERENCES message_variant_groups(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_variants_group
        ON message_variants(group_id, position);
    `);
  }

  if (current < 15) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS mass_dm_sends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        username TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        sent_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mass_dm_sends_job
        ON mass_dm_sends(job_id);
      CREATE INDEX IF NOT EXISTS idx_mass_dm_sends_account_username
        ON mass_dm_sends(account_id, username);
    `);
  }

  if (current < 16) {

    db.exec(`ALTER TABLE mass_dm_sends ADD COLUMN message TEXT;`);
  }

  if (current < 17) {

    db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_threads (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        ig_thread_id TEXT NOT NULL,
        peer_username TEXT NOT NULL,
        peer_display_name TEXT,
        peer_pic_url TEXT,
        is_group INTEGER NOT NULL DEFAULT 0,
        last_message_at INTEGER,
        last_message_preview TEXT,
        last_message_from_me INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        ai_responder_enabled INTEGER NOT NULL DEFAULT 0,
        followup_disabled INTEGER NOT NULL DEFAULT 0,
        history_backfilled_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(account_id, ig_thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_threads_account_lastmsg
        ON inbox_threads(account_id, last_message_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inbox_threads_unread
        ON inbox_threads(unread_count) WHERE unread_count > 0;

      CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
        ig_message_id TEXT,
        direction TEXT NOT NULL,
        sender_username TEXT NOT NULL,
        body TEXT,
        media_kind TEXT,
        media_caption TEXT,
        sent_at INTEGER NOT NULL,
        source TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(thread_id, ig_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_thread_sent
        ON inbox_messages(thread_id, sent_at ASC);

      CREATE TABLE IF NOT EXISTS inbox_sync_state (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        last_poll_started_at INTEGER,
        last_poll_finished_at INTEGER,
        last_poll_status TEXT,
        last_poll_error TEXT,
        threads_seen INTEGER NOT NULL DEFAULT 0,
        active_monitoring INTEGER NOT NULL DEFAULT 0,
        next_poll_due_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS inbox_drafts (
        thread_id TEXT PRIMARY KEY REFERENCES inbox_threads(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        model TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_responder_account_settings (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'suggest',
        max_per_hour INTEGER NOT NULL DEFAULT 10,
        max_per_day INTEGER NOT NULL DEFAULT 50
      );

      CREATE TABLE IF NOT EXISTS ai_responder_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL REFERENCES inbox_threads(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        reason TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        cost_usd REAL,
        model TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ai_log_thread
        ON ai_responder_log(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ai_log_created
        ON ai_responder_log(created_at DESC);

      CREATE TABLE IF NOT EXISTS followup_sequences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS followup_steps (
        id TEXT PRIMARY KEY,
        sequence_id TEXT NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        delay_hours INTEGER NOT NULL,
        variant_ids_json TEXT NOT NULL,
        stop_on_reply INTEGER NOT NULL DEFAULT 1,
        UNIQUE(sequence_id, step_index)
      );

      CREATE TABLE IF NOT EXISTS followup_enrollments (
        id TEXT PRIMARY KEY,
        sequence_id TEXT NOT NULL REFERENCES followup_sequences(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        thread_id TEXT REFERENCES inbox_threads(id) ON DELETE SET NULL,
        peer_username TEXT NOT NULL,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        enrolled_at INTEGER NOT NULL,
        next_run_at INTEGER NOT NULL,
        last_step_run_at INTEGER,
        cancelled_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_followup_due
        ON followup_enrollments(status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_followup_thread
        ON followup_enrollments(thread_id);

      CREATE TABLE IF NOT EXISTS followup_send_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        enrollment_id TEXT NOT NULL REFERENCES followup_enrollments(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        variant_id TEXT,
        message_id TEXT REFERENCES inbox_messages(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        reason TEXT,
        ran_at INTEGER NOT NULL
      );
    `);
  }

  if (current < 18) {

    db.exec(`
      DROP TABLE IF EXISTS followup_send_log;
      DROP TABLE IF EXISTS followup_enrollments;
      DROP TABLE IF EXISTS followup_steps;
      DROP TABLE IF EXISTS followup_sequences;
      DROP TABLE IF EXISTS ai_responder_log;
      DROP TABLE IF EXISTS ai_responder_account_settings;
      DROP TABLE IF EXISTS inbox_drafts;
      DROP TABLE IF EXISTS inbox_sync_state;
      DROP TABLE IF EXISTS inbox_messages;
      DROP TABLE IF EXISTS inbox_threads;
      DELETE FROM meta WHERE key LIKE 'ai\\_%' ESCAPE '\\';
      DELETE FROM meta WHERE key IN (
        'ai_provider', 'ai_model', 'ai_default_max_tokens',
        'ai_api_key_encrypted', 'ai_prompt_md',
        'ai_history_depth', 'ai_default_mode', 'ai_kill_switch',
        'ai_exclude_keywords', 'ai_min_inbound_len', 'ai_max_ai_streak'
      );
    `);
  }

  if (current < 19) {

    db.exec(`
      DROP TABLE IF EXISTS warmup_schedules;
      DROP TABLE IF EXISTS warmup_results;
    `);
  }

  db.pragma('user_version = 19');
}

export function metaGet(key: string): string | null {
  const row = getDb()
    .prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}

export function metaSet(key: string, value: string | null): void {
  if (value === null) {
    getDb().prepare('DELETE FROM meta WHERE key = ?').run(key);
    return;
  }
  getDb()
    .prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function metaGetJson<T>(key: string): T | null {
  const raw = metaGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function metaSetJson(key: string, value: unknown): void {
  metaSet(key, JSON.stringify(value));
}
