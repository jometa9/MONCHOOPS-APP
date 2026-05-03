// Mirror of electron/src/backend/types.ts. Kept duplicated deliberately:
// Vite compiles src/ and tsc compiles electron/ as separate projects with
// non-overlapping rootDirs, so we can't share a single file. If you change
// one, change the other.

export interface ProfileInfo {
  email: string;
  name: string;
}

export interface SubscriptionInfo {
  plan: string;
  active: boolean;
  version?: string;
  // null means "unlimited" (e.g. on the unlimited plan).
  // Absent means the server didn't return them yet (e.g. mock session,
  // older backend). Treat absent as "unknown — don't show counters".
  accountLimit?: number | null;
  dmMonthlyLimit?: number | null;
  accountUsage?: number;
  dmUsage?: number;
}

export interface SessionSnapshot {
  hasLicense: boolean;
  profile: ProfileInfo | null;
  subscription: SubscriptionInfo | null;
}

export const EMPTY_SESSION: SessionSnapshot = {
  hasLicense: false,
  profile: null,
  subscription: null,
};
