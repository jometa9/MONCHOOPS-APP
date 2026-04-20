import crypto from 'crypto';
import { getDb } from './db';
import { encryptString, decryptString, encryptJson, decryptJson } from './crypto';
import {
  DAY_MS,
  WARMUP_MIN_DAYS_SINCE_CREATION,
  WARMUP_MIN_DISTINCT_ACTIVE_DAYS,
} from './warmupConfig';

export type AccountStatus = 'idle' | 'busy' | 'error';

export interface AccountPublic {
  id: string;
  username: string;
  displayName: string | null;
  profilePicUrl: string | null;
  userAgent: string;
  proxyUrl: string | null;
  proxyUsername: string | null;
  hasProxyPassword: boolean;
  hasStoredPassword: boolean;
  status: AccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  /** Count of distinct local-calendar days on which at least one warmup
   *  result was recorded against this account. Drives the "warmed"
   *  classification below. */
  warmupActiveDays: number;
  /** Timestamp of the most recent warmup result for this account, or
   *  null if it has never been warmed up. */
  lastWarmupAt: number | null;
  /** Computed flag: true when the account has existed for at least
   *  WARMUP_MIN_DAYS_SINCE_CREATION days AND has warmupActiveDays ≥
   *  WARMUP_MIN_DISTINCT_ACTIVE_DAYS. Surfaced as a secondary badge in
   *  the UI. */
  isWarmed: boolean;
}

interface AccountRow {
  id: string;
  username: string;
  display_name: string | null;
  profile_pic_url: string | null;
  cookies_encrypted: Buffer;
  user_agent: string;
  proxy_url: string | null;
  proxy_username: string | null;
  proxy_password_encrypted: Buffer | null;
  password_encrypted: Buffer | null;
  status: AccountStatus;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface InstagramCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface AccountSecrets {
  cookies: InstagramCookie[];
  userAgent: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}

interface WarmupMetrics {
  warmupActiveDays: number;
  lastWarmupAt: number | null;
}

// Compute per-account warmup metrics by bucketing warmup_results by
// local-day. We scope the distinct-day count to the rows tied to the
// given account(s) — a single query with GROUP BY is faster than
// round-tripping per account for large account lists.
function loadWarmupMetrics(accountIds: string[]): Map<string, WarmupMetrics> {
  if (accountIds.length === 0) return new Map();
  const placeholders = accountIds.map(() => '?').join(',');
  // date(ms/1000, 'unixepoch', 'localtime') collapses each timestamp to
  // a YYYY-MM-DD string in the user's local tz — exactly what
  // "distinct calendar days of activity" means for the UI.
  const rows = getDb()
    .prepare<string[], { account_id: string; active_days: number; last_at: number }>(
      `SELECT
         account_id,
         COUNT(DISTINCT date(completed_at/1000, 'unixepoch', 'localtime')) AS active_days,
         MAX(completed_at) AS last_at
       FROM warmup_results
       WHERE account_id IN (${placeholders})
       GROUP BY account_id`
    )
    .all(...accountIds);
  const out = new Map<string, WarmupMetrics>();
  for (const r of rows) {
    out.set(r.account_id, {
      warmupActiveDays: Number(r.active_days) || 0,
      lastWarmupAt: r.last_at ?? null,
    });
  }
  return out;
}

function rowToPublic(row: AccountRow, metrics?: WarmupMetrics): AccountPublic {
  const m: WarmupMetrics = metrics ?? { warmupActiveDays: 0, lastWarmupAt: null };
  const ageMs = Date.now() - row.created_at;
  const isOldEnough = ageMs >= WARMUP_MIN_DAYS_SINCE_CREATION * DAY_MS;
  const isWarmed = isOldEnough && m.warmupActiveDays >= WARMUP_MIN_DISTINCT_ACTIVE_DAYS;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    profilePicUrl: row.profile_pic_url,
    userAgent: row.user_agent,
    proxyUrl: row.proxy_url,
    proxyUsername: row.proxy_username,
    hasProxyPassword: !!row.proxy_password_encrypted,
    hasStoredPassword: !!row.password_encrypted,
    status: row.status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    warmupActiveDays: m.warmupActiveDays,
    lastWarmupAt: m.lastWarmupAt,
    isWarmed,
  };
}

export interface CreateAccountInput {
  username: string;
  displayName?: string | null;
  profilePicUrl?: string | null;
  cookies: InstagramCookie[];
  userAgent: string;
  // Password used to log in — persisted encrypted so the user can retry a
  // later failure without re-typing. Pass null to leave the stored password
  // unchanged; pass a string to overwrite it.
  password?: string | null;
}

export function listAccounts(): AccountPublic[] {
  const rows = getDb()
    .prepare<[], AccountRow>('SELECT * FROM accounts ORDER BY created_at DESC')
    .all();
  const metrics = loadWarmupMetrics(rows.map((r) => r.id));
  return rows.map((r) => rowToPublic(r, metrics.get(r.id)));
}

export function getAccount(id: string): AccountPublic | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return null;
  const metrics = loadWarmupMetrics([row.id]);
  return rowToPublic(row, metrics.get(row.id));
}

