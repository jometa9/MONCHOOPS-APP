import { BrowserWindow, ipcMain, dialog, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb, metaGet, metaSet } from './db';
import { getSession, logout, validateLicense, refreshSession } from './license';
import { handleAuthDeepLink } from './oauth';
import {
  listAccounts,
  getAccount,
  deleteAccount,
  updateProxy,
} from './accounts';
import {
  cancelJob,
  getStats,
  listJobs,
  listMassDmResults,
  listRunningJobs,
  listScrapeResults,
  getScrapeResult,
  reconcileOnStartup,
  shutdownAllJobs,
  startLogin,
  startAutoLogin,
  startBulkAutoLogin,
  startMassDm,
  startScrape,
  type BulkLoginRow,
  subscribe as subscribeToJobs,
  type JobEvent,
  type JobKind,
} from './jobs';
import {
  createCategory,
  deleteCategory,
  exportCategoryCsv,
  listCategories,
  listLeads,
  renameCategory,
} from './leads';
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
    broadcast('categories:changed');
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
  ipcMain.handle('accounts:startBulkAutoLogin', async (_e, rows: BulkLoginRow[]) => {
    const jobId = startBulkAutoLogin(rows);
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

  // Stats (Home)
  ipcMain.handle('stats:get', async () => getStats());

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
      messages: string[];
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

  // Mass DM history
  ipcMain.handle('massDms:list', async () => listMassDmResults());

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
    return persistUsernameFile(res.filePaths[0]!);
  });

  ipcMain.handle('csv:persistFromPath', async (_e, srcPath: string) => {
    if (!srcPath || typeof srcPath !== 'string') throw new Error('Invalid file path');
    if (!fs.existsSync(srcPath)) throw new Error('File not found');
    return persistUsernameFile(srcPath);
  });

  ipcMain.handle('csv:persistFromCategory', async (_e, categoryId: string) => {
    const content = exportCategoryCsv(categoryId);
    const tempDir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(tempDir, { recursive: true });
    const dest = path.join(tempDir, `category-${categoryId.slice(0, 8)}-${Date.now()}.csv`);
    fs.writeFileSync(dest, content, 'utf8');
    const count = content
      .split(/\r?\n/)
      .slice(1) // drop header
      .filter((l) => l.trim().length > 0).length;
    return { path: dest, count };
  });

  ipcMain.handle('csv:persistFromScrape', async (_e, jobId: string) => {
    const row = getScrapeResult(jobId);
    if (!row) throw new Error('Scrape result not found');
    return { path: row.csvPath, count: row.usernameCount };
  });

  // Settings
  ipcMain.handle('session:refresh', async () => {
    const snapshot = await refreshSession();
    broadcastSessionChange(snapshot);
    return snapshot;
  });

  ipcMain.handle('accounts:deleteAll', async () => {
    // Cancel all running jobs first
    const running = listRunningJobs();
    for (const job of running) cancelJob(job.id);
    getDb().prepare('DELETE FROM accounts').run();
    broadcast('accounts:changed');
  });

  ipcMain.handle('scrapes:deleteAll', async () => {
    const rows = listScrapeResults();
    for (const row of rows) {
      try { fs.unlinkSync(row.csvPath); } catch {}
    }
    getDb().prepare('DELETE FROM scrape_results').run();
  });

  ipcMain.handle('app:selectDirectory', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle('settings:getScrapeExportDir', () => metaGet('scrape_export_dir') ?? '');
  ipcMain.handle('settings:setScrapeExportDir', (_e, dir: string) => {
    metaSet('scrape_export_dir', dir || null);
  });

  ipcMain.handle('settings:getHeadless', () => metaGet('headless') !== 'false');
  ipcMain.handle('settings:setHeadless', (_e, headless: boolean) => {
    metaSet('headless', headless ? 'true' : 'false');
  });

  // Lead categories
  ipcMain.handle('categories:list', async () => listCategories());
  ipcMain.handle('categories:create', async (_e, name: string) => {
    const cat = createCategory(name);
    broadcast('categories:changed');
    return cat;
  });
  ipcMain.handle('categories:rename', async (_e, payload: { id: string; name: string }) => {
    const cat = renameCategory(payload.id, payload.name);
    broadcast('categories:changed');
    return cat;
  });
  ipcMain.handle('categories:delete', async (_e, id: string) => {
    deleteCategory(id);
    broadcast('categories:changed');
  });
  ipcMain.handle(
    'categories:listLeads',
    async (_e, payload: { categoryId: string; limit?: number; offset?: number }) =>
      listLeads(payload)
  );
  ipcMain.handle('categories:exportCsv', async (_e, categoryId: string) => {
    const content = exportCategoryCsv(categoryId);
    const res = await dialog.showSaveDialog({
      defaultPath: `category-${categoryId.slice(0, 8)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, content, 'utf8');
    return res.filePath;
  });

  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    if (listRunningJobs().length === 0) return;
    // Block every before-quit cycle until the flush is done — otherwise the
    // second app.quit() (from main.ts's 5s prepare-quit timer) would tear the
    // workers down before they finish writing partial results.
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    void (async () => {
      try {
        await shutdownAllJobs(15_000);
      } catch (err) {
        console.error('[backend] shutdown failed:', err);
      } finally {
        app.exit(0);
      }
    })();
  });
}

function persistUsernameFile(src: string): { path: string; count: number } {
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
      const csvDest = dest.replace(/\.(xlsx?|xls)$/i, '.csv');
      fs.writeFileSync(csvDest, `username\n${usernames.join('\n')}\n`);
      return { path: csvDest, count: usernames.length };
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
