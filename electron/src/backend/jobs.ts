import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import { getDb } from './db';
import {
  createAccount,
  getAccount,
  getAccountSecrets,
  setAccountStatus,
  updateProxy,
  type InstagramCookie,
} from './accounts';

export type JobKind =
  | 'login'
  | 'mass_dm'
  | 'scrape_by_username'
  | 'scrape_by_post'
  | 'scrape_by_hashtag'
  | 'scrape_by_location';

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobPublic {
  id: string;
  accountId: string | null;
  kind: JobKind;
  params: unknown;
  status: JobStatus;
  startedAt: number;
  endedAt: number | null;
  progressDone: number;
  progressTotal: number | null;
  error: string | null;
}

export interface ScrapeResultPublic {
  jobId: string;
  kind: JobKind;
  summary: string;
  usernameCount: number;
  csvPath: string;
  durationMs: number;
  completedAt: number;
}

interface JobRow {
  id: string;
  account_id: string | null;
  kind: JobKind;
  params_json: string;
  status: JobStatus;
  started_at: number;
  ended_at: number | null;
  progress_done: number;
  progress_total: number | null;
  error: string | null;
}

interface ScrapeResultRow {
  job_id: string;
  kind: JobKind;
  summary: string;
  username_count: number;
  csv_path: string;
  duration_ms: number;
  completed_at: number;
}

type Listener = (event: JobEvent) => void;

export type JobEvent =
  | { type: 'jobs:changed' }
  | { type: 'jobs:progress'; jobId: string; done: number; total: number | null; item?: string }
  | { type: 'jobs:done'; jobId: string; status: JobStatus };

const listeners = new Set<Listener>();
const runningChildren = new Map<string, ChildProcess>();
const runningMeta = new Map<string, { startedAt: number; accountId: string | null; kind: JobKind }>();

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(event: JobEvent): void {
  for (const cb of listeners) {
    try { cb(event); } catch {}
  }
}

function rowToPublic(row: JobRow): JobPublic {
  let params: unknown = null;
  try { params = JSON.parse(row.params_json); } catch {}
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    params,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    error: row.error,
  };
}

function scrapeRowToPublic(row: ScrapeResultRow): ScrapeResultPublic {
  return {
    jobId: row.job_id,
    kind: row.kind,
    summary: row.summary,
    usernameCount: row.username_count,
    csvPath: row.csv_path,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
  };
}

export function listJobs(): JobPublic[] {
  const rows = getDb()
    .prepare<[], JobRow>('SELECT * FROM jobs ORDER BY started_at DESC LIMIT 200')
    .all();
  return rows.map(rowToPublic);
}

export function listRunningJobs(): JobPublic[] {
  return listJobs().filter((j) => j.status === 'running');
}

export function listScrapeResults(): ScrapeResultPublic[] {
  const rows = getDb()
    .prepare<[], ScrapeResultRow>(
      'SELECT * FROM scrape_results ORDER BY completed_at DESC'
    )
    .all();
  return rows.map(scrapeRowToPublic);
}

export function getScrapeResult(jobId: string): ScrapeResultPublic | null {
  const row = getDb()
    .prepare<[string], ScrapeResultRow>('SELECT * FROM scrape_results WHERE job_id = ?')
    .get(jobId);
  return row ? scrapeRowToPublic(row) : null;
}

function scrapesDir(): string {
  const d = path.join(app.getPath('userData'), 'scrapes');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function workerScriptPath(name: string): string {
  // After tsc, this file lives at electron/dist/backend/jobs.js
  return path.join(__dirname, 'workers', `${name}.js`);
}

function workerForKind(kind: JobKind): string {
  if (kind === 'login') return workerScriptPath('login');
  if (kind === 'mass_dm') return workerScriptPath('massDm');
  return workerScriptPath('scrape');
}

function insertJob(
  kind: JobKind,
  accountId: string | null,
  params: unknown
): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO jobs(id, account_id, kind, params_json, status, started_at, progress_done)
       VALUES (?, ?, ?, ?, 'running', ?, 0)`
    )
    .run(id, accountId, kind, JSON.stringify(params ?? {}), now);
  return id;
}

function updateJobProgress(jobId: string, done: number, total: number | null): void {
  getDb()
    .prepare(`UPDATE jobs SET progress_done = ?, progress_total = ? WHERE id = ?`)
    .run(done, total, jobId);
}

function finaliseJob(jobId: string, status: JobStatus, error?: string | null): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = ?, ended_at = ?, error = ? WHERE id = ?`
    )
    .run(status, Date.now(), error ?? null, jobId);
}

