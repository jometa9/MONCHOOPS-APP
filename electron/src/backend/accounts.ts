import crypto from 'crypto';
import { getDb } from './db';
import { encryptString, decryptString, encryptJson, decryptJson } from './crypto';
import { registerAccount, unregisterAccount } from './cloudSync';

export type AccountStatus = 'idle' | 'busy' | 'error';

export interface AccountPublic {
  id: string;
  username: string;
  displayName: string | null;
  profilePicUrl: string | null;
  userAgent: string;
  proxyUrl: string | null;
  proxyUsername: string | null;
  proxyEnabled: boolean;
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
  proxy_enabled: number;
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
    proxyEnabled: row.proxy_enabled !== 0,
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

  password?: string | null;
}

export function listAccounts(): AccountPublic[] {
  const rows = getDb()
    .prepare<[], AccountRow>('SELECT * FROM accounts ORDER BY created_at DESC')
    .all();
  return rows.map((r) => rowToPublic(r));
}

export function getAccount(id: string): AccountPublic | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return null;
  return rowToPublic(row);
}

export function getAccountSecrets(id: string): AccountSecrets | null {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return null;
  const cookies = decryptJson<InstagramCookie[]>(row.cookies_encrypted);
  const out: AccountSecrets = { cookies, userAgent: row.user_agent };
  if (row.proxy_url && row.proxy_enabled !== 0) {
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

  void registerAccount(input.username).catch((err) => {
    console.warn(`[accounts] cloud register failed for @${input.username}:`, err);
  });
  return getAccount(id)!;
}

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

export async function deleteAccount(id: string): Promise<void> {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) return;
  if (row.status === 'busy') throw new Error('Cannot delete an account while a job is running');
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
  try {
    await unregisterAccount(row.username);
  } catch (err) {
    console.warn(`[accounts] cloud unregister failed for @${row.username}:`, err);
  }
}

export interface ProxyConfig {
  url: string | null;
  username: string | null;
  password: string | null;
  enabled?: boolean;
}

export function updateProxy(id: string, cfg: ProxyConfig): AccountPublic {
  const row = getDb()
    .prepare<[string], AccountRow>('SELECT * FROM accounts WHERE id = ?')
    .get(id);
  if (!row) throw new Error('Account not found');

  const raw = (cfg.url ?? '').trim();
  const trimmed = raw && !/^(https?|socks5):\/\//i.test(raw) ? `http://${raw}` : raw;
  if (trimmed && !/^(https?|socks5):\/\/[^\s]+:\d+/.test(trimmed)) {
    throw new Error('Proxy URL must look like http(s)://host:port or socks5://host:port');
  }

  const keepPassword = cfg.password === null;
  const passwordBlob =
    cfg.password && cfg.password.length > 0
      ? encryptString(cfg.password)
      : keepPassword
      ? row.proxy_password_encrypted
      : null;

  const nextUrl = trimmed || null;

  const nextUsername = nextUrl
    ? cfg.username && cfg.username.length > 0
      ? cfg.username
      : null
    : null;
  const nextPassword = nextUrl ? passwordBlob : null;

  const nextEnabled = nextUrl ? (cfg.enabled === false ? 0 : 1) : 1;

  getDb()
    .prepare(
      `UPDATE accounts SET
         proxy_url = ?,
         proxy_username = ?,
         proxy_password_encrypted = ?,
         proxy_enabled = ?,
         updated_at = ?
       WHERE id = ?`
    )
    .run(nextUrl, nextUsername, nextPassword, nextEnabled, Date.now(), id);
  return getAccount(id)!;
}

export function setAccountStatus(id: string, status: AccountStatus, lastError?: string | null): void {
  getDb()
    .prepare(
      `UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`
    )
    .run(status, lastError ?? null, Date.now(), id);
}
