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

export interface ScheduleWindow {
  /** 0 = Sunday, 1 = Monday, … 6 = Saturday */
  daysOfWeek: number[];
  /** "HH:MM" 24h, inclusive */
  startTime: string;
  /** "HH:MM" 24h, inclusive */
  endTime: string;
  /** average ms between sends inside the window */
  intervalMs: number;
}

export type CampaignStatus = 'draft' | 'running' | 'scheduled' | 'paused' | 'done';

export interface Campaign {
  /** uuid */
  id: string;
  name: string;
  createdAt: number;
  /** message variants — one is picked at random per send.
   *  Use {{username}} to inject the target's handle. */
  variants: string[];
  /** optional pre-DM interactions */
  interactions: InteractionsConfig | null;
  /** when null, send back-to-back; when set, only send during the window */
  schedule: ScheduleWindow | null;
  status: CampaignStatus;
  /** progress counters — kept on the campaign for cheap rendering, the
   *  source of truth for which leads are pending lives in the leads table */
  totalLeads: number;
  sentCount: number;
  failedCount: number;
  /** epoch ms — when the next attempt is allowed (set when paused, throttled,
   *  or outside the schedule window) */
  nextRunAt?: number;
  /** epoch ms — populated when status flips to 'done' */
  completedAt?: number;
}

export interface VariantGroup {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
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
