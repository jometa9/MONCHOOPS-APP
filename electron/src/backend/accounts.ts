import crypto from 'crypto';
import { getDb } from './db';
import { encryptString, decryptString, encryptJson, decryptJson } from './crypto';

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

function rowToPublic(row: AccountRow): AccountPublic {
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
  return rows.map(rowToPublic);
}

export function getAccount(id: string): AccountPublic | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  return row ? rowToPublic(row) : null;
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

  if (existing) {
    getDb()
      .prepare(
        `UPDATE accounts SET
           display_name = ?,
           profile_pic_url = ?,
           cookies_encrypted = ?,
           user_agent = ?,
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
        now,
        existing.id
      );
    return getAccount(existing.id)!;
  }

  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO accounts
        (id, username, display_name, profile_pic_url, cookies_encrypted, user_agent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'idle', ?, ?)`
    )
    .run(
      id,
      input.username,
      input.displayName ?? null,
      input.profilePicUrl ?? null,
      cookiesBlob,
      input.userAgent,
      now,
      now
    );
  return getAccount(id)!;
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
