import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { ChildProcess, fork } from 'child_process';
import { app } from 'electron';
import { getDb, metaGet } from './db';
import {
  createAccount,
  getAccount,
  getAccountSecrets,
  setAccountStatus,
  updateProxy,
  type InstagramCookie,
} from './accounts';
import { ingestLeadsFromCsv, resolveCategoryRef } from './leads';

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
  categoryId: string | null;
  categoryName: string | null;
}

export interface MassDmResultPublic {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  sentCount: number;
  failedCount: number;
  totalCount: number;
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
  category_id: string | null;
  category_name: string | null;
}

type Listener = (event: JobEvent) => void;

export type JobEvent =
  | { type: 'jobs:changed' }
  | { type: 'jobs:progress'; jobId: string; done: number; total: number | null; item?: string }
  | { type: 'jobs:done'; jobId: string; status: JobStatus };

const listeners = new Set<Listener>();
const runningChildren = new Map<string, ChildProcess>();
const runningMeta = new Map<string, { startedAt: number; accountId: string | null; kind: JobKind }>();
// Jobs the user asked to cancel. Used so handleWorkerExit knows to flag the
// job as 'cancelled' regardless of exit code, and so partial-result
// persistence in handleWorkerExit can apply the same path used for success.
const cancellingJobs = new Set<string>();

const CANCEL_GRACE_MS = 15_000;
const TERM_GRACE_MS = 5_000;

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
    categoryId: row.category_id,
    categoryName: row.category_name,
  };
}

const SCRAPE_RESULT_SELECT = `
  SELECT
    sr.*,
    lc.id   AS category_id,
    lc.name AS category_name
  FROM scrape_results sr
  LEFT JOIN jobs j ON j.id = sr.job_id
  LEFT JOIN lead_categories lc
    ON lc.id = json_extract(j.params_json, '$.categoryId')
`;

export function listJobs(): JobPublic[] {
  const rows = getDb()
    .prepare<[], JobRow>('SELECT * FROM jobs ORDER BY started_at DESC LIMIT 200')
    .all();
  return rows.map(rowToPublic);
}

export function listRunningJobs(): JobPublic[] {
  return listJobs().filter((j) => j.status === 'running');
}

export interface StatsPublic {
  totalJobs: number;
  totalLeads: number;
  totalMessages: number;
  timeSavedMs: number;
}

export function getStats(): StatsPublic {
  const db = getDb();
  const jobsRow = db
    .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM jobs')
    .get();
  const leadsRow = db
    .prepare<[], { c: number | null }>(
      'SELECT COALESCE(SUM(username_count), 0) AS c FROM scrape_results'
    )
    .get();
  const messagesRow = db
    .prepare<[], { c: number | null }>(
      'SELECT COALESCE(SUM(sent_count), 0) AS c FROM mass_dm_results'
    )
    .get();
  const scrapeTimeRow = db
    .prepare<[], { c: number | null }>(
      'SELECT COALESCE(SUM(duration_ms), 0) AS c FROM scrape_results'
    )
    .get();
  const dmTimeRow = db
    .prepare<[], { c: number | null }>(
      'SELECT COALESCE(SUM(duration_ms), 0) AS c FROM mass_dm_results'
    )
    .get();
  return {
    totalJobs: Number(jobsRow?.c) || 0,
    totalLeads: Number(leadsRow?.c) || 0,
    totalMessages: Number(messagesRow?.c) || 0,
    timeSavedMs:
      (Number(scrapeTimeRow?.c) || 0) + (Number(dmTimeRow?.c) || 0),
  };
}

export function listScrapeResults(): ScrapeResultPublic[] {
  const rows = getDb()
    .prepare<[], ScrapeResultRow>(
      `${SCRAPE_RESULT_SELECT} ORDER BY sr.completed_at DESC`
    )
    .all();
  return rows.map(scrapeRowToPublic);
}

export function getScrapeResult(jobId: string): ScrapeResultPublic | null {
  const row = getDb()
    .prepare<[string], ScrapeResultRow>(
      `${SCRAPE_RESULT_SELECT} WHERE sr.job_id = ?`
    )
    .get(jobId);
  return row ? scrapeRowToPublic(row) : null;
}

export interface ScrapeUsernameRow {
  username: string;
  source: string | null;
  sourceRef: string | null;
}

