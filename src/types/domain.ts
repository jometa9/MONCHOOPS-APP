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

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobPublic {
  id: string;
  accountId: string | null;
  kind: JobKind;
  params: unknown;
  status: JobStatus;
  startedAt: number;
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
}
