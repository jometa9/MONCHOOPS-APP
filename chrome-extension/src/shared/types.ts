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

/* ---------------- Synced mirror entities ---------------- */
//
// Each synced entity carries `updatedAt` (epoch ms, used for last-write-wins
// merging) and an optional `deletedAt` tombstone that propagates deletes
// across the bridge. `pendingPush` is set on rows mutated locally that the
// desktop hasn't acknowledged yet; the sync engine drains them on each
// connect.

export interface SyncedCategory {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Aggregate counts kept on the row for cheap rendering. Sourced from the
   *  desktop on pull; recomputed locally for extension-only categories. */
  leadCount: number;
  scrapeCount: number;
  lastActivityAt: number | null;
  deletedAt?: number | null;
  pendingPush?: boolean;
}

export interface SyncedCategoryLead {
  /** auto-increment local id */
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

/** Mirror of a single completed mass-DM job from the desktop. */
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

/** Mirror of a per-recipient row inside a mass-DM job. Filled on demand
 *  when the user opens the job's detail view. */
export interface SyncedDmSend {
  /** Composite key — jobId+username — used as Dexie's primary. */
  key: string;
  jobId: string;
  username: string;
  status: 'sent' | 'failed';
  message: string | null;
  error: string | null;
  sentAt: number;
  updatedAt: number;
}

/** Mirror of an active job (running or queued) on the desktop. We replace
 *  this table wholesale on every sync — it changes too quickly to bother
 *  with tombstones. */
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
  /** JSON-serialized params blob — kept stringified so Dexie indices are simple. */
  paramsJson: string | null;
  fetchedAt: number;
}

/** Queued local mutation that hasn't been pushed to the desktop yet. The
 *  sync engine drains this queue on connect; failures stay queued for the
 *  next attempt. */
export interface PendingMutation {
  id?: number;
  /** Logical entity, e.g. 'category' | 'variants'. */
  entity: string;
  /** Operation: 'create' | 'update' | 'delete'. */
  op: 'create' | 'update' | 'delete';
  /** Entity primary key. */
  refId: string;
  /** JSON-serialised body sent to the bridge. */
  payload: string;
  createdAt: number;
  /** Number of failed attempts so far. We retry forever but back off in UI. */
  attempts: number;
  lastError?: string | null;
}
