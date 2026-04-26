import type { SessionSnapshot } from '@/types/session';
import type {
  AccountAiSettings,
  AccountPublic,
  AiCostSummary,
  AiLogEntry,
  AiSettings,
  AnthropicModelId,
  AnthropicModelInfo,
  CreateSequenceInput,
  FollowupEnrollmentPublic,
  FollowupSequencePublic,
  FollowupStepPublic,
  InboxMessagePublic,
  InboxSyncStatePublic,
  InboxThreadPublic,
  JobPublic,
  LeadCategoryPublic,
  LeadPublic,
  ListEnrollmentsArgs,
  MassDmInteractionsConfig,
  MassDmResultPublic,
  MassDmSendPublic,
  MessageVariantGroupPublic,
  ResponderMode,
  ScrapeKind,
  ScrapeResultPublic,
  ScrapeUsernameRow,
  StartStoryWatcherArgs,
  WarmupAction,
  WarmupResultPublic,
  WarmupSchedulePublic,
} from '@/types/domain';

type Unsubscribe = () => void;

export interface BulkLoginRow {
  username: string;
  password: string;
  proxyUrl?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

export interface ProxyInput {
  url: string;
  username?: string | null;
  password?: string | null;
}

export interface AccountsApi {
  list(): Promise<AccountPublic[]>;
  get(id: string): Promise<AccountPublic | null>;
  startLogin(proxy?: ProxyInput): Promise<{ jobId: string }>;
  startAutoLogin(
    username: string,
    password: string,
    proxy?: ProxyInput
  ): Promise<{ jobId: string }>;
  retryLogin(id: string, password?: string | null): Promise<{ jobId: string }>;
  startBulkAutoLogin(rows: BulkLoginRow[]): Promise<{ jobId: string }>;
  delete(id: string): Promise<void>;
  updateProxy(payload: {
    id: string;
    url: string | null;
    username: string | null;
    password: string | null;
    enabled?: boolean;
  }): Promise<AccountPublic>;
  onChange(cb: () => void): Unsubscribe;
}

export interface JobsApi {
  list(): Promise<JobPublic[]>;
  listRunning(): Promise<JobPublic[]>;
  listActive(): Promise<JobPublic[]>;
  cancel(jobId: string): Promise<void>;
  startMassDm(payload: {
    accountId: string;
    usernamesCsvPath: string;
    messages: string[];
    intervalMs: number;
    interactions?: MassDmInteractionsConfig | null;
    excludeUsernames?: string[] | null;
  }): Promise<string>;
  startScrape(payload: {
    accountId: string;
    kind: ScrapeKind;
    params: Record<string, unknown>;
  }): Promise<string>;
  startWarmup(payload: {
    accountId: string;
    action: WarmupAction;
  }): Promise<string>;
  onChange(cb: () => void): Unsubscribe;
  onProgress(
    cb: (evt: { jobId: string; done: number; total: number | null; item?: string }) => void
  ): Unsubscribe;
  onDone(cb: (evt: { jobId: string; status: string }) => void): Unsubscribe;
  onAccountDrained(cb: (evt: { accountId: string; status: string }) => void): Unsubscribe;
  onLoginFinished(cb: (evt: { jobId: string; status: string }) => void): Unsubscribe;
}

export interface ScrapesApi {
  list(): Promise<ScrapeResultPublic[]>;
  get(jobId: string): Promise<ScrapeResultPublic | null>;
  listUsernames(jobId: string): Promise<ScrapeUsernameRow[]>;
  download(jobId: string): Promise<string | null>;
  revealInFolder(jobId: string): Promise<void>;
}

export interface MassDmsApi {
  list(): Promise<MassDmResultPublic[]>;
  get(jobId: string): Promise<MassDmResultPublic | null>;
  listSends(jobId: string): Promise<MassDmSendPublic[]>;
  listDmedUsernames(accountId: string): Promise<string[]>;
}

export interface WarmupsApi {
  list(): Promise<WarmupResultPublic[]>;
  listSchedules(accountId?: string): Promise<WarmupSchedulePublic[]>;
  createSchedule(payload: {
    accountId: string;
    startDate: number;
    endDate: number;
    timeOfDaySec: number;
    actions: WarmupAction[];
  }): Promise<WarmupSchedulePublic>;
  deleteSchedule(id: string): Promise<void>;
  onSchedulesChange(cb: () => void): Unsubscribe;
}

export interface CategoriesApi {
  list(): Promise<LeadCategoryPublic[]>;
  create(name: string): Promise<LeadCategoryPublic>;
  rename(id: string, name: string): Promise<LeadCategoryPublic>;
  delete(id: string): Promise<void>;
  listLeads(payload: { categoryId: string; limit?: number; offset?: number }): Promise<LeadPublic[]>;
  exportCsv(categoryId: string): Promise<string | null>;
  onChange(cb: () => void): Unsubscribe;
}

export interface MessageVariantsApi {
  list(): Promise<MessageVariantGroupPublic[]>;
  create(payload: { name: string; variants: string[] }): Promise<MessageVariantGroupPublic>;
  update(payload: {
    id: string;
    name: string;
    variants: string[];
  }): Promise<MessageVariantGroupPublic>;
  delete(id: string): Promise<void>;
  onChange(cb: () => void): Unsubscribe;
}

export interface CsvApi {
  pickAndPersist(): Promise<{ path: string; count: number } | null>;
  persistFromPath(srcPath: string): Promise<{ path: string; count: number }>;
  listUsernames(csvPath: string): Promise<string[]>;
  persistFromUsernames(usernames: string[]): Promise<{ path: string; count: number }>;
  persistFromCategory(categoryId: string): Promise<{ path: string; count: number }>;
  persistFromCategories(categoryIds: string[]): Promise<{ path: string; count: number }>;
  persistFromScrape(jobId: string): Promise<{ path: string; count: number }>;
  persistFromScrapes(jobIds: string[]): Promise<{ path: string; count: number }>;
}

export interface StatsApi {
  get(): Promise<{
    totalJobs: number;
    totalLeads: number;
    totalMessages: number;
    timeSavedMs: number;
  }>;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | {
      kind: 'downloading';
      version: string;
      percent: number;
      bytesPerSecond: number;
      transferred: number;
      total: number;
    }
  | { kind: 'downloaded'; version: string }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

export interface UpdaterApi {
  getState(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<void>;
  installAndRestart(): Promise<void>;
  onStateChange(cb: (state: UpdateStatus) => void): Unsubscribe;
}

export interface SettingsApi {
  refreshSession(): Promise<import('@/types/session').SessionSnapshot>;
  deleteAllAccounts(): Promise<void>;
  deleteAllScrapes(): Promise<void>;
  selectDirectory(): Promise<string | null>;
  getAppVersion(): Promise<string>;
  wipeAllData(): Promise<void>;
  getScrapeExportDir(): Promise<string>;
  setScrapeExportDir(dir: string): Promise<void>;
  getHeadless(): Promise<boolean>;
  setHeadless(headless: boolean): Promise<void>;
  getFullWindow(): Promise<boolean>;
  setFullWindow(full: boolean): Promise<void>;
}

export interface InboxApi {
  listThreads(args?: {
    accountIds?: string[];
    from?: number | null;
    to?: number | null;
    unreadOnly?: boolean;
    query?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<InboxThreadPublic[]>;
  getThread(args: {
    threadId: string;
    limit?: number;
    before?: number | null;
  }): Promise<{ thread: InboxThreadPublic; messages: InboxMessagePublic[] } | null>;
  listSyncStates(): Promise<InboxSyncStatePublic[]>;
  refreshAccount(accountId: string): Promise<string | null>;
  backfillAccount(accountId: string): Promise<string | null>;
  fetchThread(args: { threadId: string; maxMessages?: number }): Promise<string>;
  setActiveMonitoring(args: { accountId: string; enabled: boolean }): Promise<void>;
  setThreadFlags(args: {
    threadId: string;
    flags: { aiResponderEnabled?: boolean; followupDisabled?: boolean; isPinned?: boolean };
  }): Promise<void>;
  sendMessage(args: { threadId: string; text: string }): Promise<string>;
  saveDraft(args: { threadId: string; body: string }): Promise<void>;
  clearDraft(threadId: string): Promise<void>;
  suggestReply(args: {
    threadId: string;
  }): Promise<{ kind: 'draft' | 'send'; body: string; model: string } | null>;
  onChange(cb: (payload: { accountId?: string; threadIds?: string[] }) => void): Unsubscribe;
  onNewInbound(cb: (payload: { accountId: string; count: number }) => void): Unsubscribe;
}

export interface AiApi {
  listModels(): Promise<AnthropicModelInfo[]>;
  getSettings(): Promise<AiSettings>;
  setSettings(input: {
    provider?: 'anthropic';
    model?: AnthropicModelId;
    defaultMaxTokens?: number;
  }): Promise<AiSettings>;
  setApiKey(key: string | null): Promise<AiSettings>;
  hasApiKey(): Promise<boolean>;
  testApiKey(args: {
    apiKey: string;
    model?: AnthropicModelId;
  }): Promise<{ ok: true; model: string } | { ok: false; error: string }>;
  getPrompt(): Promise<{ md: string; defaultMd: string }>;
  setPrompt(md: string): Promise<void>;
  getDefaults(): Promise<{
    historyDepth: number;
    mode: ResponderMode;
    killSwitch: boolean;
    excludeKeywords: string[];
    minInboundLen: number;
    maxAiStreak: number;
  }>;
  setDefaults(input: {
    historyDepth?: number;
    mode?: ResponderMode;
    killSwitch?: boolean;
    excludeKeywords?: string[];
    minInboundLen?: number;
    maxAiStreak?: number;
  }): Promise<void>;
  listAccountSettings(): Promise<AccountAiSettings[]>;
  getAccountSettings(accountId: string): Promise<AccountAiSettings>;
  setAccountSettings(input: AccountAiSettings): Promise<AccountAiSettings>;
  listLog(limit?: number): Promise<AiLogEntry[]>;
  getMonthCost(): Promise<AiCostSummary>;
}

export interface FollowupsApi {
  listSequences(includeArchived?: boolean): Promise<FollowupSequencePublic[]>;
  getSequence(
    id: string
  ): Promise<{ sequence: FollowupSequencePublic; steps: FollowupStepPublic[] } | null>;
  createSequence(input: CreateSequenceInput): Promise<FollowupSequencePublic>;
  updateSequence(args: {
    id: string;
    input: CreateSequenceInput;
  }): Promise<FollowupSequencePublic>;
  archiveSequence(id: string): Promise<void>;
  listEnrollments(args?: ListEnrollmentsArgs): Promise<FollowupEnrollmentPublic[]>;
  enrollPeer(args: {
    sequenceId: string;
    accountId: string;
    peerUsername: string;
    threadId?: string | null;
  }): Promise<FollowupEnrollmentPublic>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface StoryWatcherApi {
  start(args: StartStoryWatcherArgs): Promise<string>;
}

export interface B2dmApi {
  // Platform
  getPlatform(): Promise<NodeJS.Platform>;
  getIsFullScreen(): Promise<boolean>;
  onFullScreenChange(cb: (isFullScreen: boolean) => void): Unsubscribe;
  setWindowButtonPosition(x: number | null, y: number | null): Promise<void>;
  openExternalLink(url: string): Promise<void>;
  onSystemSuspend(cb: () => void): Unsubscribe;
  onSystemResume(cb: () => void): Unsubscribe;
  onPrepareQuit(cb: () => void): Unsubscribe;
  quitReady(): void;
  onNavigateToSettings(cb: () => void): Unsubscribe;
  onDeepLink(cb: (data: { url: string }) => void): Unsubscribe;
  getPendingDeepLink(): Promise<string | null>;
  clearPendingDeepLink(url: string): Promise<void>;

  // Session
  getSession(): Promise<SessionSnapshot>;
  validateLicense(licenseKey: string): Promise<SessionSnapshot>;
  logout(): Promise<void>;
  onSessionChange(cb: (snapshot: SessionSnapshot) => void): Unsubscribe;

  accounts: AccountsApi;
  jobs: JobsApi;
  scrapes: ScrapesApi;
  massDms: MassDmsApi;
  warmups: WarmupsApi;
  categories: CategoriesApi;
  messageVariants: MessageVariantsApi;
  csv: CsvApi;
  settings: SettingsApi;
  stats: StatsApi;
  updater: UpdaterApi;
  inbox: InboxApi;
  ai: AiApi;
  followups: FollowupsApi;
  storyWatcher: StoryWatcherApi;
}

declare global {
  interface Window {
    b2dm: B2dmApi;
  }
}

export const b2dm: B2dmApi = window.b2dm;
