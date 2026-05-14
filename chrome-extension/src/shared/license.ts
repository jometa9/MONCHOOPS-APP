

import type { Profile, Session, Subscription, UsageSnapshot } from './types';
import { EMPTY_SESSION } from './types';

const LICENSE_API_BASE = 'https://monchoops.com';
const STORAGE_KEY_LICENSE = 'monchoops_license_key';
const STORAGE_KEY_PROFILE = 'monchoops_profile';
const STORAGE_KEY_SUB = 'monchoops_subscription';
const STORAGE_KEY_USAGE = 'monchoops_usage';
const STORAGE_KEY_DM_QUEUE = 'monchoops_dm_queue';

const REQUEST_TIMEOUT_MS = 8_000;
const BATCH_MAX_EVENTS = 100;
const BATCH_FLUSH_MS = 5_000;
const QUEUE_MAX = BATCH_MAX_EVENTS * 5;

interface ExternalLicenseResponse {
  email?: string;
  name?: string;
  plan?: string;
  version?: string;
}

function normalisePlan(plan?: string): { plan: string; active: boolean } {
  const p = (plan ?? '').trim().toLowerCase();
  if (!p || p === 'free' || p === 'none' || p === 'expired' || p === 'cancelled') {
    return { plan: p || 'free', active: false };
  }
  return { plan: p, active: true };
}

async function storageGet<T>(key: string): Promise<T | null> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? null;
}

async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function storageRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

interface RequestResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function authedRequest<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown } = {}
): Promise<RequestResult<T>> {
  const licenseKey = await storageGet<string>(STORAGE_KEY_LICENSE);
  if (!licenseKey) return { ok: false, status: 401, data: null, error: 'not_signed_in' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(new URL(path, LICENSE_API_BASE).toString(), {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${licenseKey}`,
        'Content-Type': 'application/json',
      },
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data: data as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function getSession(): Promise<Session> {
  const licenseKey = await storageGet<string>(STORAGE_KEY_LICENSE);
  if (!licenseKey) return EMPTY_SESSION;
  const profile = await storageGet<Profile>(STORAGE_KEY_PROFILE);
  const subscription = await storageGet<Subscription>(STORAGE_KEY_SUB);
  return {
    hasLicense: true,
    licenseKey,
    profile: profile ?? null,
    subscription: subscription ?? null,
  };
}

export async function validateLicense(licenseKey: string): Promise<Session> {
  const trimmed = licenseKey.trim();
  if (!trimmed) throw new Error('License key is required');

  const url = new URL('/api/validate-subscription', LICENSE_API_BASE);
  url.searchParams.set('apiKey', trimmed);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET' });
  } catch {
    throw new Error('Could not reach the license server. Check your connection.');
  }

  const body = await res.text();
  if (!res.ok) {
    let msg = `License server returned ${res.status}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) msg = parsed.error;
    } catch {}
    throw new Error(msg);
  }

  let data: ExternalLicenseResponse;
  try {
    data = JSON.parse(body) as ExternalLicenseResponse;
  } catch {
    throw new Error('License server returned an unexpected response');
  }

  const email = (data.email ?? '').trim();
  if (!email) throw new Error('License server response is missing the account email');

  const profile: Profile = { email, name: data.name ?? '' };
  const { plan, active } = normalisePlan(data.plan);
  const subscription: Subscription = { plan, active, version: data.version };

  await storageSet(STORAGE_KEY_LICENSE, trimmed);
  await storageSet(STORAGE_KEY_PROFILE, profile);
  await storageSet(STORAGE_KEY_SUB, subscription);

  return { hasLicense: true, licenseKey: trimmed, profile, subscription };
}

export async function logout(): Promise<void> {
  await storageRemove(STORAGE_KEY_LICENSE);
  await storageRemove(STORAGE_KEY_PROFILE);
  await storageRemove(STORAGE_KEY_SUB);
  await storageRemove(STORAGE_KEY_USAGE);
  await storageRemove(STORAGE_KEY_DM_QUEUE);
}

export async function fetchUsage(): Promise<UsageSnapshot | null> {
  const res = await authedRequest<UsageSnapshot>('/api/monchoops/usage');
  if (!res.ok) {
    if (res.status === 0) {
      return storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
    }
    return null;
  }
  if (!res.data) return null;
  await storageSet(STORAGE_KEY_USAGE, res.data);
  return res.data;
}

export async function getCachedUsage(): Promise<UsageSnapshot | null> {
  return storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
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
  const res = await authedRequest<{
    used: number;
    limit: number | null;
    remaining: number | null;
  }>('/api/monchoops/accounts/register', {
    method: 'POST',
    body: { username },
  });
  if (res.ok && res.data) {
    return { ok: true, used: res.data.used, limit: res.data.limit, remaining: res.data.remaining };
  }
  if (res.status === 401) return { ok: false, status: 401, code: 'unauthorized', message: res.error ?? 'unauthorized' };
  if (res.status === 403) {
    const d = (res.data ?? {}) as { used?: number; limit?: number | null; error?: string };
    return {
      ok: false,
      status: 403,
      code: 'limit_reached',
      message: d.error ?? 'limit_reached',
      used: d.used,
      limit: d.limit ?? null,
    };
  }
  if (res.status === 0) return { ok: false, status: 0, code: 'network', message: res.error ?? 'network' };
  return { ok: false, status: res.status, code: 'unknown', message: res.error ?? 'unknown' };
}