export interface StartLoginArgs {
  accountId?: string;
}

export function startLogin(_args: StartLoginArgs = {}): string {
  for (const [, meta] of runningMeta) {
    if (meta.kind === 'login') {
      throw new Error('A login window is already open. Complete or close it first.');
    }
  }
  const jobId = insertJob('login', null, {});
  const scriptPath = workerScriptPath('login');
  const child = spawnWorker(scriptPath, jobId, {
    type: 'init',
    payload: { jobId },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: null, kind: 'login' });
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface StartAutoLoginArgs {
  username: string;
  password: string;
}

export function startAutoLogin(args: StartAutoLoginArgs): string {
  for (const [, meta] of runningMeta) {
    if (meta.kind === 'login') {
      throw new Error('A login window is already open. Complete or close it first.');
    }
  }
  const jobId = insertJob('login', null, { type: 'auto' });
  const scriptPath = workerScriptPath('autoLogin');
  const child = spawnWorker(scriptPath, jobId, {
    type: 'init',
    payload: { jobId, username: args.username, password: args.password },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: null, kind: 'login' });
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface BulkLoginRow {
  username: string;
  password: string;
  proxyUrl?: string;
  proxyUsername?: string;
  proxyPassword?: string;
}

export function startBulkAutoLogin(rows: BulkLoginRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Bulk login requires at least one row');
  }
  for (const [, meta] of runningMeta) {
    if (meta.kind === 'login') {
      throw new Error('A login is already running. Wait for it to finish first.');
    }
  }
  const jobId = insertJob('login', null, { type: 'bulk', count: rows.length });
  const scriptPath = workerScriptPath('bulkAutoLogin');
  const child = spawnWorker(scriptPath, jobId, {
    type: 'init',
    payload: { jobId, rows },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: null, kind: 'login' });
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface StartMassDmArgs {
  accountId: string;
  usernamesCsvPath: string;
  message: string;
  intervalMs: number;
}

export function startMassDm(args: StartMassDmArgs): string {
  ensureAccountIdle(args.accountId);
  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const jobId = insertJob('mass_dm', args.accountId, {
    intervalMs: args.intervalMs,
    message: args.message,
    usernamesCsvPath: args.usernamesCsvPath,
  });

  const child = spawnWorker(workerForKind('mass_dm'), jobId, {
    type: 'init',
    payload: {
      jobId,
      secrets,
      usernamesCsvPath: args.usernamesCsvPath,
      message: args.message,
      intervalMs: args.intervalMs,
    },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: args.accountId, kind: 'mass_dm' });
  setAccountStatus(args.accountId, 'busy');
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface StartScrapeArgs {
  accountId: string;
  kind: Exclude<JobKind, 'login' | 'mass_dm'>;
  params: Record<string, unknown>;
}

export function startScrape(args: StartScrapeArgs): string {
  ensureAccountIdle(args.accountId);
  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const jobId = insertJob(args.kind, args.accountId, args.params);
  const csvPath = path.join(scrapesDir(), `${jobId}.csv`);

  const child = spawnWorker(workerForKind(args.kind), jobId, {
    type: 'init',
    payload: {
      jobId,
      kind: args.kind,
      secrets,
      csvPath,
      params: args.params,
    },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: args.accountId, kind: args.kind });
  setAccountStatus(args.accountId, 'busy');
  emit({ type: 'jobs:changed' });
  return jobId;
}

export function cancelJob(jobId: string): void {
  const child = runningChildren.get(jobId);
  if (!child) return;
  try { child.kill('SIGKILL'); } catch {}
}

function ensureAccountIdle(accountId: string): void {
  const acc = getAccount(accountId);
  if (!acc) throw new Error('Account not found');
  if (acc.status === 'busy') throw new Error('account_busy');
}

function spawnWorker(scriptPath: string, jobId: string, initMessage: unknown): ChildProcess {
  if (!fs.existsSync(scriptPath)) {
    finaliseJob(jobId, 'failed', `Worker script not found: ${scriptPath}`);
    throw new Error(`Worker script not found: ${scriptPath}`);
  }

  console.log(`[jobs] forking worker ${jobId} → ${scriptPath}`);

  // ELECTRON_RUN_AS_NODE makes Electron's binary behave like plain Node,
  // which is what child_process.fork expects inside a packaged Electron app.
  const child = fork(scriptPath, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });

  child.on('spawn', () => console.log(`[jobs] worker ${jobId} spawned pid=${child.pid}`));
  child.on('message', (msg: any) => handleWorkerMessage(jobId, msg));
  child.on('exit', (code, signal) => {
    console.log(`[jobs] worker ${jobId} exited code=${code} signal=${signal}`);
    handleWorkerExit(jobId, code, signal);
  });
  child.on('error', (err) => {
    console.error(`[jobs] worker error for ${jobId}:`, err);
    finaliseJob(jobId, 'failed', err instanceof Error ? err.message : String(err));
  });

  // Pipe stdout/stderr to main log for debugging.
  child.stdout?.on('data', (d) => console.log(`[worker ${jobId}] ${d.toString().trimEnd()}`));
  child.stderr?.on('data', (d) => console.error(`[worker ${jobId}] ${d.toString().trimEnd()}`));

  try {
    child.send(initMessage as any);
  } catch (err) {
    console.error(`[jobs] could not send init to worker ${jobId}:`, err);
  }
  return child;
}

function handleWorkerMessage(jobId: string, msg: any): void {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'progress') {
    const done = Number(msg.done) || 0;
    const total = typeof msg.total === 'number' ? msg.total : null;
    updateJobProgress(jobId, done, total);
    emit({ type: 'jobs:progress', jobId, done, total, item: msg.item });
  } else if (msg.type === 'log') {
    console.log(`[worker ${jobId}] ${msg.level}: ${msg.msg}`);
  } else if (msg.type === 'result') {
    stashResult(jobId, msg.payload);
  } else if (msg.type === 'error') {
    finaliseJob(jobId, 'failed', typeof msg.msg === 'string' ? msg.msg : 'Unknown worker error');
  } else if (msg.type === 'bulk-account') {
    persistBulkAccount(jobId, msg.payload);
  }
}

function persistBulkAccount(jobId: string, payload: any): void {
  if (!payload || typeof payload !== 'object') return;
  try {
    const acc = createAccount({
      username: String(payload.username),
      displayName: payload.displayName ?? null,
      profilePicUrl: payload.profilePicUrl ?? null,
      cookies: (payload.cookies ?? []) as InstagramCookie[],
      userAgent: String(payload.userAgent || 'Mozilla/5.0'),
    });
    if (payload.proxy && typeof payload.proxy === 'object' && payload.proxy.url) {
      try {
        updateProxy(acc.id, {
          url: payload.proxy.url,
          username: payload.proxy.username ?? null,
          password: payload.proxy.password ?? null,
        });
      } catch (err) {
        console.error(`[jobs ${jobId}] failed to apply proxy for ${acc.username}:`, err);
      }
    }
    emit({ type: 'jobs:changed' });
  } catch (err) {
    console.error(`[jobs ${jobId}] failed to persist bulk account:`, err);
  }
}

const pendingResults = new Map<string, unknown>();

function stashResult(jobId: string, payload: unknown): void {
  pendingResults.set(jobId, payload);
}

function handleWorkerExit(jobId: string, code: number | null, signal: NodeJS.Signals | null): void {
  const meta = runningMeta.get(jobId);
  runningChildren.delete(jobId);
  runningMeta.delete(jobId);

  const result = pendingResults.get(jobId);
  pendingResults.delete(jobId);

  const jobRow = getDb()
    .prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?')
    .get(jobId);
  const currentStatus = jobRow?.status;

  let finalStatus: JobStatus;
  if (signal === 'SIGKILL' || signal === 'SIGTERM') {
    finalStatus = 'cancelled';
  } else if (code === 0) {
    finalStatus = currentStatus === 'failed' ? 'failed' : 'completed';
  } else {
    finalStatus = currentStatus === 'failed' ? 'failed' : 'failed';
  }

  if (currentStatus === 'running') {
    finaliseJob(jobId, finalStatus, finalStatus === 'failed' ? (jobRow?.error ?? 'Worker exited unexpectedly') : null);
  }

  // Persist scrape result row if present.
  if (meta && finalStatus === 'completed' && result && typeof result === 'object') {
    const r = result as any;
    if (meta.kind === 'login' && r.type !== 'bulk-summary' && r.username) {
      try {
        const acc = createAccount({
          username: r.username,
          displayName: r.displayName,
          profilePicUrl: r.profilePicUrl,
          cookies: r.cookies,
          userAgent: r.userAgent || 'Mozilla/5.0',
        });
        void acc;
      } catch (err) {
        console.error('[jobs] failed to persist login result:', err);
      }
    } else if (meta.kind !== 'mass_dm' && r.csvPath) {
      try {
        const params = (() => {
          try { return JSON.parse(jobRow?.params_json ?? '{}'); } catch { return {}; }
        })();
        const summary = buildScrapeSummary(meta.kind, params, r.count);
        getDb()
          .prepare(
            `INSERT INTO scrape_results(job_id, kind, summary, username_count, csv_path, duration_ms, completed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            meta.kind,
            summary,
            Number(r.count) || 0,
            r.csvPath,
            Date.now() - meta.startedAt,
            Date.now()
          );
      } catch (err) {
        console.error('[jobs] failed to persist scrape result:', err);
      }
    }
  }

  // Release account lock.
  if (meta?.accountId) {
    setAccountStatus(meta.accountId, finalStatus === 'failed' ? 'error' : 'idle', finalStatus === 'failed' ? (jobRow?.error ?? null) : null);
  }

  emit({ type: 'jobs:done', jobId, status: finalStatus });
  emit({ type: 'jobs:changed' });
}

function buildScrapeSummary(kind: JobKind, params: any, _count: number): string {
  const u = params?.username ? `@${params.username}` : '';
  switch (kind) {
    case 'scrape_by_username':
      if (params?.collectFollowers) return `Followers of ${u || '—'}`;
      return `Commenters of ${u || '—'}'s last ${Number(params?.postsCount) || 10} posts`;
    case 'scrape_by_post':
      return `Commenters of ${params?.postUrl ?? 'post'}`;
    case 'scrape_by_hashtag':
      return `Users engaged with #${params?.hashtag ?? ''} (top ${Number(params?.postsToCheck) || 20} posts)`;
    case 'scrape_by_location':
      return `Users engaged at location (top ${Number(params?.postsToCheck) || 20} posts)`;
    default:
      return 'Scrape result';
  }
}

// Called from main on quit / before-close to stop any running children.
export function shutdownAllJobs(): void {
  for (const [, child] of runningChildren) {
    try { child.kill('SIGKILL'); } catch {}
  }
  runningChildren.clear();
  runningMeta.clear();
}

// On app boot, mark any stranded 'running' rows as failed and flip busy
// accounts back to idle. Jobs never survive an app restart in v1.
export function reconcileOnStartup(): void {
  try {
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'failed', ended_at = ?, error = 'App restarted before job finished' WHERE status = 'running'`
      )
      .run(Date.now());
    getDb().prepare(`UPDATE accounts SET status = 'idle' WHERE status = 'busy'`).run();
  } catch (err) {
    console.error('[jobs] reconcileOnStartup failed:', err);
  }
}
