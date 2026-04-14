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
  startLogin: () => invoke<{ jobId: string }>('accounts:startLogin'),
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
  cancel: (jobId: string) => invoke<void>('jobs:cancel', jobId),
  startMassDm: (payload: {
    accountId: string;
    usernamesCsvPath: string;
    message: string;
    intervalMs: number;
  }) => invoke<string>('jobs:startMassDm', payload),
  startScrape: (payload: {
    accountId: string;
    kind: 'scrape_by_username' | 'scrape_by_post' | 'scrape_by_hashtag' | 'scrape_by_location';
    params: Record<string, unknown>;
  }) => invoke<string>('jobs:startScrape', payload),
  onChange: (cb: () => void) => listen<void>('jobs:changed', () => cb()),
  onProgress: (
    cb: (evt: { jobId: string; done: number; total: number | null; item?: string }) => void
  ) => listen<{ jobId: string; done: number; total: number | null; item?: string }>('jobs:progress', cb),
  onDone: (cb: (evt: { jobId: string; status: string }) => void) =>
    listen<{ jobId: string; status: string }>('jobs:done', cb),
};

const scrapesApi = {
  list: () => invoke<import('./backend/jobs').ScrapeResultPublic[]>('scrapes:list'),
  download: (jobId: string) => invoke<string | null>('scrapes:download', jobId),
  revealInFolder: (jobId: string) => invoke<void>('scrapes:revealInFolder', jobId),
};

const csvApi = {
  pickAndPersist: () => invoke<{ path: string; count: number } | null>('csv:pickAndPersist'),
};

contextBridge.exposeInMainWorld('b2dm', {
  ...platformApi,
  ...sessionApi,
  accounts: accountsApi,
  jobs: jobsApi,
  scrapes: scrapesApi,
  csv: csvApi,
});

contextBridge.exposeInMainWorld('electronAPI', platformApi);
