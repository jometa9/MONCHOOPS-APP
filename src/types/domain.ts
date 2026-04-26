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
  proxyEnabled: boolean;
  hasProxyPassword: boolean;
  hasStoredPassword: boolean;
  status: AccountStatus;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  warmupActiveDays: number;
  lastWarmupAt: number | null;
  isWarmed: boolean;
}

export type JobKind =
  | 'login'
  | 'mass_dm'
  | 'scrape_by_username'
  | 'scrape_by_post'
  | 'scrape_by_hashtag'
  | 'scrape_by_location'
  | 'warmup'
  | 'inbox_poll'
  | 'inbox_backfill'
  | 'inbox_thread_fetch'
  | 'inbox_send'
  | 'story_watcher'
  | 'followup_send';

export type ScrapeKind = Extract<
  JobKind,
  'scrape_by_username' | 'scrape_by_post' | 'scrape_by_hashtag' | 'scrape_by_location'
>;

export type WarmupAction =
  | { type: 'view_feed'; durationSec: number }
  | { type: 'view_explore'; durationSec: number }
  | { type: 'view_reels'; durationSec: number }
  | { type: 'view_feed_stories'; maxRings: number; perStoryDwellSec: number }
  | { type: 'hashtag_like'; hashtag: string; count: number }
  | { type: 'hashtag_follow'; hashtag: string; count: number }
  | { type: 'location_like'; location: string; count: number }
  | { type: 'location_follow'; location: string; count: number }
  | {
      type: 'combo';
      feedSec: number;
      exploreSec: number;
      reelsSec: number;
      hashtag: string | null;
      location: string | null;
      likeCount: number;
      followCount: number;
    };

export interface MassDmInteractionsConfig {
  follow: boolean;
  likeCount: number;
  watchStories?: boolean;
  storyDwellSec?: number;
}

export interface InboxThreadPublic {
  id: string;
  accountId: string;
  accountUsername: string | null;
  accountProfilePicUrl: string | null;
  igThreadId: string;
  peerUsername: string;
  peerDisplayName: string | null;
  peerPicUrl: string | null;
  isGroup: boolean;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
  isPinned: boolean;
  aiResponderEnabled: boolean;
  followupDisabled: boolean;
  historyBackfilledAt: number | null;
  createdAt: number;
  updatedAt: number;
  draft: { body: string; model: string | null; createdAt: number } | null;
}

export interface InboxMessagePublic {
  id: string;
  threadId: string;
  igMessageId: string | null;
  direction: 'in' | 'out';
  senderUsername: string;
  body: string | null;
  mediaKind: string | null;
  mediaCaption: string | null;
  sentAt: number;
  source: string;
}

export interface InboxSyncStatePublic {
  accountId: string;
  lastPollStartedAt: number | null;
  lastPollFinishedAt: number | null;
  lastPollStatus: string | null;
  lastPollError: string | null;
  threadsSeen: number;
  activeMonitoring: boolean;
  nextPollDueAt: number | null;
}

export type AnthropicModelId =
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-7'
  | 'claude-haiku-4-5';

export interface AnthropicModelInfo {
  id: AnthropicModelId;
  label: string;
  description: string;
  inputCostPerMTok: number;
  outputCostPerMTok: number;
  cacheReadCostPerMTok: number;
  cacheWriteCostPerMTok: number;
}

export interface AiSettings {
  provider: 'anthropic';
  model: AnthropicModelId;
  defaultMaxTokens: number;
  hasApiKey: boolean;
}

export type ResponderMode = 'suggest' | 'auto';

export interface AccountAiSettings {
  accountId: string;
  enabled: boolean;
  mode: ResponderMode;
  maxPerHour: number;
  maxPerDay: number;
}

export interface AiLogEntry {
  id: number;
  threadId: string;
  messageId: string | null;
  status: string;
  reason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  model: string | null;
  createdAt: number;
}

export interface AiCostSummary {
  monthSentCount: number;
  monthSuggestedCount: number;
  monthCostUsd: number;
}

export interface FollowupSequencePublic {
  id: string;
  name: string;
  isArchived: boolean;
  stepCount: number;
  activeEnrollmentCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FollowupStepPublic {
  id: string;
  sequenceId: string;
  stepIndex: number;
  delayHours: number;
  variantIds: number[];
  stopOnReply: boolean;
}

export type FollowupEnrollmentStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'replied';

export interface FollowupEnrollmentPublic {
  id: string;
  sequenceId: string;
  sequenceName: string | null;
  accountId: string;
  accountUsername: string | null;
  threadId: string | null;
  peerUsername: string;
  currentStepIndex: number;
  status: FollowupEnrollmentStatus;
  enrolledAt: number;
  nextRunAt: number;
  lastStepRunAt: number | null;
  cancelledReason: string | null;
}

export interface CreateSequenceInput {
  name: string;
  steps: Array<{ delayHours: number; variantIds: number[]; stopOnReply: boolean }>;
}

export interface ListEnrollmentsArgs {
  status?: FollowupEnrollmentStatus | null;
  accountId?: string | null;
  threadId?: string | null;
  limit?: number;
}

export interface StartStoryWatcherArgs {
  accountId: string;
  usernames: string[];
  perUserDwellSec: number;
  intervalBetweenUsersSec: number;
  skipIfNoStory: boolean;
  maxStoriesPerUser: number;
}

export interface WarmupResultPublic {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  actionType: WarmupAction['type'];
  action: WarmupAction;
  visited: number;
  liked: number;
  followed: number;
  skipped: number;
  failed: number;
  viewedMs: number;
  durationMs: number;
  completedAt: number;
}

export interface WarmupSchedulePublic {
  id: string;
  accountId: string;
  startDate: number;
  endDate: number;
  timeOfDaySec: number;
  actions: WarmupAction[];
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

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

export type ScrapeResultStatus = 'completed' | 'cancelled' | 'failed';

export interface ScrapeResultPublic {
  jobId: string;
  kind: JobKind;
  summary: string;
  usernameCount: number;
  csvPath: string | null;
  durationMs: number;
  completedAt: number;
  categoryId: string | null;
  categoryName: string | null;
  status: ScrapeResultStatus;
  error: string | null;
  accountId: string | null;
  accountUsername: string | null;
  params: unknown;
  targetName: string | null;
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
  accountProfilePicUrl: string | null;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  completedAt: number;
}

export interface MassDmSendPublic {
  jobId: string;
  accountId: string | null;
  username: string;
  status: 'sent' | 'failed';
  message: string | null;
  error: string | null;
  sentAt: number;
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

export interface MessageVariantGroupPublic {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
}
