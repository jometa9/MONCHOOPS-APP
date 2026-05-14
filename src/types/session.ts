

export interface ProfileInfo {
  email: string;
  name: string;
}

export interface SubscriptionInfo {
  plan: string;
  active: boolean;
  version?: string;

  accountLimit?: number | null;
  dmMonthlyLimit?: number | null;
  leadsMonthlyLimit?: number | null;
  accountUsage?: number;
  dmUsage?: number;
  leadUsage?: number;
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