export async function unregisterAccount(username: string): Promise<boolean> {
  const res = await authedRequest<{ removed: boolean }>('/api/monchoops/accounts/unregister', {
    method: 'POST',
    body: { username },
  });
  return res.ok;
}

export interface DmReportEvent {
  fromUsername: string;
  targetUsername: string;
  sentAt?: number;
}

export interface DmReportResponse {
  ok: boolean;
  status: number;
  limitReached: boolean;
  recorded?: number;
  dropped?: number;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
}

async function reportDmsInternal(events: DmReportEvent[]): Promise<DmReportResponse> {
  if (events.length === 0) {
    return { ok: true, status: 200, limitReached: false, recorded: 0, dropped: 0 };
  }
  const res = await authedRequest<any>('/api/monchoops/dms/report', {
    method: 'POST',
    body: {
      events: events.map((e) => ({
        fromUsername: e.fromUsername,
        targetUsername: e.targetUsername,
        sentAt: e.sentAt ? new Date(e.sentAt).toISOString() : undefined,
      })),
    },
  });

  const data = res.data;

  if (res.status === 403) {
    if (data) {
      const cached = await storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
      await storageSet(STORAGE_KEY_USAGE, {
        plan: data.plan ?? cached?.plan ?? 'free',
        accounts: cached?.accounts ?? { used: 0, limit: null, remaining: null },
        dms: {
          used: data.used ?? 0,
          limit: data.limit ?? null,
          remaining: 0,
          windowStart: cached?.dms?.windowStart ?? new Date().toISOString(),
        },
        leads: cached?.leads ?? { used: 0, limit: null, remaining: null, windowStart: new Date().toISOString() },
      });
    }
    return {
      ok: false,
      status: 403,
      limitReached: true,
      used: data?.used,
      limit: data?.limit ?? null,
      remaining: 0,
      dropped: data?.dropped,
      recorded: data?.recorded ?? 0,
    };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, limitReached: false };
  }

  if (data) {
    const cached = await storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
    await storageSet(STORAGE_KEY_USAGE, {
      plan: data.plan ?? cached?.plan ?? 'free',
      accounts: cached?.accounts ?? { used: 0, limit: null, remaining: null },
      dms: {
        used: data.used ?? 0,
        limit: data.limit ?? null,
        remaining: data.remaining ?? null,
        windowStart: cached?.dms?.windowStart ?? new Date().toISOString(),
      },
      leads: cached?.leads ?? { used: 0, limit: null, remaining: null, windowStart: new Date().toISOString() },
    });
  }

  return {
    ok: true,
    status: res.status,
    limitReached: (data?.dropped ?? 0) > 0 && (data?.remaining ?? null) === 0,
    recorded: data?.recorded ?? events.length,
    dropped: data?.dropped ?? 0,
    used: data?.used,
    limit: data?.limit ?? null,
    remaining: data?.remaining ?? null,
  };
}

type DmLimitListener = (info: { limit: number | null; used?: number }) => void;
const dmLimitListeners = new Set<DmLimitListener>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

export function onDmLimitReached(cb: DmLimitListener): () => void {
  dmLimitListeners.add(cb);
  return () => dmLimitListeners.delete(cb);
}

async function readQueue(): Promise<DmReportEvent[]> {
  return (await storageGet<DmReportEvent[]>(STORAGE_KEY_DM_QUEUE)) ?? [];
}

async function writeQueue(events: DmReportEvent[]): Promise<void> {
  if (events.length === 0) {
    await storageRemove(STORAGE_KEY_DM_QUEUE);
  } else {
    await storageSet(STORAGE_KEY_DM_QUEUE, events.slice(-QUEUE_MAX));
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushDmBuffer();
  }, BATCH_FLUSH_MS);
}

export async function queueDmReport(event: DmReportEvent): Promise<void> {
  const queue = await readQueue();
  queue.push(event);
  await writeQueue(queue);
  if (queue.length >= BATCH_MAX_EVENTS) {
    void flushDmBuffer();
    return;
  }
  scheduleFlush();
}

export async function flushDmBuffer(): Promise<DmReportResponse | null> {
  if (flushInFlight) return null;
  const queue = await readQueue();
  if (queue.length === 0) return null;

  flushInFlight = true;
  try {
    await writeQueue([]);
    const res = await reportDmsInternal(queue);

    if (!res.ok && res.status === 0) {

      const current = await readQueue();
      await writeQueue([...queue, ...current]);
      scheduleFlush();
      return res;
    }

    if (res.limitReached) {
      for (const cb of dmLimitListeners) {
        try { cb({ limit: res.limit ?? null, used: res.used }); } catch {}
      }
    }
    return res;
  } finally {
    flushInFlight = false;
    const remaining = await readQueue();
    if (remaining.length > 0) scheduleFlush();
  }
}

export async function reportDms(events: DmReportEvent[]): Promise<DmReportResponse> {
  return reportDmsInternal(events);
}
