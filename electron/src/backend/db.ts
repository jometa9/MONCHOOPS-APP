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

// better-sqlite3 is a native addon and must only be required at runtime inside
// Electron's main process. Lazy-require it here so that the TypeScript module
// graph can still be analysed on platforms where the binary isn't installed.
function loadDriver(): typeof import('better-sqlite3') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    // Login jobs run before an account exists, so account_id must be nullable.
    // SQLite can't drop NOT NULL in place — rebuild the table.
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
    // Lead categories: grouping layer on top of individual scrape jobs.
    // A single scrape can contribute its leads to one category; the
    // UNIQUE(category_id, username) constraint dedups when multiple
    // scrapes target the same category.
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
    // History of mass DM runs. One row per completed/cancelled mass_dm job,
    // used both for the Cold DM history UI and for computing Time Saved /
    // Messages Sent stats on Home.
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
    // Per-account FIFO queueing. `started_at` stays as the enqueue timestamp
    // (used for FIFO ordering); `running_at` tracks when the worker actually
    // started. Jobs with status='queued' have running_at = NULL until they
    // get dispatched.
    db.exec(`
      ALTER TABLE jobs ADD COLUMN running_at INTEGER;
      UPDATE jobs SET running_at = started_at WHERE running_at IS NULL;
    `);
  }

  if (current < 8) {
    // Store the password used for auto-login so the user can one-click retry
    // an account that landed in status='error'. Encrypted at rest via the
    // same AES-GCM key used for cookies/proxy creds.
    db.exec(`ALTER TABLE accounts ADD COLUMN password_encrypted BLOB;`);
  }

  if (current < 9) {
    // History of warmup runs. action_json stores the full action payload
    // (type + params); result_json stores counters (visited, liked,
    // followed, skipped, failed). One row per completed/cancelled
    // warmup job — used by the Warmup screen to surface "last run" state
    // alongside the accounts table.
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
    // Recurring warmup schedules. Each row represents a "daily warmup
    // plan" for one account across a date range. The actions_json
    // column stores an ordered list of WarmupAction payloads — all of
    // them fire (sequentially, via the per-account FIFO) when the
    // schedule's daily slot arrives. last_fired_at is the ms timestamp
    // of the latest successful firing; the scheduler uses it to avoid
    // double-running on the same local day.
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
    // Allow a user to temporarily turn off a saved proxy without losing the
    // credentials. Default 1 means every existing row with a proxy stays on.
    db.exec(`ALTER TABLE accounts ADD COLUMN proxy_enabled INTEGER NOT NULL DEFAULT 1;`);
  }

  if (current < 12) {
    // Capture every scrape outcome — not just completed ones — so the user
    // can see failed/cancelled scrapes in history and retry the failed ones.
    // csv_path becomes nullable (a failed scrape may have produced no CSV).
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
    // Target identity of the scrape: @username for user/post scrapes,
    // #hashtag for hashtag scrapes, location name for location scrapes.
    // Used by the UI to show a clean, clickable summary instead of raw URLs.
    db.exec(`ALTER TABLE scrape_results ADD COLUMN target_name TEXT;`);
  }

  db.pragma('user_version = 13');
}

// meta helpers — used by license.ts for ad-hoc key/value state.
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
