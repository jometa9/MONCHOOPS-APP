import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

type Unsubscribe = () => void;

const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const listen = <T>(channel: string, cb: (payload: T) => void): Unsubscribe => {
  const handler = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const platformApi = {
  getPlatform: () => invoke<NodeJS.Platform>('get-platform'),
  getIsFullScreen: () => invoke<boolean>('get-is-full-screen'),
  onFullScreenChange: (cb: (isFullScreen: boolean) => void) =>
    listen<boolean>('fullscreen-changed', (v) => cb(!!v)),
  setWindowButtonPosition: (x: number | null, y: number | null) =>
    invoke<void>('set-window-button-position', { x, y }),
  openExternalLink: (url: string) => invoke<void>('open-external-link', url),
  onSystemSuspend: (cb: () => void) => listen<void>('system-suspend', () => cb()),
  onSystemResume: (cb: () => void) => listen<void>('system-resume', () => cb()),
  onPrepareQuit: (cb: () => void) => listen<void>('prepare-quit', () => cb()),
  quitReady: () => ipcRenderer.send('quit-ready'),
  onNavigateToSettings: (cb: () => void) => listen<void>('navigate-to-settings', () => cb()),
  onDeepLink: (cb: (data: { url: string }) => void) => listen<{ url: string }>('deep-link', (d) => cb(d)),
  getPendingDeepLink: () => invoke<string | null>('get-pending-deep-link'),
  clearPendingDeepLink: (url: string) => invoke<void>('clear-pending-deep-link', url),
};

const sessionApi = {
  getSession: () => invoke<import('./backend/types').SessionSnapshot>('session:get'),
  validateLicense: (licenseKey: string) =>
    invoke<import('./backend/types').SessionSnapshot>('license:validate', licenseKey),
  logout: () => invoke<void>('session:logout'),
  onSessionChange: (cb: (snapshot: import('./backend/types').SessionSnapshot) => void) =>
    listen<import('./backend/types').SessionSnapshot>('session:changed', cb),
};

const accountsApi = {
  list: () => invoke<import('./backend/accounts').AccountPublic[]>('accounts:list'),
  get: (id: string) => invoke<import('./backend/accounts').AccountPublic | null>('accounts:get', id),
  startLogin: (proxy?: { url: string; username?: string | null; password?: string | null }) =>
    invoke<{ jobId: string }>('accounts:startLogin', proxy ?? null),
  startAutoLogin: (
    username: string,
    password: string,
    proxy?: { url: string; username?: string | null; password?: string | null }
  ) => invoke<{ jobId: string }>('accounts:startAutoLogin', { username, password, proxy: proxy ?? null }),
  retryLogin: (id: string, password?: string | null) =>
    invoke<{ jobId: string }>('accounts:retryLogin', { id, password: password ?? null }),
  startBulkAutoLogin: (rows: import('./backend/jobs').BulkLoginRow[]) =>
    invoke<{ jobId: string }>('accounts:startBulkAutoLogin', rows),
  delete: (id: string) => invoke<void>('accounts:delete', id),
  updateProxy: (payload: {
    id: string;
    url: string | null;
    username: string | null;
    password: string | null;
  }) => invoke<import('./backend/accounts').AccountPublic>('accounts:updateProxy', payload),
  onChange: (cb: () => void) => listen<void>('accounts:changed', () => cb()),
};

const jobsApi = {
  list: () => invoke<import('./backend/jobs').JobPublic[]>('jobs:list'),
  listRunning: () => invoke<import('./backend/jobs').JobPublic[]>('jobs:listRunning'),
  listActive: () => invoke<import('./backend/jobs').JobPublic[]>('jobs:listActive'),
  cancel: (jobId: string) => invoke<void>('jobs:cancel', jobId),
  startMassDm: (payload: {
    accountId: string;
    usernamesCsvPath: string;
    messages: string[];
    intervalMs: number;
    interactions?: import('./backend/jobs').MassDmInteractionsConfig | null;
  }) => invoke<string>('jobs:startMassDm', payload),
  startScrape: (payload: {
    accountId: string;
    kind: 'scrape_by_username' | 'scrape_by_post' | 'scrape_by_hashtag' | 'scrape_by_location';
    params: Record<string, unknown>;
  }) => invoke<string>('jobs:startScrape', payload),
  startWarmup: (payload: {
    accountId: string;
    action: import('./backend/jobs').WarmupAction;
  }) => invoke<string>('jobs:startWarmup', payload),
  onChange: (cb: () => void) => listen<void>('jobs:changed', () => cb()),
  onProgress: (
    cb: (evt: { jobId: string; done: number; total: number | null; item?: string }) => void
  ) => listen<{ jobId: string; done: number; total: number | null; item?: string }>('jobs:progress', cb),
  onDone: (cb: (evt: { jobId: string; status: string }) => void) =>
    listen<{ jobId: string; status: string }>('jobs:done', cb),
  onAccountDrained: (cb: (evt: { accountId: string; status: string }) => void) =>
    listen<{ accountId: string; status: string }>('jobs:accountDrained', cb),
};

const statsApi = {
  get: () =>
    invoke<{
      totalJobs: number;
      totalLeads: number;
      totalMessages: number;
      timeSavedMs: number;
    }>('stats:get'),
};

const scrapesApi = {
  list: () => invoke<import('./backend/jobs').ScrapeResultPublic[]>('scrapes:list'),
  get: (jobId: string) =>
    invoke<import('./backend/jobs').ScrapeResultPublic | null>('scrapes:get', jobId),
  listUsernames: (jobId: string) =>
    invoke<import('./backend/jobs').ScrapeUsernameRow[]>('scrapes:listUsernames', jobId),
  download: (jobId: string) => invoke<string | null>('scrapes:download', jobId),
  revealInFolder: (jobId: string) => invoke<void>('scrapes:revealInFolder', jobId),
};

const massDmsApi = {
  list: () => invoke<import('./backend/jobs').MassDmResultPublic[]>('massDms:list'),
};

const warmupsApi = {
  list: () => invoke<import('./backend/jobs').WarmupResultPublic[]>('warmups:list'),
  listSchedules: (accountId?: string) =>
    invoke<import('./backend/warmupSchedules').WarmupSchedulePublic[]>(
      'warmupSchedules:list',
      accountId ?? undefined
    ),
  createSchedule: (payload: {
    accountId: string;
    startDate: number;
    endDate: number;
    timeOfDaySec: number;
    actions: import('./backend/jobs').WarmupAction[];
  }) =>
    invoke<import('./backend/warmupSchedules').WarmupSchedulePublic>(
      'warmupSchedules:create',
      payload
    ),
  deleteSchedule: (id: string) => invoke<void>('warmupSchedules:delete', id),
  onSchedulesChange: (cb: () => void) => listen<void>('warmupSchedules:changed', () => cb()),
};

const csvApi = {
  pickAndPersist: () => invoke<{ path: string; count: number } | null>('csv:pickAndPersist'),
  persistFromPath: (srcPath: string) =>
    invoke<{ path: string; count: number }>('csv:persistFromPath', srcPath),
  persistFromCategory: (categoryId: string) =>
    invoke<{ path: string; count: number }>('csv:persistFromCategory', categoryId),
  persistFromCategories: (categoryIds: string[]) =>
    invoke<{ path: string; count: number }>('csv:persistFromCategories', categoryIds),
  persistFromScrape: (jobId: string) =>
    invoke<{ path: string; count: number }>('csv:persistFromScrape', jobId),
  persistFromScrapes: (jobIds: string[]) =>
    invoke<{ path: string; count: number }>('csv:persistFromScrapes', jobIds),
};

const categoriesApi = {
  list: () => invoke<import('./backend/leads').LeadCategoryPublic[]>('categories:list'),
  create: (name: string) =>
    invoke<import('./backend/leads').LeadCategoryPublic>('categories:create', name),
  rename: (id: string, name: string) =>
    invoke<import('./backend/leads').LeadCategoryPublic>('categories:rename', { id, name }),
  delete: (id: string) => invoke<void>('categories:delete', id),
  listLeads: (payload: { categoryId: string; limit?: number; offset?: number }) =>
    invoke<import('./backend/leads').LeadPublic[]>('categories:listLeads', payload),
  exportCsv: (categoryId: string) => invoke<string | null>('categories:exportCsv', categoryId),
  onChange: (cb: () => void) => listen<void>('categories:changed', () => cb()),
};

const updaterApi = {
  getState: () => invoke<import('./backend/updater').UpdateStatus>('updater:getState'),
  checkForUpdates: () => invoke<void>('updater:check'),
  installAndRestart: () => invoke<void>('updater:install'),
  onStateChange: (cb: (state: import('./backend/updater').UpdateStatus) => void) =>
    listen<import('./backend/updater').UpdateStatus>('updater:state', cb),
};

const settingsApi = {
  refreshSession: () => invoke<import('./backend/types').SessionSnapshot>('session:refresh'),
  deleteAllAccounts: () => invoke<void>('accounts:deleteAll'),
  deleteAllScrapes: () => invoke<void>('scrapes:deleteAll'),
  selectDirectory: () => invoke<string | null>('app:selectDirectory'),
  getAppVersion: () => invoke<string>('app:getVersion'),
  getScrapeExportDir: () => invoke<string>('settings:getScrapeExportDir'),
  setScrapeExportDir: (dir: string) => invoke<void>('settings:setScrapeExportDir', dir),
  getHeadless: () => invoke<boolean>('settings:getHeadless'),
  setHeadless: (headless: boolean) => invoke<void>('settings:setHeadless', headless),
  getFullWindow: () => invoke<boolean>('settings:getFullWindow'),
  setFullWindow: (full: boolean) => invoke<void>('settings:setFullWindow', full),
};

contextBridge.exposeInMainWorld('b2dm', {
  ...platformApi,
  ...sessionApi,
  accounts: accountsApi,
  jobs: jobsApi,
  scrapes: scrapesApi,
  massDms: massDmsApi,
  warmups: warmupsApi,
  categories: categoriesApi,
  csv: csvApi,
  settings: settingsApi,
  stats: statsApi,
  updater: updaterApi,
});

contextBridge.exposeInMainWorld('electronAPI', platformApi);
