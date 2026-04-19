// Domain types mirrored from electron/src/backend. Keep in sync with
// electron/src/backend/accounts.ts and electron/src/backend/jobs.ts.

export type AccountStatus = 'idle' | 'busy' | 'error';

export interface AccountPublic {
  id: string;
  username: string;
  displayName: string | null;
  profilePicUrl: string | null;
  userAgent: string;
  proxyUrl: string | null;
  proxyUsername: string | null;
  hasProxyPassword: boolean;
  hasStoredPassword: boolean;
  status: AccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type JobKind =
  | 'login'
  | 'mass_dm'
  | 'scrape_by_username'
  | 'scrape_by_post'
  | 'scrape_by_hashtag'
  | 'scrape_by_location';

export type ScrapeKind = Exclude<JobKind, 'login' | 'mass_dm'>;

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobPublic {
  id: string;
  accountId: string | null;
  kind: JobKind;
  params: unknown;
  status: JobStatus;
  startedAt: number;
  runningAt: number | null;
  endedAt: number | null;
  progressDone: number;
  progressTotal: number | null;
  error: string | null;
}

export interface ScrapeResultPublic {
  jobId: string;
  kind: JobKind;
  summary: string;
  usernameCount: number;
  csvPath: string;
  durationMs: number;
  completedAt: number;
  categoryId: string | null;
  categoryName: string | null;
}

export interface ScrapeUsernameRow {
  username: string;
  source: string | null;
  sourceRef: string | null;
}

export interface MassDmResultPublic {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  completedAt: number;
}

export interface LeadCategoryPublic {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  leadCount: number;
  scrapeCount: number;
  lastActivityAt: number | null;
}

export interface LeadPublic {
  id: number;
  categoryId: string;
  username: string;
  sourceKind: string;
  sourceJobId: string | null;
  sourceDetail: string | null;
  scrapedAt: number;
}
