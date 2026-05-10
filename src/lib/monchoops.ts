import type { SessionSnapshot } from '@/types/session';
import type {
  AccountPublic,
  JobPublic,
  LeadCategoryPublic,
  LeadPublic,
  MassDmInteractionsConfig,
  MassDmResultPublic,
  MassDmSendPublic,
  MessageVariantGroupPublic,
  ScrapeKind,
  ScrapeResultPublic,
  ScrapeUsernameRow,
} from '@/types/domain';

type Unsubscribe = () => void;

export interface UsageSnapshot {
  plan: string;
  accounts: { used: number; limit: number | null; remaining: number | null };
  dms: {
    used: number;
    limit: number | null;
    remaining: number | null;
    windowStart: string;
  };
}

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
  | {
      kind: 'available';
      version: string;
      currentVersion: string;
      downloadUrl: string;
    }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

export interface UpdaterApi {
  getState(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<void>;
  openDownload(): Promise<void>;
  onStateChange(cb: (state: UpdateStatus) => void): Unsubscribe;
  getExtensionUrl(): Promise<string>;
  onExtensionUrlChange(cb: (url: string) => void): Unsubscribe;
}

export interface BridgeStatus {
  running: boolean;
  port: number | null;
}

export interface BridgeApi {
  getStatus(): Promise<BridgeStatus>;
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

export interface MonchoOpsApi {

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

  getSession(): Promise<SessionSnapshot>;
  validateLicense(licenseKey: string): Promise<SessionSnapshot>;
  logout(): Promise<void>;
  onSessionChange(cb: (snapshot: SessionSnapshot) => void): Unsubscribe;
  getUsage(): Promise<UsageSnapshot | null>;

  accounts: AccountsApi;
  jobs: JobsApi;
  scrapes: ScrapesApi;
  massDms: MassDmsApi;
  categories: CategoriesApi;
  messageVariants: MessageVariantsApi;
  csv: CsvApi;
  settings: SettingsApi;
  stats: StatsApi;
  updater: UpdaterApi;
  bridge: BridgeApi;
}

declare global {
  interface Window {
    monchoops: MonchoOpsApi;
  }
}

export const monchoops: MonchoOpsApi = window.monchoops;
