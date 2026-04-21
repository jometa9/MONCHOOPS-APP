import type { SessionSnapshot } from '@/types/session';
import type {
  AccountPublic,
  JobPublic,
  LeadCategoryPublic,
  LeadPublic,
  MassDmInteractionsConfig,
  MassDmResultPublic,
  ScrapeKind,
  ScrapeResultPublic,
  ScrapeUsernameRow,
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

export interface CsvApi {
  pickAndPersist(): Promise<{ path: string; count: number } | null>;
  persistFromPath(srcPath: string): Promise<{ path: string; count: number }>;
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
  csv: CsvApi;
  settings: SettingsApi;
  stats: StatsApi;
  updater: UpdaterApi;
}

declare global {
  interface Window {
    b2dm: B2dmApi;
  }
}

export const b2dm: B2dmApi = window.b2dm;
