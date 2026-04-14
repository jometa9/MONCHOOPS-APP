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
