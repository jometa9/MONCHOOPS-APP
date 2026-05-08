

import crypto from 'crypto';
import { app } from 'electron';
import { BUILD_CONFIG } from '../buildConfig';
import { metaGet, metaSet } from './db';
import { decryptString, encryptString } from './crypto';
import { checkVersionIfStale } from './updater';

const LICENSE_KEY_META = 'license_key_encrypted';
const DEVICE_ID_META = 'device_id';
const REQUEST_TIMEOUT_MS = 8_000;

function loadLicenseKey(): string | null {
  const raw = metaGet(LICENSE_KEY_META);
  if (!raw) return null;
  try {
    return decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

function getDeviceId(): string {
  const existing = metaGet(DEVICE_ID_META);
  if (existing) return existing;
  const id = crypto.randomUUID();
  metaSet(DEVICE_ID_META, id);
  return id;
}

function buildUrl(path: string): string {
  return new URL(path, BUILD_CONFIG.LICENSE_API_BASE).toString();
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

async function request<T>(
  path: string,
  opts: RequestOptions = {}
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string; data?: unknown }> {
  const apiKey = loadLicenseKey();
  if (!apiKey) {
    return { ok: false, status: 401, error: 'Not signed in' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(buildUrl(path), {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `B2DM/${app.getVersion?.() ?? 'dev'}`,
      },
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    let data: unknown = undefined;
    try {
      data = await res.json();
    } catch {}

    void checkVersionIfStale().catch(() => {});
    if (!res.ok) {
      const error =
        (data && typeof data === 'object' && 'error' in data && typeof (data as any).error === 'string'
          ? (data as any).error
          : null) ?? `Request failed: ${res.status}`;
      return { ok: false, status: res.status, error, data };
    }
    return { ok: true, status: res.status, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface UsageSnapshot {
  plan: string;
  accounts: { used: number; limit: number | null; remaining: number | null };
  dms: {
    used: number;
    limit: number | null;
    remaining: number | null;
    windowStart: string;
  };
}

export async function fetchUsage(): Promise<UsageSnapshot | null> {
  const res = await request<UsageSnapshot>('/api/b2dm/usage');
  if (!res.ok) return null;
  return res.data;
}

export interface RegisterAccountResult {
  ok: true;
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface RegisterAccountError {
  ok: false;
  status: number;
  code: 'unauthorized' | 'limit_reached' | 'network' | 'unknown';
  message: string;
  used?: number;
  limit?: number | null;
}

export async function registerAccount(
  username: string
): Promise<RegisterAccountResult | RegisterAccountError> {
  const res = await request<{
    used: number;
    limit: number | null;
    remaining: number | null;
  }>('/api/b2dm/accounts/register', {
    method: 'POST',
    body: { username, deviceId: getDeviceId() },
  });
  if (res.ok) {
    return {
      ok: true,
      used: res.data.used,
      limit: res.data.limit,
      remaining: res.data.remaining,
    };
  }
  if (res.status === 401) {
    return { ok: false, status: 401, code: 'unauthorized', message: res.error };
  }
  if (res.status === 403) {
    const data = (res.data ?? {}) as { used?: number; limit?: number | null };
    return {
      ok: false,
      status: 403,
      code: 'limit_reached',
      message: res.error,
      used: data.used,
      limit: data.limit ?? null,
    };
  }
  if (res.status === 0) {
    return { ok: false, status: 0, code: 'network', message: res.error };
  }
  return { ok: false, status: res.status, code: 'unknown', message: res.error };
}

export async function unregisterAccount(username: string): Promise<boolean> {
  const res = await request<{ removed: boolean }>('/api/b2dm/accounts/unregister', {
    method: 'POST',
    body: { username },
  });
  return res.ok;
}

export interface DmReportInput {
  fromUsername: string;
  targetUsername: string;
  sentAt?: number;
}

export interface DmReportResult {
  ok: true;
  used: number;
  limit: number | null;
  remaining: number | null;
  recorded: number;
  dropped: number;
}

export interface DmReportError {
  ok: false;
  status: number;
  code: 'unauthorized' | 'limit_reached' | 'network' | 'unknown';
  message: string;
  used?: number;
  limit?: number | null;
}

export async function reportDms(
  events: DmReportInput[]
): Promise<DmReportResult | DmReportError> {
  if (events.length === 0) {
    return { ok: true, used: 0, limit: null, remaining: null, recorded: 0, dropped: 0 };
  }
  const deviceId = getDeviceId();
  const res = await request<DmReportResult>('/api/b2dm/dms/report', {
    method: 'POST',
    body: {
      events: events.map((e) => ({
        fromUsername: e.fromUsername,
        targetUsername: e.targetUsername,
        deviceId,
        sentAt: e.sentAt ? new Date(e.sentAt).toISOString() : undefined,
      })),
    },
  });
  if (res.ok) {
    return {
      ok: true,
      used: res.data.used,
      limit: res.data.limit,
      remaining: res.data.remaining,
      recorded: res.data.recorded,
      dropped: res.data.dropped,
    };
  }
  if (res.status === 401) {
    return { ok: false, status: 401, code: 'unauthorized', message: res.error };
  }
  if (res.status === 403) {
    const data = (res.data ?? {}) as { used?: number; limit?: number | null };
    return {
      ok: false,
      status: 403,
      code: 'limit_reached',
      message: res.error,
      used: data.used,
      limit: data.limit ?? null,
    };
  }
  if (res.status === 0) {
    return { ok: false, status: 0, code: 'network', message: res.error };
  }
  return { ok: false, status: res.status, code: 'unknown', message: res.error };
}

export function persistLicenseKey(key: string): void {
  const encrypted = encryptString(key);
  metaSet(LICENSE_KEY_META, encrypted.toString('base64'));
}

const BATCH_FLUSH_MS = 5_000;
const BATCH_MAX_EVENTS = 100;

let dmBuffer: DmReportInput[] = [];
let dmFlushTimer: NodeJS.Timeout | null = null;
let dmFlushInFlight = false;
type DmLimitListener = (info: { limit: number | null; used?: number }) => void;
const dmLimitListeners = new Set<DmLimitListener>();

export function onDmLimitReached(cb: DmLimitListener): () => void {
  dmLimitListeners.add(cb);
  return () => dmLimitListeners.delete(cb);
}

function scheduleFlush(): void {
  if (dmFlushTimer) return;
  dmFlushTimer = setTimeout(() => {
    dmFlushTimer = null;
    void flushDmBuffer();
  }, BATCH_FLUSH_MS);
}

export async function flushDmBuffer(): Promise<void> {
  if (dmFlushInFlight) return;
  if (dmBuffer.length === 0) return;
  dmFlushInFlight = true;
  const batch = dmBuffer;
  dmBuffer = [];
  try {
    const res = await reportDms(batch);
    if (res.ok && res.dropped > 0) {

      dmBuffer = [];
      for (const cb of dmLimitListeners) {
        try { cb({ limit: res.limit, used: res.used }); } catch {}
      }
    } else if (!res.ok && res.code === 'limit_reached') {
      dmBuffer = [];
      for (const cb of dmLimitListeners) {
        try { cb({ limit: res.limit ?? null, used: res.used }); } catch {}
      }
    } else if (!res.ok && (res.code === 'network' || res.code === 'unknown')) {

      const cap = BATCH_MAX_EVENTS * 5;
      dmBuffer = batch.concat(dmBuffer).slice(-cap);
      scheduleFlush();
    }
  } finally {
    dmFlushInFlight = false;
    if (dmBuffer.length > 0) scheduleFlush();
  }
}

export function queueDmReport(event: DmReportInput): void {
  dmBuffer.push(event);
  if (dmBuffer.length >= BATCH_MAX_EVENTS) {
    void flushDmBuffer();
    return;
  }
  scheduleFlush();
}