export function getAccountSecrets(id: string): AccountSecrets | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return null;
  const cookies = decryptJson<InstagramCookie[]>(row.cookies_encrypted);
  const out: AccountSecrets = { cookies, userAgent: row.user_agent };
  if (row.proxy_url) {
    const password = row.proxy_password_encrypted
      ? decryptString(row.proxy_password_encrypted)
      : undefined;
    out.proxy = {
      server: row.proxy_url,
      username: row.proxy_username ?? undefined,
      password,
    };
  }
  return out;
}

export function createAccount(input: CreateAccountInput): AccountPublic {
  const existing = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE username = ?')
    .get(input.username);
  const now = Date.now();
  const cookiesBlob = encryptJson(input.cookies);
  const passwordBlob =
    typeof input.password === 'string' && input.password.length > 0
      ? encryptString(input.password)
      : null;

  if (existing) {
    // Keep the previously stored password if the caller didn't provide a new
    // one (success path from the classic manual-login worker, which doesn't
    // know the password).
    const nextPassword = passwordBlob ?? existing.password_encrypted;
    getDb()
      .prepare(
        `UPDATE accounts SET
           display_name = ?,
           profile_pic_url = ?,
           cookies_encrypted = ?,
           user_agent = ?,
           password_encrypted = ?,
           status = 'idle',
           last_error = NULL,
           updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.displayName ?? existing.display_name,
        input.profilePicUrl ?? existing.profile_pic_url,
        cookiesBlob,
        input.userAgent,
        nextPassword,
        now,
        existing.id
      );
    return getAccount(existing.id)!;
  }

  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, username, display_name, profile_pic_url, cookies_encrypted, user_agent, password_encrypted, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`
    )
    .run(
      id,
      input.username,
      input.displayName ?? null,
      input.profilePicUrl ?? null,
      cookiesBlob,
      input.userAgent,
      passwordBlob,
      now,
      now
    );
  return getAccount(id)!;
}

// Called when an auto-login attempt fails. Creates (or updates) a shell
// account row with status='error' so the user can see the failed attempt and
// choose to retry or delete it. Cookies are stored as an empty list — the
// row is not usable for scraping/DMs until a successful retry replaces them.
export interface UpsertFailedAccountInput {
  username: string;
  password?: string | null;
  lastError: string;
}

export function upsertFailedAccount(input: UpsertFailedAccountInput): AccountPublic {
  const existing = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE username = ?')
    .get(input.username);
  const now = Date.now();
  const passwordBlob =
    typeof input.password === 'string' && input.password.length > 0
      ? encryptString(input.password)
      : null;

  if (existing) {
    // Don't nuke existing cookies/UA if we already have a working session —
    // only flip status to 'error' and record the new error message. This way
    // a transient failure on a healthy account just surfaces the error; the
    // old cookies remain until the user retries.
    const nextPassword = passwordBlob ?? existing.password_encrypted;
    getDb()
      .prepare(
        `UPDATE accounts SET
           password_encrypted = ?,
           status = 'error',
           last_error = ?,
           updated_at = ?
         WHERE id = ?`
      )
      .run(nextPassword, input.lastError, now, existing.id);
    return getAccount(existing.id)!;
  }

  const id = crypto.randomUUID();
  const emptyCookies = encryptJson([] as InstagramCookie[]);
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, username, display_name, profile_pic_url, cookies_encrypted, user_agent, password_encrypted, status, last_error, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, '', ?, 'error', ?, ?, ?)`
    )
    .run(id, input.username, emptyCookies, passwordBlob, input.lastError, now, now);
  return getAccount(id)!;
}

// Returns the decrypted password stored on the account row, or null if none
// was ever stored (e.g. account was created via the manual-login flow).
export function getAccountPassword(id: string): string | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row || !row.password_encrypted) return null;
  try {
    return decryptString(row.password_encrypted);
  } catch {
    return null;
  }
}

export function deleteAccount(id: string): void {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return;
  if (row.status === 'busy') throw new Error('Cannot delete an account while a job is running');
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export interface ProxyConfig {
  url: string | null;
  username: string | null;
  password: string | null;
}

export function updateProxy(id: string, cfg: ProxyConfig): AccountPublic {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) throw new Error('Account not found');

  const trimmed = (cfg.url ?? '').trim();
  if (trimmed && !/^(https?|socks5):\/\/[^\s]+:\d+/.test(trimmed)) {
    throw new Error('Proxy URL must look like http(s)://host:port or socks5://host:port');
  }

  const passwordBlob =
    cfg.password && cfg.password.length > 0 ? encryptString(cfg.password) : null;

  getDb()
    .prepare(
      `UPDATE accounts SET
         proxy_url = ?,
         proxy_username = ?,
         proxy_password_encrypted = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .run(
      trimmed || null,
      cfg.username && cfg.username.length > 0 ? cfg.username : null,
      passwordBlob,
      Date.now(),
      id
    );
  return getAccount(id)!;
}

export function setAccountStatus(id: string, status: AccountStatus, lastError?: string | null): void {
  getDb()
    .prepare(
      `UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, lastError ?? null, Date.now(), id);
}
