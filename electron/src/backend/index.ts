import { BrowserWindow, ipcMain, dialog, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';
import { getSession, logout, validateLicense } from './license';
import { handleAuthDeepLink } from './oauth';
import {
  listAccounts,
  getAccount,
  deleteAccount,
  updateProxy,
} from './accounts';
import {
  cancelJob,
  listJobs,
  listRunningJobs,
  listScrapeResults,
  getScrapeResult,
  reconcileOnStartup,
  shutdownAllJobs,
  startLogin,
  startAutoLogin,
  startMassDm,
  startScrape,
  subscribe as subscribeToJobs,
  type JobEvent,
  type JobKind,
} from './jobs';
import type { SessionSnapshot } from './types';

interface BackendOptions {
  onDeepLink?: (url: string) => void;
}

let registered = false;
let onDeepLinkCallback: ((url: string) => void) | undefined;

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function broadcastSessionChange(snapshot: SessionSnapshot): void {
  broadcast('session:changed', snapshot);
}

function broadcastJobEvent(event: JobEvent): void {
  if (event.type === 'jobs:changed') {
    broadcast('jobs:changed');
    broadcast('accounts:changed');
  } else if (event.type === 'jobs:progress') {
    broadcast('jobs:progress', event);
  } else if (event.type === 'jobs:done') {
    broadcast('jobs:done', event);
    broadcast('accounts:changed');
  }
}

export async function registerBackend(opts: BackendOptions = {}): Promise<void> {
  if (registered) return;
  registered = true;
  onDeepLinkCallback = opts.onDeepLink;

  try {
    getDb();
    reconcileOnStartup();
  } catch (err) {
    console.error('[backend] failed to open SQLite:', err);
  }

  subscribeToJobs(broadcastJobEvent);

  ipcMain.handle('session:get', async () => getSession());
  ipcMain.handle('license:validate', async (_e, key: string) => {
    const snapshot = await validateLicense(key);
    broadcastSessionChange(snapshot);
    return snapshot;
  });
  ipcMain.handle('session:logout', async () => {
    logout();
    broadcastSessionChange(getSession());
  });

  // Accounts
  ipcMain.handle('accounts:list', async () => listAccounts());
  ipcMain.handle('accounts:get', async (_e, id: string) => getAccount(id));
  ipcMain.handle('accounts:startLogin', async () => {
    const jobId = startLogin();
    return { jobId };
  });
  ipcMain.handle('accounts:startAutoLogin', async (_e, username: string, password: string) => {
    const jobId = startAutoLogin({ username, password });
    return { jobId };
  });
  ipcMain.handle('accounts:delete', async (_e, id: string) => {
    deleteAccount(id);
    broadcast('accounts:changed');
  });
  ipcMain.handle(
    'accounts:updateProxy',
    async (
      _e,
      payload: { id: string; url: string | null; username: string | null; password: string | null }
    ) => {
      const acc = updateProxy(payload.id, {
        url: payload.url,
        username: payload.username,
        password: payload.password,
      });
      broadcast('accounts:changed');
      return acc;
    }
  );

  // Jobs
  ipcMain.handle('jobs:list', async () => listJobs());
  ipcMain.handle('jobs:listRunning', async () => listRunningJobs());
  ipcMain.handle('jobs:cancel', async (_e, jobId: string) => {
    cancelJob(jobId);
  });
  ipcMain.handle(
    'jobs:startMassDm',
    async (_e, payload: {
      accountId: string;
      usernamesCsvPath: string;
      message: string;
      intervalMs: number;
    }) => {
      return startMassDm(payload);
    }
  );
  ipcMain.handle(
    'jobs:startScrape',
    async (_e, payload: {
      accountId: string;
      kind: Exclude<JobKind, 'login' | 'mass_dm'>;
      params: Record<string, unknown>;
    }) => {
      return startScrape(payload);
    }
  );

  // Scrape results
  ipcMain.handle('scrapes:list', async () => listScrapeResults());
  ipcMain.handle('scrapes:download', async (_e, jobId: string) => {
    const row = getScrapeResult(jobId);
    if (!row) throw new Error('Scrape result not found');
    const res = await dialog.showSaveDialog({
      defaultPath: `${row.summary.replace(/[^a-z0-9_-]+/gi, '_')}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.copyFileSync(row.csvPath, res.filePath);
    return res.filePath;
  });
  ipcMain.handle('scrapes:revealInFolder', async (_e, jobId: string) => {
    const row = getScrapeResult(jobId);
    if (!row) return;
    shell.showItemInFolder(row.csvPath);
  });

  // CSV upload (for Mass DM source). Returns the absolute temp path so the
  // renderer can pass it back when starting the job.
  ipcMain.handle('csv:pickAndPersist', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Select a usernames file',
      filters: [
        { name: 'Username lists', extensions: ['csv', 'txt', 'xlsx', 'xls'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    const src = res.filePaths[0]!;
    const tempDir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(tempDir, { recursive: true });
    const ext = path.extname(src).toLowerCase();
    const dest = path.join(tempDir, `${Date.now()}${ext || '.csv'}`);

    if (ext === '.xlsx' || ext === '.xls') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const XLSX = require('xlsx') as typeof import('xlsx');
        const wb = XLSX.readFile(src);
        const sheet = wb.Sheets[wb.SheetNames[0]!]!;
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
        const usernames = rows
          .map((r) => {
            const first = Object.values(r)[0];
            return typeof first === 'string' ? first.trim() : String(first ?? '').trim();
          })
          .filter(Boolean);
        fs.writeFileSync(
          dest.replace(/\.(xlsx?|xls)$/i, '.csv'),
          `username\n${usernames.join('\n')}\n`
        );
        return { path: dest.replace(/\.(xlsx?|xls)$/i, '.csv'), count: usernames.length };
      } catch (err) {
        throw new Error(`Could not parse spreadsheet: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    fs.copyFileSync(src, dest);
    const content = fs.readFileSync(dest, 'utf8');
    const count = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.toLowerCase() !== 'username').length;
    return { path: dest, count };
  });

  app.on('before-quit', () => {
    shutdownAllJobs();
  });
}

export async function dispatchDeepLink(url: string): Promise<void> {
  try {
    const snapshot = await handleAuthDeepLink(url);
    if (snapshot) {
      broadcastSessionChange(snapshot);
      return;
    }
  } catch (err) {
    console.error('[backend] auth deep link handling failed:', err);
  }
  if (onDeepLinkCallback) onDeepLinkCallback(url);
}
