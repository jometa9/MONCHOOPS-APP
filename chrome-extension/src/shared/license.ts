

import type { Profile, Session, Subscription, UsageSnapshot } from './types';
import { EMPTY_SESSION } from './types';

const LICENSE_API_BASE = 'https://monchoops.com';
const STORAGE_KEY_LICENSE = 'monchoops_license_key';
const STORAGE_KEY_PROFILE = 'monchoops_profile';
const STORAGE_KEY_SUB = 'monchoops_subscription';
const STORAGE_KEY_USAGE = 'monchoops_usage';

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
}

export async function fetchUsage(): Promise<UsageSnapshot | null> {
  const licenseKey = await storageGet<string>(STORAGE_KEY_LICENSE);
  if (!licenseKey) return null;

  let res: Response;
  try {
    res = await fetch(new URL('/api/monchoops/usage', LICENSE_API_BASE).toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${licenseKey}` },
    });
  } catch {
    const cached = await storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
    return cached;
  }
  if (!res.ok) return null;

  let data: UsageSnapshot;
  try {
    data = (await res.json()) as UsageSnapshot;
  } catch {
    return null;
  }
  await storageSet(STORAGE_KEY_USAGE, data);
  return data;
}

export async function getCachedUsage(): Promise<UsageSnapshot | null> {
  return storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
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

export async function reportDms(events: DmReportEvent[]): Promise<DmReportResponse> {
  if (events.length === 0) {
    return { ok: true, status: 200, limitReached: false, recorded: 0, dropped: 0 };
  }
  const licenseKey = await storageGet<string>(STORAGE_KEY_LICENSE);
  if (!licenseKey) {
    return { ok: false, status: 401, limitReached: false };
  }

  let res: Response;
  try {
    res = await fetch(
      new URL('/api/monchoops/dms/report', LICENSE_API_BASE).toString(),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${licenseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          events: events.map((e) => ({
            fromUsername: e.fromUsername,
            targetUsername: e.targetUsername,
            sentAt: e.sentAt ? new Date(e.sentAt).toISOString() : undefined,
          })),
        }),
      }
    );
  } catch {
    return { ok: false, status: 0, limitReached: false };
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {}

  if (res.status === 403) {
    if (data) {
      const cached = await storageGet<UsageSnapshot>(STORAGE_KEY_USAGE);
      await storageSet(STORAGE_KEY_USAGE, {
        plan: data.plan ?? cached?.plan ?? 'free',
        accounts:
          cached?.accounts ?? { used: 0, limit: null, remaining: null },
        dms: {
          used: data.used ?? 0,
          limit: data.limit ?? null,
          remaining: 0,
          windowStart:
            cached?.dms.windowStart ?? new Date().toISOString(),
        },
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
        windowStart: cached?.dms.windowStart ?? new Date().toISOString(),
      },
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