export function readScrapeUsernames(jobId: string): ScrapeUsernameRow[] {
  const result = getScrapeResult(jobId);
  if (!result) return [];
  if (!fs.existsSync(result.csvPath)) return [];
  const raw = fs.readFileSync(result.csvPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const out: ScrapeUsernameRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const parts = parseCsvLine(line);
    const username = parts[0]?.trim();
    if (!username) continue;
    out.push({
      username,
      source: parts[1]?.trim() || null,
      sourceRef: parts[2]?.trim() || null,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      if (ch === '"') { inQuotes = false; continue; }
      cur += ch;
    } else {
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === ',') { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

interface MassDmResultRow {
  job_id: string;
  account_id: string | null;
  account_username: string | null;
  sent_count: number;
  failed_count: number;
  total_count: number;
  duration_ms: number;
  completed_at: number;
}

const MASS_DM_RESULT_SELECT = `
  SELECT
    mdr.*,
    a.username AS account_username
  FROM mass_dm_results mdr
  LEFT JOIN accounts a ON a.id = mdr.account_id
`;

function massDmRowToPublic(row: MassDmResultRow): MassDmResultPublic {
  return {
    jobId: row.job_id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    totalCount: row.total_count,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
  };
}

export function listMassDmResults(): MassDmResultPublic[] {
  const rows = getDb()
    .prepare<[], MassDmResultRow>(
      `${MASS_DM_RESULT_SELECT} ORDER BY mdr.completed_at DESC`
    )
    .all();
  return rows.map(massDmRowToPublic);
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

// Headless preference is persisted in the meta table so workers can read it
// at job-start time. Defaults to true (browsers stay hidden) to match the
// renderer's PreferencesContext default.
function getHeadlessPref(): boolean {
  const raw = metaGet('headless');
  if (raw == null) return true;
  return raw !== 'false';
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
    payload: {
      jobId,
      username: args.username,
      password: args.password,
      headless: getHeadlessPref(),
    },
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
    payload: { jobId, rows, headless: getHeadlessPref() },
  });
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: null, kind: 'login' });
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface StartMassDmArgs {
  accountId: string;
  usernamesCsvPath: string;
  messages: string[];
  intervalMs: number;
}

const MAX_DM_VARIANTS = 20;

export function startMassDm(args: StartMassDmArgs): string {
  ensureAccountIdle(args.accountId);
  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const messages = (args.messages ?? [])
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .slice(0, MAX_DM_VARIANTS);
  if (messages.length === 0) throw new Error('At least one message variant is required');

  const jobId = insertJob('mass_dm', args.accountId, {
    intervalMs: args.intervalMs,
    messages,
    usernamesCsvPath: args.usernamesCsvPath,
  });

  const child = spawnWorker(workerForKind('mass_dm'), jobId, {
    type: 'init',
    payload: {
      jobId,
      secrets,
      usernamesCsvPath: args.usernamesCsvPath,
      messages,
      intervalMs: args.intervalMs,
      headless: getHeadlessPref(),
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

  // Resolve category ref (existing id or new name) into a stable categoryId
  // that we persist on the job params. null means "no category bucket".
  const category = resolveCategoryRef({
    categoryId: typeof args.params.categoryId === 'string' ? args.params.categoryId : null,
    newCategoryName:
      typeof args.params.newCategoryName === 'string' ? args.params.newCategoryName : null,
  });
  const paramsWithCategory = {
    ...args.params,
    categoryId: category?.id ?? null,
    newCategoryName: undefined,
  };

  const jobId = insertJob(args.kind, args.accountId, paramsWithCategory);
  const csvPath = path.join(scrapesDir(), `${jobId}.csv`);

  const child = spawnWorker(workerForKind(args.kind), jobId, {
    type: 'init',
    payload: {
      jobId,
      kind: args.kind,
      secrets,
      csvPath,
      params: paramsWithCategory,
      headless: getHeadlessPref(),
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
  if (cancellingJobs.has(jobId)) return;
  cancellingJobs.add(jobId);

  // Cooperative cancel: worker flushes partial state (CSV, result payload)
  // then exits 0. Escalate to SIGTERM → SIGKILL if it doesn't respond in time.
  try { child.send({ type: 'cancel' } as any); } catch {}

  setTimeout(() => {
    if (!runningChildren.has(jobId)) return;
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      if (!runningChildren.has(jobId)) return;
      try { child.kill('SIGKILL'); } catch {}
    }, TERM_GRACE_MS);
  }, CANCEL_GRACE_MS);
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

  const wasCancelling = cancellingJobs.delete(jobId);

  const jobRow = getDb()
    .prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?')
    .get(jobId);
  const currentStatus = jobRow?.status;

  let finalStatus: JobStatus;
  if (wasCancelling || signal === 'SIGKILL' || signal === 'SIGTERM') {
    finalStatus = 'cancelled';
  } else if (code === 0) {
    finalStatus = currentStatus === 'failed' ? 'failed' : 'completed';
  } else {
    finalStatus = currentStatus === 'failed' ? 'failed' : 'failed';
  }

  if (currentStatus === 'running') {
    finaliseJob(jobId, finalStatus, finalStatus === 'failed' ? (jobRow?.error ?? 'Worker exited unexpectedly') : null);
  }

  // Persist scrape result row if present. We treat 'cancelled' the same as
  // 'completed' here — the worker has already flushed whatever partial state
  // it had (CSV rows, result payload), so the user keeps what was scraped up
  // to the cancel point.
  const shouldPersistResult = finalStatus === 'completed' || finalStatus === 'cancelled';
  if (meta && shouldPersistResult && result && typeof result === 'object') {
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
    } else if (meta.kind === 'mass_dm') {
      try {
        const sent = Number(r.sent) || 0;
        const failed = Array.isArray(r.failed)
          ? r.failed.length
          : Number(r.failed) || 0;
        const total = Number(r.total) || sent + failed;
        getDb()
          .prepare(
            `INSERT OR REPLACE INTO mass_dm_results(
               job_id, account_id, sent_count, failed_count, total_count,
               duration_ms, completed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            meta.accountId,
            sent,
            failed,
            total,
            Date.now() - meta.startedAt,
            Date.now()
          );
      } catch (err) {
        console.error('[jobs] failed to persist mass_dm result:', err);
      }
    } else if (r.csvPath) {
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

        // If the job was tagged with a category, ingest the CSV into that
        // category's leads. Dedup happens at the DB layer via UNIQUE.
        if (typeof params.categoryId === 'string' && params.categoryId) {
          try {
            ingestLeadsFromCsv(params.categoryId, meta.kind, jobId, r.csvPath);
          } catch (err) {
            console.error('[jobs] failed to ingest leads into category:', err);
          }
        }
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
  const max = typeof params?.max === 'number' && params.max > 0 ? params.max : null;
  const fmtRange = (): string => {
    const from = typeof params?.from === 'number' ? new Date(params.from).toISOString().slice(0, 10) : null;
    const to = typeof params?.to === 'number' ? new Date(params.to).toISOString().slice(0, 10) : null;
    if (from && to) return ` (${from} → ${to})`;
    if (from) return ` (from ${from})`;
    if (to) return ` (until ${to})`;
    return '';
  };
  switch (kind) {
    case 'scrape_by_username': {
      const u = params?.username ? `@${params.username}` : '—';
      return max ? `Leads from ${u} (max ${max})` : `Leads from ${u}`;
    }
    case 'scrape_by_post':
      return `Engagers of ${params?.postUrl ?? 'post'}`;
    case 'scrape_by_hashtag':
      return `Engagers of #${params?.hashtag ?? ''}${fmtRange()}`;
    case 'scrape_by_location':
      return `Engagers at location${fmtRange()}`;
    default:
      return 'Scrape result';
  }
}

// Called from main on quit / before-close. Asks every running child to flush
// its partial state (same path as a UI-initiated cancel), waits up to
// `timeoutMs` for them to exit, then force-kills anything still running. The
// caller is expected to await this before calling `app.exit()`.
export async function shutdownAllJobs(timeoutMs = 15_000): Promise<void> {
  if (runningChildren.size === 0) return;
  for (const [jobId, child] of runningChildren) {
    cancellingJobs.add(jobId);
    try { child.send({ type: 'cancel' } as any); } catch {}
  }
  const deadline = Date.now() + timeoutMs;
  while (runningChildren.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const [, child] of runningChildren) {
    try { child.kill('SIGKILL'); } catch {}
  }
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
