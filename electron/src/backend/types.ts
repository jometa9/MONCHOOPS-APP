// Shared types between main (backend) and renderer (frontend).
// The renderer imports these via `import('./backend/types').…` in preload.ts
// so it must not depend on any Node-only symbols.

export interface ProfileInfo {
  email: string;
  name: string;
}

export interface SubscriptionInfo {
  plan: string;              // "free" | "pro" | "unlimited" | …
  active: boolean;           // derived: plan !== 'free' && plan !== 'none' && plan
  version?: string;
  // null for fields below means "unlimited" (e.g. on the unlimited plan).
  // Absent means the server didn't return them — treat as unknown, fall back
  // to local-only behaviour and don't enforce limits.
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
