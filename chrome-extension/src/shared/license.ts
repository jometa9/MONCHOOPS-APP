

import type { Profile, Session, Subscription } from './types';
import { EMPTY_SESSION } from './types';

const LICENSE_API_BASE = 'https://b2dm.app';
const STORAGE_KEY_LICENSE = 'b2dm_license_key';
const STORAGE_KEY_PROFILE = 'b2dm_profile';
const STORAGE_KEY_SUB = 'b2dm_subscription';

const MOCK_LICENSE_KEY = '123';

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

  if (trimmed === MOCK_LICENSE_KEY) {
    const profile: Profile = { email: 'mock@b2dm.app', name: 'Mock User' };
    const subscription: Subscription = { plan: 'pro', active: true, version: '0.0.0-mock' };
    await storageSet(STORAGE_KEY_LICENSE, trimmed);
    await storageSet(STORAGE_KEY_PROFILE, profile);
    await storageSet(STORAGE_KEY_SUB, subscription);
    return { hasLicense: true, licenseKey: trimmed, profile, subscription };
  }

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
}
