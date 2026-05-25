export interface Lead {

  id?: number;

  campaignId: string;

  username: string;

  displayName: string;

  status: LeadStatus;

  sentAt?: number;

  sentMessage?: string;

  error?: string;
}

export type LeadStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

export interface InteractionsConfig {
  follow: boolean;
  likeCount: number;
  watchStories: boolean;
  storyDwellSec: number;
}

export type CampaignStatus = 'running' | 'paused' | 'done';

export type CampaignSource =
  | { kind: 'manual' }
  | { kind: 'desktop_category'; desktopId: string; label: string }
  | { kind: 'desktop_scrape'; desktopJobId: string; label: string };

export interface Campaign {

  id: string;
  name: string;
  createdAt: number;

  source: CampaignSource;

  variants: string[];

  interactions: InteractionsConfig | null;

  intervalMs: number;
  status: CampaignStatus;

  totalLeads: number;
  sentCount: number;
  failedCount: number;

  nextRunAt?: number;

  completedAt?: number;
}

export interface DmHistoryRow {

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

export interface SyncedCategory {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;

  leadCount: number;
  scrapeCount: number;
  lastActivityAt: number | null;
  deletedAt?: number | null;
  pendingPush?: boolean;
}

export interface SyncedCategoryLead {

  id?: number;
  categoryId: string;
  username: string;
  sourceKind: string;
  sourceJobId: string | null;
  sourceDetail: string | null;
  scrapedAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  pendingPush?: boolean;
}

export interface SyncedVariantGroup {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  pendingPush?: boolean;
}

export interface SyncedScrape {
  jobId: string;
  summary: string;
  usernameCount: number;
  completedAt: number;
  targetName: string | null;
  kind: string;
  accountUsername: string | null;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface SyncedDmJob {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  accountProfilePicUrl: string | null;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  completedAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface SyncedDmSend {

  key: string;
  jobId: string;
  username: string;
  status: 'sent' | 'failed';
  message: string | null;
  error: string | null;
  sentAt: number;
  updatedAt: number;
}

export interface SyncedActiveJob {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  accountId: string | null;
  startedAt: number;
  runningAt: number | null;
  finishedAt: number | null;
  progressDone: number;
  progressTotal: number | null;
  error: string | null;

  paramsJson: string | null;
  fetchedAt: number;
}

export interface PendingMutation {
  id?: number;

  entity: string;

  op: 'create' | 'update' | 'delete';

  refId: string;

  payload: string;
  createdAt: number;

  attempts: number;
  lastError?: string | null;
}
