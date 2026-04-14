import type { SessionSnapshot } from '@/types/session';
import type {
  AccountPublic,
  JobPublic,
  ScrapeKind,
  ScrapeResultPublic,
} from '@/types/domain';

type Unsubscribe = () => void;

export interface AccountsApi {
  list(): Promise<AccountPublic[]>;
  get(id: string): Promise<AccountPublic | null>;
  startLogin(): Promise<{ jobId: string }>;
  delete(id: string): Promise<void>;
  updateProxy(payload: {
    id: string;
    url: string | null;
    username: string | null;
    password: string | null;
  }): Promise<AccountPublic>;
  onChange(cb: () => void): Unsubscribe;
}

export interface JobsApi {
  list(): Promise<JobPublic[]>;
  listRunning(): Promise<JobPublic[]>;
  cancel(jobId: string): Promise<void>;
  startMassDm(payload: {
    accountId: string;
    usernamesCsvPath: string;
    message: string;
    intervalMs: number;
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
}

export interface ScrapesApi {
  list(): Promise<ScrapeResultPublic[]>;
  download(jobId: string): Promise<string | null>;
  revealInFolder(jobId: string): Promise<void>;
}

export interface CsvApi {
  pickAndPersist(): Promise<{ path: string; count: number } | null>;
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
  csv: CsvApi;
}

declare global {
  interface Window {
    b2dm: B2dmApi;
  }
}

export const b2dm: B2dmApi = window.b2dm;
