// Talks to the MonchoOps landing API to enforce per-user plan limits across
// devices. The local SQLite DB is still authoritative for cookies and worker
// state — this module only mirrors "which IG accounts has the user connected
// in total" and "how many DMs has the user sent this month" so the server
// can refuse over-quota actions.
//
// All calls are best-effort with a short timeout: if the server is offline
// we don't block the user from using already-authenticated accounts. The
// register/check-quota call BEFORE adding an account is the only hard
// barrier — that one returns 403 if the user is already at their plan limit.

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

// Stable per-install identifier. Used purely as a tag on usage rows so the
// server can later show "added on this device". Not used for auth.
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
    // Piggyback an app-version freshness check on every landing call. The
    // helper is internally rate-limited to once per 24h, so calling it on
    // hot paths is cheap.
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
  sentAt?: number; // epoch ms
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

// Re-encrypt a license key into the on-disk slot. Wrapper kept here so
// license.ts can avoid importing crypto helpers in two places when we add
// new fields later. Currently unused but reserved for the next iteration.
export function persistLicenseKey(key: string): void {
  const encrypted = encryptString(key);
  metaSet(LICENSE_KEY_META, encrypted.toString('base64'));
}

// ---- DM event batcher ----------------------------------------------------
//
// Mass DM jobs fire one IPC `dm-send` per recipient. Round-tripping each one
// to the cloud would burn 5k requests for a single Pro-tier monthly run, so
// we buffer them and flush every BATCH_FLUSH_MS or when the queue hits
// BATCH_MAX_EVENTS, whichever comes first. Buffer survives crashes only as
// long as the process — that's deliberate: a hard crash mid-batch loses at
// most a few DM-counter rows and we'd rather under-count than double-count.

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
      // Server trimmed the batch because the user hit the monthly DM cap.
      // Drop the rest of the buffer too — there's no point sending more
      // until the limit resets next month.
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
      // Transient — put events back at the head and retry on the next flush.
      // We cap the re-queue at 5x the normal max so a long outage doesn't
      // grow memory unbounded; older events get dropped first.
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
