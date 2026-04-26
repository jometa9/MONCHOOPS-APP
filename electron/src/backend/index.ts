import { BrowserWindow, ipcMain, dialog, shell, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDb, metaGet, metaSet } from './db';
import { getSession, logout, validateLicense, refreshSession } from './license';
import { handleAuthDeepLink } from './oauth';
import {
  listAccounts,
  getAccount,
  getAccountPassword,
  deleteAccount,
  updateProxy,
} from './accounts';
import {
  cancelJob,
  getStats,
  listActiveJobs,
  listJobs,
  getMassDmResult,
  listDmedUsernamesForAccount,
  listMassDmResults,
  listMassDmSends,
  listRunningJobs,
  listScrapeResults,
  listWarmupResults,
  getScrapeResult,
  readScrapeUsernames,
  reconcileOnStartup,
  shutdownAllJobs,
  startLogin,
  startAutoLogin,
  startBulkAutoLogin,
  startMassDm,
  startScrape,
  startWarmup,
  type BulkLoginRow,
  type WarmupAction,
  type MassDmInteractionsConfig,
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
import {
  createMessageVariantGroup,
  deleteMessageVariantGroup,
  listMessageVariantGroups,
  updateMessageVariantGroup,
} from './messageVariants';
import {
  createWarmupSchedule,
  deleteWarmupSchedule,
  listWarmupSchedules,
  startWarmupScheduler,
  stopWarmupScheduler,
} from './warmupSchedules';
import { wipeUserData } from './userData';
import type { SessionSnapshot } from './types';
import {
  checkForUpdatesManual,
  getUpdateStatus,
  initUpdater,
  installUpdateAndRestart,
} from './updater';
import {
  startInboxJob,
  startStoryWatcher,
  type StartStoryWatcherArgs,
} from './jobs';
import {
  enqueueBackfill,
  refreshAccount as refreshInboxAccount,
  startInboxScheduler,
  stopInboxScheduler,
} from './inboxScheduler';
import {
  startFollowupScheduler,
  stopFollowupScheduler,
} from './followupScheduler';
import {
  clearDraft as clearInboxDraft,
  getThread,
  listMessages as listInboxMessages,
  listSyncStates as listInboxSyncStates,
  listThreads as listInboxThreads,
  setActiveMonitoring as setInboxActiveMonitoring,
  setDraft as setInboxDraft,
  setThreadFlags as setInboxThreadFlags,
  upsertMessage as upsertInboxMessage,
} from './inbox';
import {
  DEFAULT_PROMPT_MD,
  getAccountSettings as getAiAccountSettings,
  getMonthCostSummary,
  handleInboundMessage,
  listAccountSettings as listAiAccountSettings,
  listLog as listAiLog,
  setAccountSettings as setAiAccountSettings,
  type AccountAiSettings,
} from './aiResponder';
import {
  getApiKey as getAiApiKey,
  getDefaultMode as getAiDefaultMode,
  getExcludeKeywords as getAiExcludeKeywords,
  getHistoryDepth as getAiHistoryDepth,
  getKillSwitch as getAiKillSwitch,
  getMaxAiStreak,
  getMinInboundLen,
  getPromptMd,
  getSettings as getAiSettings,
  listModels as listAiModels,
  setApiKey as setAiApiKey,
  setDefaultMode as setAiDefaultMode,
  setExcludeKeywords as setAiExcludeKeywords,
  setHistoryDepth as setAiHistoryDepth,
  setKillSwitch as setAiKillSwitch,
  setMaxAiStreak,
  setMinInboundLen,
  setPromptMd,
  setSettings as setAiSettings,
  testApiKey as testAiApiKey,
  type AiSettings,
} from './ai';
import type { AnthropicModelId } from './ai/anthropic';
import {
  archiveSequence,
  cancelEnrollment,
  createSequence,
  enrollPeer,
  getSequence,
  listEnrollments,
  listSequences,
  pauseEnrollment,
  resumeEnrollment,
  updateSequence,
  type CreateSequenceInput,
  type ListEnrollmentsArgs,
} from './followups';

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
  } else if (event.type === 'jobs:accountDrained') {
    broadcast('jobs:accountDrained', event);
  } else if (event.type === 'jobs:loginFinished') {
    broadcast('jobs:loginFinished', event);
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
  startWarmupScheduler();
  startInboxScheduler(broadcast);
  startFollowupScheduler();
  initUpdater(broadcast);

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
  ipcMain.handle(
    'accounts:startLogin',
    async (
      _e,
      proxy: { url: string; username?: string | null; password?: string | null } | null
    ) => {
      const jobId = startLogin({ proxy: proxy ?? null });
      return { jobId };
    }
  );
  ipcMain.handle(
    'accounts:startAutoLogin',
    async (
      _e,
      payload: {
        username: string;
        password: string;
        proxy: { url: string; username?: string | null; password?: string | null } | null;
      }
    ) => {
      const jobId = startAutoLogin({
        username: payload.username,
        password: payload.password,
        proxy: payload.proxy ?? null,
      });
      return { jobId };
    }
  );
  // Retry a failed auto-login. If `password` is provided, use it (and persist
  // it on success). Otherwise fall back to the password stored on the account
  // from the original attempt.
  ipcMain.handle(
    'accounts:retryLogin',
    async (_e, payload: { id: string; password?: string | null }) => {
      const acc = getAccount(payload.id);
      if (!acc) throw new Error('Account not found');
      const password =
        typeof payload.password === 'string' && payload.password.length > 0
          ? payload.password
          : getAccountPassword(payload.id);
      if (!password) {
        throw new Error('No stored password for this account. Please enter one to retry.');
      }
      const jobId = startAutoLogin({ username: acc.username, password });
      return { jobId };
    }
  );
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
      payload: {
        id: string;
        url: string | null;
        username: string | null;
        password: string | null;
        enabled?: boolean;
      }
    ) => {
      const acc = updateProxy(payload.id, {
        url: payload.url,
        username: payload.username,
        password: payload.password,
        enabled: payload.enabled,
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
  ipcMain.handle('jobs:listActive', async () => listActiveJobs());
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
      interactions?: MassDmInteractionsConfig | null;
      excludeUsernames?: string[] | null;
    }) => {
      return startMassDm(payload);
    }
  );
  ipcMain.handle(
    'jobs:startScrape',
    async (_e, payload: {
      accountId: string;
      kind: Exclude<JobKind, 'login' | 'mass_dm' | 'warmup'>;
      params: Record<string, unknown>;
    }) => {
      return startScrape(payload);
    }
  );
  ipcMain.handle(
    'jobs:startWarmup',
    async (_e, payload: { accountId: string; action: WarmupAction }) => {
      return startWarmup(payload);
    }
  );

  // Mass DM history
  ipcMain.handle('massDms:list', async () => listMassDmResults());
  ipcMain.handle('massDms:get', async (_e, jobId: string) => getMassDmResult(jobId));
  ipcMain.handle('massDms:listSends', async (_e, jobId: string) => listMassDmSends(jobId));
  ipcMain.handle('massDms:listDmedUsernames', async (_e, accountId: string) =>
    listDmedUsernamesForAccount(accountId)
  );

  // Warmup history
  ipcMain.handle('warmups:list', async () => listWarmupResults());

  // Warmup schedules
  ipcMain.handle('warmupSchedules:list', async (_e, accountId?: string) =>
    listWarmupSchedules(accountId)
  );
  ipcMain.handle(
    'warmupSchedules:create',
    async (_e, payload: {
      accountId: string;
      startDate: number;
      endDate: number;
      timeOfDaySec: number;
      actions: WarmupAction[];
    }) => {
      const row = createWarmupSchedule(payload);
      broadcast('warmupSchedules:changed');
      return row;
    }
  );
  ipcMain.handle('warmupSchedules:delete', async (_e, id: string) => {
    deleteWarmupSchedule(id);
    broadcast('warmupSchedules:changed');
  });

  // Scrape results
  ipcMain.handle('scrapes:list', async () => listScrapeResults());
  ipcMain.handle('scrapes:download', async (_e, jobId: string) => {
    const row = getScrapeResult(jobId);
    if (!row) throw new Error('Scrape result not found');
    if (!row.csvPath) throw new Error('No CSV available for this scrape');
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
    if (!row || !row.csvPath) return;
    shell.showItemInFolder(row.csvPath);
  });
  ipcMain.handle('scrapes:listUsernames', async (_e, jobId: string) =>
    readScrapeUsernames(jobId)
  );
  ipcMain.handle('scrapes:get', async (_e, jobId: string) => getScrapeResult(jobId));

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

  // Read the usernames out of an already-persisted CSV. Used by the Cold DM
  // Review step to diff the list against accounts' past DM history and warn
  // about targets that have already been messaged.
  ipcMain.handle('csv:listUsernames', async (_e, csvPath: string) => {
    if (!csvPath || typeof csvPath !== 'string') throw new Error('Invalid path');
    if (!fs.existsSync(csvPath)) return [];
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0]?.toLowerCase();
    const withoutHeader =
      first && (first === 'username' || first.startsWith('username,'))
        ? lines.slice(1)
        : lines;
    const seen = new Set<string>();
    for (const line of withoutHeader) {
      const u = (line.split(',')[0] ?? '').trim().replace(/^@+/, '');
      if (u) seen.add(u);
    }
    return Array.from(seen);
  });

  ipcMain.handle('csv:persistFromUsernames', async (_e, usernames: string[]) => {
    if (!Array.isArray(usernames)) throw new Error('Invalid usernames payload');
    const seen = new Set<string>();
    for (const raw of usernames) {
      if (typeof raw !== 'string') continue;
      const cleaned = raw.trim().replace(/^[@#]+/, '').trim();
      if (!cleaned) continue;
      seen.add(cleaned);
    }
    const list = Array.from(seen);
    if (list.length === 0) throw new Error('Add at least one username');
    const tempDir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(tempDir, { recursive: true });
    const dest = path.join(tempDir, `manual-${Date.now()}.csv`);
    fs.writeFileSync(dest, `username\n${list.join('\n')}\n`);
    return { path: dest, count: list.length };
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

  ipcMain.handle('csv:persistFromScrapes', async (_e, jobIds: string[]) => {
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      throw new Error('No scrapes selected');
    }
    const seen = new Set<string>();
    for (const jobId of jobIds) {
      const row = getScrapeResult(jobId);
      if (!row || !row.csvPath) continue;
      let content: string;
      try {
        content = fs.readFileSync(row.csvPath, 'utf8');
      } catch {
        continue;
      }
      for (const line of content.split(/\r?\n/)) {
        const first = (line.split(',')[0] ?? '').trim().replace(/^[@#]+/, '');
        if (!first || first.toLowerCase() === 'username') continue;
        seen.add(first);
      }
    }
    const usernames = Array.from(seen);
    const tempDir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(tempDir, { recursive: true });
    const dest = path.join(tempDir, `scrapes-${Date.now()}.csv`);
    fs.writeFileSync(dest, `username\n${usernames.join('\n')}${usernames.length ? '\n' : ''}`);
    return { path: dest, count: usernames.length };
  });

  ipcMain.handle('csv:persistFromCategories', async (_e, categoryIds: string[]) => {
    if (!Array.isArray(categoryIds) || categoryIds.length === 0) {
      throw new Error('No categories selected');
    }
    const seen = new Set<string>();
    for (const id of categoryIds) {
      const content = exportCategoryCsv(id);
      const lines = content.split(/\r?\n/).slice(1);
      for (const line of lines) {
        const first = (line.split(',')[0] ?? '').trim().replace(/^[@#]+/, '');
        if (!first) continue;
        seen.add(first);
      }
    }
    const usernames = Array.from(seen);
    const tempDir = path.join(app.getPath('userData'), 'uploads');
    fs.mkdirSync(tempDir, { recursive: true });
    const dest = path.join(tempDir, `categories-${Date.now()}.csv`);
    fs.writeFileSync(dest, `username\n${usernames.join('\n')}${usernames.length ? '\n' : ''}`);
    return { path: dest, count: usernames.length };
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
      if (!row.csvPath) continue;
      try { fs.unlinkSync(row.csvPath); } catch {}
    }
    getDb().prepare('DELETE FROM scrape_results').run();
  });

  // Wipe every trace of user data except the authenticated session (license
  // key + cached profile/subscription stay so the user doesn't get kicked
  // out). Shares the same helper with the automatic wipe-on-user-switch in
  // license.validateLicense so the two code paths stay in lockstep.
  ipcMain.handle('settings:wipeAllData', async () => {
    wipeUserData();
    broadcast('accounts:changed');
    broadcast('jobs:changed');
    broadcast('categories:changed');
    broadcast('warmupSchedules:changed');
  });

  ipcMain.handle('app:selectDirectory', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0] ?? null;
  });

  ipcMain.handle('app:getVersion', () => app.getVersion());

  // Auto-updater
  ipcMain.handle('updater:getState', () => getUpdateStatus());
  ipcMain.handle('updater:check', () => {
    checkForUpdatesManual();
  });
  ipcMain.handle('updater:install', () => {
    installUpdateAndRestart();
  });

  ipcMain.handle('settings:getScrapeExportDir', () => metaGet('scrape_export_dir') ?? '');
  ipcMain.handle('settings:setScrapeExportDir', (_e, dir: string) => {
    metaSet('scrape_export_dir', dir || null);
  });

  ipcMain.handle('settings:getHeadless', () => metaGet('headless') !== 'false');
  ipcMain.handle('settings:setHeadless', (_e, headless: boolean) => {
    metaSet('headless', headless ? 'true' : 'false');
  });

  // Default false → tile windows into a grid. When true, every headed
  // Chromium opens maximized (no tiling).
  ipcMain.handle('settings:getFullWindow', () => metaGet('full_window') === 'true');
  ipcMain.handle('settings:setFullWindow', (_e, full: boolean) => {
    metaSet('full_window', full ? 'true' : 'false');
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

  // Message variant groups
  ipcMain.handle('messageVariants:list', async () => listMessageVariantGroups());
  ipcMain.handle(
    'messageVariants:create',
    async (_e, payload: { name: string; variants: string[] }) => {
      const group = createMessageVariantGroup(payload.name, payload.variants);
      broadcast('messageVariants:changed');
      return group;
    }
  );
  ipcMain.handle(
    'messageVariants:update',
    async (_e, payload: { id: string; name: string; variants: string[] }) => {
      const group = updateMessageVariantGroup(payload.id, payload.name, payload.variants);
      broadcast('messageVariants:changed');
      return group;
    }
  );
  ipcMain.handle('messageVariants:delete', async (_e, id: string) => {
    deleteMessageVariantGroup(id);
    broadcast('messageVariants:changed');
  });

  // Inbox
  ipcMain.handle(
    'inbox:listThreads',
    async (
      _e,
      args: {
        accountIds?: string[];
        from?: number | null;
        to?: number | null;
        unreadOnly?: boolean;
        query?: string | null;
        limit?: number;
        offset?: number;
      } = {}
    ) => listInboxThreads(args)
  );
  ipcMain.handle(
    'inbox:getThread',
    async (_e, args: { threadId: string; limit?: number; before?: number | null }) => {
      const thread = getThread(args.threadId);
      if (!thread) return null;
      const messages = listInboxMessages({
        threadId: args.threadId,
        limit: args.limit,
        before: args.before ?? null,
      });
      return { thread, messages };
    }
  );
  ipcMain.handle('inbox:listSyncStates', async () => listInboxSyncStates());
  ipcMain.handle('inbox:refreshAccount', async (_e, accountId: string) =>
    refreshInboxAccount(accountId)
  );
  ipcMain.handle('inbox:backfillAccount', async (_e, accountId: string) =>
    enqueueBackfill(accountId)
  );
  ipcMain.handle(
    'inbox:fetchThread',
    async (_e, args: { threadId: string; maxMessages?: number }) => {
      const t = getThread(args.threadId);
      if (!t) throw new Error('Thread not found');
      return startInboxJob({
        accountId: t.accountId,
        mode: 'thread_fetch',
        igThreadId: t.igThreadId,
        maxMessagesPerThread: args.maxMessages ?? 200,
      });
    }
  );
  ipcMain.handle(
    'inbox:setActiveMonitoring',
    async (_e, args: { accountId: string; enabled: boolean }) => {
      setInboxActiveMonitoring(args.accountId, args.enabled);
      broadcast('inbox:changed', { accountId: args.accountId });
    }
  );
  ipcMain.handle(
    'inbox:setThreadFlags',
    async (
      _e,
      args: {
        threadId: string;
        flags: { aiResponderEnabled?: boolean; followupDisabled?: boolean; isPinned?: boolean };
      }
    ) => {
      setInboxThreadFlags(args.threadId, args.flags);
      broadcast('inbox:changed', { threadIds: [args.threadId] });
    }
  );
  ipcMain.handle(
    'inbox:sendMessage',
    async (_e, args: { threadId: string; text: string }) => {
      const t = getThread(args.threadId);
      if (!t) throw new Error('Thread not found');
      const text = (args.text ?? '').trim();
      if (!text) throw new Error('Empty message');
      // Persist outbound row optimistically so the conversation pane updates
      // before the worker confirms. Worker delivers the actual send.
      upsertInboxMessage(
        args.threadId,
        {
          igMessageId: null,
          direction: 'out',
          senderUsername: t.accountUsername ?? 'me',
          body: text,
          mediaKind: null,
          mediaCaption: null,
          sentAt: Date.now(),
        },
        'self_send'
      );
      clearInboxDraft(args.threadId);
      const jobId = startInboxJob({
        accountId: t.accountId,
        mode: 'send_message',
        igThreadId: t.igThreadId,
        text,
      });
      broadcast('inbox:changed', { threadIds: [args.threadId] });
      return jobId;
    }
  );
  ipcMain.handle(
    'inbox:saveDraft',
    async (_e, args: { threadId: string; body: string }) => {
      setInboxDraft(args.threadId, args.body, null);
      broadcast('inbox:changed', { threadIds: [args.threadId] });
    }
  );
  ipcMain.handle('inbox:clearDraft', async (_e, threadId: string) => {
    clearInboxDraft(threadId);
    broadcast('inbox:changed', { threadIds: [threadId] });
  });
  ipcMain.handle(
    'inbox:suggestReply',
    async (_e, args: { threadId: string }) => {
      const t = getThread(args.threadId);
      if (!t) throw new Error('Thread not found');
      const lastInbound = listInboxMessages({ threadId: args.threadId, limit: 50 })
        .filter((m) => m.direction === 'in')
        .pop();
      if (!lastInbound) throw new Error('No inbound message in this thread to respond to');
      const outcome = await handleInboundMessage(
        {
          threadId: args.threadId,
          accountId: t.accountId,
          accountUsername: t.accountUsername,
          messageId: lastInbound.id,
          body: lastInbound.body,
        },
        { forceSuggest: true }
      );
      if (outcome) broadcast('inbox:changed', { threadIds: [args.threadId] });
      return outcome;
    }
  );

  // AI Responder
  ipcMain.handle('ai:listModels', async () => listAiModels());
  ipcMain.handle('ai:getSettings', async () => getAiSettings());
  ipcMain.handle(
    'ai:setSettings',
    async (
      _e,
      input: { provider?: 'anthropic'; model?: AnthropicModelId; defaultMaxTokens?: number }
    ): Promise<AiSettings> => setAiSettings(input)
  );
  ipcMain.handle('ai:setApiKey', async (_e, key: string | null) => {
    setAiApiKey(key);
    return getAiSettings();
  });
  ipcMain.handle('ai:hasApiKey', async () => !!getAiApiKey());
  ipcMain.handle(
    'ai:testApiKey',
    async (_e, args: { apiKey: string; model?: AnthropicModelId }) =>
      testAiApiKey(args.apiKey, args.model)
  );
  ipcMain.handle('ai:getPrompt', async () => ({
    md: getPromptMd(DEFAULT_PROMPT_MD),
    defaultMd: DEFAULT_PROMPT_MD,
  }));
  ipcMain.handle('ai:setPrompt', async (_e, md: string) => {
    setPromptMd(md);
  });
  ipcMain.handle('ai:getDefaults', async () => ({
    historyDepth: getAiHistoryDepth(),
    mode: getAiDefaultMode(),
    killSwitch: getAiKillSwitch(),
    excludeKeywords: getAiExcludeKeywords(),
    minInboundLen: getMinInboundLen(),
    maxAiStreak: getMaxAiStreak(),
  }));
  ipcMain.handle(
    'ai:setDefaults',
    async (
      _e,
      input: {
        historyDepth?: number;
        mode?: 'suggest' | 'auto';
        killSwitch?: boolean;
        excludeKeywords?: string[];
        minInboundLen?: number;
        maxAiStreak?: number;
      }
    ) => {
      if (typeof input.historyDepth === 'number') setAiHistoryDepth(input.historyDepth);
      if (input.mode) setAiDefaultMode(input.mode);
      if (typeof input.killSwitch === 'boolean') setAiKillSwitch(input.killSwitch);
      if (Array.isArray(input.excludeKeywords)) setAiExcludeKeywords(input.excludeKeywords);
      if (typeof input.minInboundLen === 'number') setMinInboundLen(input.minInboundLen);
      if (typeof input.maxAiStreak === 'number') setMaxAiStreak(input.maxAiStreak);
    }
  );
  ipcMain.handle('ai:listAccountSettings', async () => listAiAccountSettings());
  ipcMain.handle('ai:getAccountSettings', async (_e, accountId: string) =>
    getAiAccountSettings(accountId)
  );
  ipcMain.handle(
    'ai:setAccountSettings',
    async (_e, input: AccountAiSettings) => setAiAccountSettings(input)
  );
  ipcMain.handle('ai:listLog', async (_e, limit?: number) => listAiLog(limit));
  ipcMain.handle('ai:getMonthCost', async () => getMonthCostSummary());

  // Follow-up sequences
  ipcMain.handle('followups:listSequences', async (_e, includeArchived?: boolean) =>
    listSequences(!!includeArchived)
  );
  ipcMain.handle('followups:getSequence', async (_e, id: string) => getSequence(id));
  ipcMain.handle(
    'followups:createSequence',
    async (_e, input: CreateSequenceInput) => createSequence(input)
  );
  ipcMain.handle(
    'followups:updateSequence',
    async (_e, args: { id: string; input: CreateSequenceInput }) =>
      updateSequence(args.id, args.input)
  );
  ipcMain.handle('followups:archiveSequence', async (_e, id: string) => archiveSequence(id));

  ipcMain.handle('followups:listEnrollments', async (_e, args: ListEnrollmentsArgs = {}) =>
    listEnrollments(args)
  );
  ipcMain.handle(
    'followups:enrollPeer',
    async (
      _e,
      args: {
        sequenceId: string;
        accountId: string;
        peerUsername: string;
        threadId?: string | null;
      }
    ) => enrollPeer(args)
  );
  ipcMain.handle('followups:pause', async (_e, id: string) => pauseEnrollment(id));
  ipcMain.handle('followups:resume', async (_e, id: string) => resumeEnrollment(id));
  ipcMain.handle('followups:cancel', async (_e, id: string) => cancelEnrollment(id));

  // Story watcher
  ipcMain.handle('jobs:startStoryWatcher', async (_e, args: StartStoryWatcherArgs) =>
    startStoryWatcher(args)
  );

  let shutdownStarted = false;
  app.on('before-quit', (event) => {
    stopWarmupScheduler();
    stopInboxScheduler();
    stopFollowupScheduler();
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
          const raw = typeof first === 'string' ? first.trim() : String(first ?? '').trim();
          return raw.replace(/^[@#]+/, '').trim();
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
