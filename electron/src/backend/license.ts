import { BUILD_CONFIG } from '../buildConfig';
import { encryptString, decryptString } from './crypto';
import { metaGet, metaSet, metaGetJson, metaSetJson } from './db';
import type { ProfileInfo, SessionSnapshot, SubscriptionInfo } from './types';
import { EMPTY_SESSION } from './types';
import { wipeUserData } from './userData';
import { checkVersionIfStale } from './updater';

const LICENSE_KEY_META = 'license_key_encrypted';
const PROFILE_META = 'profile';
const SUBSCRIPTION_META = 'subscription';

const LAST_OWNER_EMAIL_META = 'last_owner_email';

interface ExternalLicenseResponse {
  email?: string;
  name?: string;
  plan?: string;
  version?: string;
  accountLimit?: number | null;
  dmMonthlyLimit?: number | null;
  accountUsage?: number;
  dmUsage?: number;
}

function normalisePlan(plan?: string): { plan: string; active: boolean } {
  const p = (plan ?? '').trim().toLowerCase();
  if (!p || p === 'free' || p === 'none' || p === 'expired' || p === 'cancelled') {
    return { plan: p || 'free', active: false };
  }
  return { plan: p, active: true };
}

function saveLicenseKey(key: string): void {
  const encrypted = encryptString(key);
  metaSet(LICENSE_KEY_META, encrypted.toString('base64'));
}

function loadLicenseKey(): string | null {
  const raw = metaGet(LICENSE_KEY_META);
  if (!raw) return null;
  try {
    return decryptString(Buffer.from(raw, 'base64'));
  } catch {
    return null;
  }
}

function saveProfile(profile: ProfileInfo): void {
  metaSetJson(PROFILE_META, profile);
}

function saveSubscription(sub: SubscriptionInfo): void {
  metaSetJson(SUBSCRIPTION_META, sub);
}

function ensureOwnerMatches(incomingEmail: string): void {
  const normalized = incomingEmail.trim().toLowerCase();
  if (!normalized) return;
  const previous = metaGet(LAST_OWNER_EMAIL_META);
  if (previous && previous !== normalized) {
    wipeUserData();
  }
  metaSet(LAST_OWNER_EMAIL_META, normalized);
}

export function getSession(): SessionSnapshot {
  const licenseKey = loadLicenseKey();
  if (!licenseKey) return EMPTY_SESSION;
  const profile = metaGetJson<ProfileInfo>(PROFILE_META);
  const subscription = metaGetJson<SubscriptionInfo>(SUBSCRIPTION_META);
  return {
    hasLicense: true,
    profile: profile ?? null,
    subscription: subscription ?? null,
  };
}

export async function validateLicense(licenseKey: string): Promise<SessionSnapshot> {
  const trimmed = licenseKey.trim();
  if (!trimmed) throw new Error('License key is required');

  const url = new URL('/api/validate-subscription', BUILD_CONFIG.LICENSE_API_BASE);
  url.searchParams.set('apiKey', trimmed);

  let res: Response;
  try {
    res = await fetch(url.toString(), { method: 'GET' });
  } catch {
    throw new Error('Could not reach the license server. Check your connection.');
  }

  void checkVersionIfStale().catch(() => {});

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

  const profile: ProfileInfo = { email, name: data.name ?? '' };
  const { plan, active } = normalisePlan(data.plan);
  const subscription: SubscriptionInfo = {
    plan,
    active,
    version: data.version,
    accountLimit:
      data.accountLimit === null || typeof data.accountLimit === 'number'
        ? data.accountLimit
        : undefined,
    dmMonthlyLimit:
      data.dmMonthlyLimit === null || typeof data.dmMonthlyLimit === 'number'
        ? data.dmMonthlyLimit
        : undefined,
    accountUsage:
      typeof data.accountUsage === 'number' ? data.accountUsage : undefined,
    dmUsage: typeof data.dmUsage === 'number' ? data.dmUsage : undefined,
  };

  ensureOwnerMatches(email);
  saveLicenseKey(trimmed);
  saveProfile(profile);
  saveSubscription(subscription);

  return { hasLicense: true, profile, subscription };
}

export async function refreshSession(): Promise<SessionSnapshot> {
  const key = loadLicenseKey();
  if (!key) return EMPTY_SESSION;
  return validateLicense(key);
}

export function logout(): void {
  metaSet(LICENSE_KEY_META, null);
  metaSet(PROFILE_META, null);
  metaSet(SUBSCRIPTION_META, null);
}
