export interface Profile {
  email: string;
  name: string;
}

export interface Subscription {
  plan: string;
  active: boolean;
  version?: string;
}

export interface Session {
  hasLicense: boolean;
  licenseKey: string | null;
  profile: Profile | null;
  subscription: Subscription | null;
}

export const EMPTY_SESSION: Session = {
  hasLicense: false,
  licenseKey: null,
  profile: null,
  subscription: null,
};

export interface Lead {
  /** stable id, autoincrement */
  id?: number;
  /** campaign this lead belongs to */
  campaignId: string;
  /** lowercased, no leading @ */
  username: string;
  /** original casing for display */
  displayName: string;
  /** queue state — drives scheduler decisions */
  status: LeadStatus;
  /** when the lead was actually DMed (status -> sent) */
  sentAt?: number;
  /** message that was actually sent (after variant pick + tokens) */
  sentMessage?: string;
  /** failure reason if status === 'failed' */
  error?: string;
}

export type LeadStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface InteractionsConfig {
  follow: boolean;
  likeCount: number;
  watchStories: boolean;
  storyDwellSec: number;
}

/** Only `running` campaigns are actively progressing. The dashboard locks
 *  navigation while a campaign is in flight so we never run two at once. */
export type CampaignStatus = 'running' | 'paused' | 'done';

export type CampaignSource =
  | { kind: 'manual' }
  | { kind: 'desktop_category'; desktopId: string; label: string }
  | { kind: 'desktop_scrape'; desktopJobId: string; label: string };

export interface Campaign {
  /** uuid */
  id: string;
  name: string;
  createdAt: number;
  /** Where the leads came from. When kind !== 'manual' the campaign is
   *  linked to a live desktop source — CampaignDetail offers a "Sync"
   *  button that re-queries the desktop and pulls in any leads added to
   *  that category/scrape after the campaign was created. */
  source: CampaignSource;
  /** message variants — one is picked at random per send.
   *  Use {{username}} to inject the target's handle. */
  variants: string[];
  /** optional pre-DM interactions */
  interactions: InteractionsConfig | null;
  /** average ms between sends (a small jitter is applied per send) */
  intervalMs: number;
  status: CampaignStatus;
  /** progress counters — kept on the campaign for cheap rendering, the
   *  source of truth for which leads are pending lives in the leads table */
  totalLeads: number;
  sentCount: number;
  failedCount: number;
  /** epoch ms — when the next attempt is allowed (set when paused or
   *  throttled between sends). `running` campaigns past this timestamp
   *  are eligible to send. */
  nextRunAt?: number;
  /** epoch ms — populated when status flips to 'done' */
  completedAt?: number;
}

export interface DmHistoryRow {
  /** uuid */
  id: string;
  campaignId: string;
  campaignName: string;
  username: string;
  status: 'sent' | 'failed';
  message: string;
  error?: string;
  timestamp: number;
}

export interface MetaRow {
  key: string;
  value: string;
}
