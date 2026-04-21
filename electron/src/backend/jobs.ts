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
  upsertFailedAccount,
  type InstagramCookie,
} from './accounts';
import { ingestLeadsFromCsv, resolveCategoryRef } from './leads';
import { acquireSlot, releaseSlot, type WindowBounds } from './windowSlots';

export type JobKind =
  | 'login'
  | 'mass_dm'
  | 'scrape_by_username'
  | 'scrape_by_post'
  | 'scrape_by_hashtag'
  | 'scrape_by_location'
  | 'warmup';

export type WarmupAction =
  | { type: 'view_feed'; durationSec: number }
  | { type: 'view_explore'; durationSec: number }
  | { type: 'hashtag_like'; hashtag: string; count: number }
  | { type: 'hashtag_follow'; hashtag: string; count: number }
  | { type: 'location_like'; location: string; count: number }
  | { type: 'location_follow'; location: string; count: number }
  | {
      type: 'combo';
      feedSec: number;
      exploreSec: number;
      hashtag: string;
      likeCount: number;
      followCount: number;
    };

export interface WarmupResultPublic {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  actionType: WarmupAction['type'];
  action: WarmupAction;
  visited: number;
  liked: number;
  followed: number;
  skipped: number;
  failed: number;
  viewedMs: number;
  durationMs: number;
  completedAt: number;
}

export interface MassDmInteractionsConfig {
  /** Follow the target username before DMing them. */
  follow: boolean;
  /** Like this many of the target's most recent posts before DMing. 0
   *  means "don't like anything". */
  likeCount: number;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobPublic {
  id: string;
  accountId: string | null;
  kind: JobKind;
  params: unknown;
  status: JobStatus;
  startedAt: number;
  runningAt: number | null;
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
  csvPath: string | null;
  durationMs: number;
  completedAt: number;
  categoryId: string | null;
  categoryName: string | null;
  status: 'completed' | 'cancelled' | 'failed';
  error: string | null;
  accountId: string | null;
  accountUsername: string | null;
  params: unknown;
  targetName: string | null;
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
  running_at: number | null;
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
  csv_path: string | null;
  duration_ms: number;
  completed_at: number;
  status: 'completed' | 'cancelled' | 'failed';
  error: string | null;
  category_id: string | null;
  category_name: string | null;
  account_id: string | null;
  account_username: string | null;
  params_json: string | null;
  target_name: string | null;
}

type Listener = (event: JobEvent) => void;

export type JobEvent =
  | { type: 'jobs:changed' }
  | { type: 'jobs:progress'; jobId: string; done: number; total: number | null; item?: string }
  | { type: 'jobs:done'; jobId: string; status: JobStatus }
  | { type: 'jobs:accountDrained'; accountId: string; status: JobStatus }
  | { type: 'jobs:loginFinished'; jobId: string; status: JobStatus };

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
    runningAt: row.running_at,
    endedAt: row.ended_at,
    progressDone: row.progress_done,
    progressTotal: row.progress_total,
    error: row.error,
  };
}

function scrapeRowToPublic(row: ScrapeResultRow): ScrapeResultPublic {
  let params: unknown = null;
  if (row.params_json) {
    try { params = JSON.parse(row.params_json); } catch {}
  }
  return {
    jobId: row.job_id,
    kind: row.kind,
    summary: row.summary,
    usernameCount: row.username_count,
    csvPath: row.csv_path,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
    status: row.status,
    error: row.error,
    categoryId: row.category_id,
    categoryName: row.category_name,
    accountId: row.account_id,
    accountUsername: row.account_username,
    params,
    targetName: row.target_name,
  };
}

const SCRAPE_RESULT_SELECT = `
  SELECT
    sr.*,
    lc.id   AS category_id,
    lc.name AS category_name,
    j.account_id AS account_id,
    j.params_json AS params_json,
    a.username AS account_username
  FROM scrape_results sr
  LEFT JOIN jobs j ON j.id = sr.job_id
  LEFT JOIN accounts a ON a.id = j.account_id
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

// Running + queued, in dispatch order (FIFO by started_at, which we use as
// the enqueue timestamp). Used by the Queue UI.
export function listActiveJobs(): JobPublic[] {
  const rows = getDb()
    .prepare<[], JobRow>(
      `SELECT * FROM jobs WHERE status IN ('running','queued') ORDER BY started_at ASC`
    )
    .all();
  return rows.map(rowToPublic);
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
  if (!result || !result.csvPath) return [];
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

interface WarmupResultRow {
  job_id: string;
  account_id: string | null;
  account_username: string | null;
  action_type: string;
  action_json: string;
  result_json: string;
  duration_ms: number;
  completed_at: number;
}

const WARMUP_RESULT_SELECT = `
  SELECT
    wr.*,
    a.username AS account_username
  FROM warmup_results wr
  LEFT JOIN accounts a ON a.id = wr.account_id
`;

function warmupRowToPublic(row: WarmupResultRow): WarmupResultPublic {
  let action: WarmupAction = { type: 'view_feed', durationSec: 0 };
  try { action = JSON.parse(row.action_json) as WarmupAction; } catch {}
  let counters: Record<string, unknown> = {};
  try { counters = JSON.parse(row.result_json) as Record<string, unknown>; } catch {}
  return {
    jobId: row.job_id,
    accountId: row.account_id,
    accountUsername: row.account_username,
    actionType: action.type,
    action,
    visited: Number(counters.visited) || 0,
    liked: Number(counters.liked) || 0,
    followed: Number(counters.followed) || 0,
    skipped: Number(counters.skipped) || 0,
    failed: Number(counters.failed) || 0,
    viewedMs: Number(counters.viewedMs) || 0,
    durationMs: row.duration_ms,
    completedAt: row.completed_at,
  };
}

export function listWarmupResults(): WarmupResultPublic[] {
  const rows = getDb()
    .prepare<[], WarmupResultRow>(
      `${WARMUP_RESULT_SELECT} ORDER BY wr.completed_at DESC`
    )
    .all();
  return rows.map(warmupRowToPublic);
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

// "Full window" means: when headed, open the Chromium maximized instead of
// tiling it into the screen-grid. Defaults to false (tiling on) since the
// whole point of the headed mode is being able to monitor several runs
// side-by-side.
function getFullWindowPref(): boolean {
  return metaGet('full_window') === 'true';
}

function workerForKind(kind: JobKind): string {
  if (kind === 'login') return workerScriptPath('login');
  if (kind === 'mass_dm') return workerScriptPath('massDm');
  if (kind === 'warmup') return workerScriptPath('warmup');
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
      `INSERT INTO jobs(id, account_id, kind, params_json, status, started_at, running_at, progress_done)
       VALUES (?, ?, ?, ?, 'running', ?, ?, 0)`
    )
    .run(id, accountId, kind, JSON.stringify(params ?? {}), now, now);
  return id;
}

function insertQueuedJob(
  kind: JobKind,
  accountId: string,
  params: unknown
): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO jobs(id, account_id, kind, params_json, status, started_at, running_at, progress_done)
       VALUES (?, ?, ?, ?, 'queued', ?, NULL, 0)`
    )
    .run(id, accountId, kind, JSON.stringify(params ?? {}), now);
  return id;
}

function markJobRunning(jobId: string): number {
  const now = Date.now();
  getDb()
    .prepare(`UPDATE jobs SET status='running', running_at=? WHERE id=?`)
    .run(now, jobId);
  return now;
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

export interface LoginProxyInput {
  url: string;
  username?: string | null;
  password?: string | null;
}

// jobId -> proxy to apply to the account that login creates on success.
const pendingLoginProxies = new Map<string, LoginProxyInput>();

function toWorkerProxy(proxy: LoginProxyInput | null | undefined) {
  if (!proxy || !proxy.url) return undefined;
  return {
    server: proxy.url,
    username: proxy.username ?? undefined,
    password: proxy.password ?? undefined,
  };
}

export interface StartLoginArgs {
  accountId?: string;
  proxy?: LoginProxyInput | null;
}

export function startLogin(args: StartLoginArgs = {}): string {
  for (const [, meta] of runningMeta) {
    if (meta.kind === 'login') {
      throw new Error('A login window is already open. Complete or close it first.');
    }
  }
  const jobId = insertJob('login', null, {});
  const scriptPath = workerScriptPath('login');
  // Manual login is always headed — the user has to interact with it.
  const child = spawnWorker(
    scriptPath,
    jobId,
    {
      type: 'init',
      payload: { jobId, proxy: toWorkerProxy(args.proxy) },
    },
    { headed: true }
  );
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId: null, kind: 'login' });
  if (args.proxy && args.proxy.url) pendingLoginProxies.set(jobId, args.proxy);
  emit({ type: 'jobs:changed' });
  return jobId;
}

export interface StartAutoLoginArgs {
  username: string;
  password: string;
  proxy?: LoginProxyInput | null;
}

export function startAutoLogin(args: StartAutoLoginArgs): string {
  // Single-credential auto-login is just a bulk import with one row. Keeps
  // both paths on the same worker + persistence pipeline.
  return startBulkAutoLogin([
    {
      username: args.username,
      password: args.password,
      proxyUrl: args.proxy?.url ?? undefined,
      proxyUsername: args.proxy?.username ?? undefined,
      proxyPassword: args.proxy?.password ?? undefined,
    },
  ]);
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
  const headless = getHeadlessPref();
  const child = spawnWorker(
    scriptPath,
    jobId,
    {
      type: 'init',
      payload: { jobId, rows, headless },
    },
    { headed: !headless }
  );
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
  interactions?: MassDmInteractionsConfig | null;
}

const MAX_DM_VARIANTS = 20;

export function startMassDm(args: StartMassDmArgs): string {
  const acc = getAccount(args.accountId);
  if (!acc) throw new Error('Account not found');

  const messages = (args.messages ?? [])
    .map((m) => m.trim())
    .filter((m) => m.length > 0)
    .slice(0, MAX_DM_VARIANTS);
  if (messages.length === 0) throw new Error('At least one message variant is required');

  const interactions = normaliseInteractions(args.interactions);
  const params = {
    intervalMs: args.intervalMs,
    messages,
    usernamesCsvPath: args.usernamesCsvPath,
    interactions,
  };

  if (hasPendingJobForAccount(args.accountId)) {
    const jobId = insertQueuedJob('mass_dm', args.accountId, params);
    emit({ type: 'jobs:changed' });
    return jobId;
  }

  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const jobId = insertJob('mass_dm', args.accountId, params);
  spawnMassDmWorker(jobId, args.accountId, secrets, params);
  emit({ type: 'jobs:changed' });
  return jobId;
}

function normaliseInteractions(
  raw: MassDmInteractionsConfig | null | undefined
): MassDmInteractionsConfig | null {
  if (!raw) return null;
  const likeCount = Math.max(0, Math.min(5, Math.floor(Number(raw.likeCount) || 0)));
  const follow = !!raw.follow;
  if (!follow && likeCount === 0) return null;
  return { follow, likeCount };
}

function spawnMassDmWorker(
  jobId: string,
  accountId: string,
  secrets: NonNullable<ReturnType<typeof getAccountSecrets>>,
  params: {
    usernamesCsvPath: string;
    messages: string[];
    intervalMs: number;
    interactions?: MassDmInteractionsConfig | null;
  }
): void {
  const headless = getHeadlessPref();
  const child = spawnWorker(
    workerForKind('mass_dm'),
    jobId,
    {
      type: 'init',
      payload: {
        jobId,
        secrets,
        usernamesCsvPath: params.usernamesCsvPath,
        messages: params.messages,
        intervalMs: params.intervalMs,
        interactions: params.interactions ?? null,
        headless,
      },
    },
    { headed: !headless }
  );
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId, kind: 'mass_dm' });
  setAccountStatus(accountId, 'busy');
}

export interface StartWarmupArgs {
  accountId: string;
  action: WarmupAction;
}

export function startWarmup(args: StartWarmupArgs): string {
  const acc = getAccount(args.accountId);
  if (!acc) throw new Error('Account not found');

  const action = validateWarmupAction(args.action);
  const params = { action };

  if (hasPendingJobForAccount(args.accountId)) {
    const jobId = insertQueuedJob('warmup', args.accountId, params);
    emit({ type: 'jobs:changed' });
    return jobId;
  }

  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const jobId = insertJob('warmup', args.accountId, params);
  spawnWarmupWorker(jobId, args.accountId, secrets, action);
  emit({ type: 'jobs:changed' });
  return jobId;
}

function validateWarmupAction(action: WarmupAction): WarmupAction {
  switch (action.type) {
    case 'view_feed':
    case 'view_explore': {
      const durationSec = Math.max(30, Math.min(1800, Math.floor(action.durationSec)));
      return { type: action.type, durationSec };
    }
    case 'hashtag_like':
    case 'hashtag_follow': {
      const hashtag = (action.hashtag || '').replace(/^#+/, '').trim();
      if (!hashtag) throw new Error('Hashtag is required');
      const count = Math.max(1, Math.min(50, Math.floor(action.count)));
      return { type: action.type, hashtag, count };
    }
    case 'location_like':
    case 'location_follow': {
      const location = (action.location || '').trim();
      if (!location) throw new Error('Location URL or slug is required');
      const count = Math.max(1, Math.min(50, Math.floor(action.count)));
      return { type: action.type, location, count };
    }
    case 'combo': {
      const hashtag = (action.hashtag || '').replace(/^#+/, '').trim();
      if (!hashtag) throw new Error('Hashtag is required for the combo warmup');
      return {
        type: 'combo',
        feedSec: Math.max(0, Math.min(1800, Math.floor(action.feedSec))),
        exploreSec: Math.max(0, Math.min(1800, Math.floor(action.exploreSec))),
        hashtag,
        likeCount: Math.max(0, Math.min(50, Math.floor(action.likeCount))),
        followCount: Math.max(0, Math.min(50, Math.floor(action.followCount))),
      };
    }
    default:
      throw new Error('Unknown warmup action');
  }
}

function spawnWarmupWorker(
  jobId: string,
  accountId: string,
  secrets: NonNullable<ReturnType<typeof getAccountSecrets>>,
  action: WarmupAction
): void {
  const headless = getHeadlessPref();
  const child = spawnWorker(
    workerForKind('warmup'),
    jobId,
    {
      type: 'init',
      payload: {
        jobId,
        secrets,
        action,
        headless,
      },
    },
    { headed: !headless }
  );
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId, kind: 'warmup' });
  setAccountStatus(accountId, 'busy');
}

export interface StartScrapeArgs {
  accountId: string;
  kind: Exclude<JobKind, 'login' | 'mass_dm' | 'warmup'>;
  params: Record<string, unknown>;
}

export function startScrape(args: StartScrapeArgs): string {
  const acc = getAccount(args.accountId);
  if (!acc) throw new Error('Account not found');

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
    ...(typeof args.params.username === 'string'
      ? { username: args.params.username.trim().replace(/^@+/, '') }
      : {}),
    ...(typeof args.params.hashtag === 'string'
      ? { hashtag: args.params.hashtag.trim().replace(/^#+/, '') }
      : {}),
  };

  if (hasPendingJobForAccount(args.accountId)) {
    const jobId = insertQueuedJob(args.kind, args.accountId, paramsWithCategory);
    emit({ type: 'jobs:changed' });
    return jobId;
  }

  const secrets = getAccountSecrets(args.accountId);
  if (!secrets) throw new Error('Account not found');

  const jobId = insertJob(args.kind, args.accountId, paramsWithCategory);
  spawnScrapeWorker(jobId, args.accountId, args.kind, secrets, paramsWithCategory);
  emit({ type: 'jobs:changed' });
  return jobId;
}

function spawnScrapeWorker(
  jobId: string,
  accountId: string,
  kind: Exclude<JobKind, 'login' | 'mass_dm' | 'warmup'>,
  secrets: NonNullable<ReturnType<typeof getAccountSecrets>>,
  params: Record<string, unknown>
): void {
  const csvPath = path.join(scrapesDir(), `${jobId}.csv`);
  const headless = getHeadlessPref();
  const child = spawnWorker(
    workerForKind(kind),
    jobId,
    {
      type: 'init',
      payload: {
        jobId,
        kind,
        secrets,
        csvPath,
        params,
        headless,
      },
    },
    { headed: !headless }
  );
  runningChildren.set(jobId, child);
  runningMeta.set(jobId, { startedAt: Date.now(), accountId, kind });
  setAccountStatus(accountId, 'busy');
}

// True if the account already has a running or queued job. Login jobs don't
// have an accountId so they can't block anything here.
function hasPendingJobForAccount(accountId: string): boolean {
  const row = getDb()
    .prepare<[string], { c: number }>(
      `SELECT COUNT(*) AS c FROM jobs
       WHERE account_id = ? AND status IN ('running','queued')`
    )
    .get(accountId);
  return (row?.c ?? 0) > 0;
}

// Pull the next queued job for this account and dispatch it. Returns true if
// a job was started; false if the queue is empty.
function dispatchNextForAccount(accountId: string): boolean {
  const row = getDb()
    .prepare<[string], JobRow>(
      `SELECT * FROM jobs
       WHERE account_id = ? AND status = 'queued'
       ORDER BY started_at ASC LIMIT 1`
    )
    .get(accountId);
  if (!row) return false;

  const secrets = getAccountSecrets(accountId);
  if (!secrets) {
    finaliseJob(row.id, 'failed', 'Account secrets not available');
    emit({ type: 'jobs:done', jobId: row.id, status: 'failed' });
    // Try the next one (account may still have queue entries we should flush).
    return dispatchNextForAccount(accountId);
  }

  markJobRunning(row.id);
  const params = (() => {
    try { return JSON.parse(row.params_json); } catch { return {}; }
  })();

  if (row.kind === 'mass_dm') {
    spawnMassDmWorker(row.id, accountId, secrets, {
      usernamesCsvPath: String(params.usernamesCsvPath ?? ''),
      messages: Array.isArray(params.messages) ? params.messages : [],
      intervalMs: Number(params.intervalMs) || 0,
      interactions: normaliseInteractions(params.interactions ?? null),
    });
  } else if (row.kind === 'warmup') {
    try {
      spawnWarmupWorker(
        row.id,
        accountId,
        secrets,
        validateWarmupAction(params.action as WarmupAction)
      );
    } catch (err) {
      finaliseJob(row.id, 'failed', err instanceof Error ? err.message : String(err));
      emit({ type: 'jobs:done', jobId: row.id, status: 'failed' });
      return dispatchNextForAccount(accountId);
    }
  } else {
    spawnScrapeWorker(
      row.id,
      accountId,
      row.kind as Exclude<JobKind, 'login' | 'mass_dm' | 'warmup'>,
      secrets,
      params
    );
  }
  return true;
}

export function cancelJob(jobId: string): void {
  const child = runningChildren.get(jobId);
  if (!child) {
    // Queued (not yet running) job — no worker to stop. Just mark cancelled.
    const row = getDb()
      .prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?')
      .get(jobId);
    if (row && row.status === 'queued') {
      finaliseJob(jobId, 'cancelled');
      emit({ type: 'jobs:done', jobId, status: 'cancelled' });
      emit({ type: 'jobs:changed' });
    }
    return;
  }
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

function spawnWorker(
  scriptPath: string,
  jobId: string,
  initMessage: unknown,
  opts: { headed: boolean } = { headed: false }
): ChildProcess {
  if (!fs.existsSync(scriptPath)) {
    finaliseJob(jobId, 'failed', `Worker script not found: ${scriptPath}`);
    throw new Error(`Worker script not found: ${scriptPath}`);
  }

  console.log(`[jobs] forking worker ${jobId} → ${scriptPath}`);

  // Pick the headed-window strategy. "Full window" maximizes the Chromium
  // and skips tiling entirely; otherwise we reserve a tile on the screen
  // grid and inject its bounds into the worker's init payload (released in
  // handleWorkerExit). Headless runs ignore both — there's no window to
  // place.
  let messageToSend = initMessage as any;
  if (opts.headed && messageToSend && typeof messageToSend === 'object' && messageToSend.payload) {
    if (getFullWindowPref()) {
      messageToSend = {
        ...messageToSend,
        payload: { ...messageToSend.payload, maximizeWindow: true },
      };
    } else {
      const bounds: WindowBounds | null = acquireSlot(jobId);
      if (bounds) {
        messageToSend = {
          ...messageToSend,
          payload: { ...messageToSend.payload, windowBounds: bounds },
        };
      }
    }
  }

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
    child.send(messageToSend);
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
  } else if (msg.type === 'login-failed') {
    persistFailedLogin(jobId, msg.payload);
  }
}

function persistFailedLogin(jobId: string, payload: any): void {
  if (!payload || typeof payload !== 'object') return;
  const username = typeof payload.username === 'string' ? payload.username.trim() : '';
  if (!username) return;
  try {
    upsertFailedAccount({
      username,
      password: typeof payload.password === 'string' ? payload.password : null,
      lastError: typeof payload.error === 'string' ? payload.error : 'Login failed',
    });
    emit({ type: 'jobs:changed' });
  } catch (err) {
    console.error(`[jobs ${jobId}] failed to persist failed login:`, err);
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
      password: typeof payload.password === 'string' ? payload.password : null,
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
  releaseSlot(jobId);

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

  // Persist result rows. For scrapes we record every terminal status
  // (completed / cancelled / failed) so the history screen can surface the
  // full picture — cancelled keeps whatever partial CSV the worker flushed,
  // failed may have no CSV at all but we still want the row + retry action.
  // For login / mass_dm / warmup we keep the previous behaviour (persist on
  // completed or cancelled only).
  const isScrape = meta && meta.kind !== 'login' && meta.kind !== 'mass_dm' && meta.kind !== 'warmup';
  const shouldPersistResult = finalStatus === 'completed' || finalStatus === 'cancelled';
  if (meta && isScrape && finalStatus === 'failed') {
    try {
      const params = (() => {
        try { return JSON.parse(jobRow?.params_json ?? '{}'); } catch { return {}; }
      })();
      const r = (result && typeof result === 'object' ? result : {}) as any;
      const count = Number(r?.count) || 0;
      const summary = buildScrapeSummary(meta.kind, params, count);
      const targetName = typeof r?.targetName === 'string' && r.targetName ? r.targetName : null;
      getDb()
        .prepare(
          `INSERT INTO scrape_results(
             job_id, kind, summary, username_count, csv_path, duration_ms, completed_at, status, error, target_name
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          jobId,
          meta.kind,
          summary,
          count,
          typeof r?.csvPath === 'string' ? r.csvPath : null,
          Date.now() - meta.startedAt,
          Date.now(),
          'failed',
          jobRow?.error ?? 'Scrape failed',
          targetName
        );
    } catch (err) {
      console.error('[jobs] failed to persist failed-scrape result:', err);
    }
  }
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
          password: typeof r.password === 'string' ? r.password : null,
        });
        const pendingProxy = pendingLoginProxies.get(jobId);
        if (pendingProxy && pendingProxy.url) {
          try {
            updateProxy(acc.id, {
              url: pendingProxy.url,
              username: pendingProxy.username ?? null,
              password: pendingProxy.password ?? null,
            });
          } catch (err) {
            console.error(`[jobs ${jobId}] failed to apply proxy for ${acc.username}:`, err);
          }
        }
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
    } else if (meta.kind === 'warmup') {
      try {
        const params = (() => {
          try { return JSON.parse(jobRow?.params_json ?? '{}'); } catch { return {}; }
        })();
        const action = params.action ?? null;
        const actionType = typeof r.action === 'string' ? r.action : action?.type ?? 'unknown';
        getDb()
          .prepare(
            `INSERT OR REPLACE INTO warmup_results(
               job_id, account_id, action_type, action_json, result_json,
               duration_ms, completed_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            meta.accountId,
            actionType,
            JSON.stringify(action ?? {}),
            JSON.stringify(r),
            Date.now() - meta.startedAt,
            Date.now()
          );
      } catch (err) {
        console.error('[jobs] failed to persist warmup result:', err);
      }
    } else if (r.csvPath) {
      try {
        const params = (() => {
          try { return JSON.parse(jobRow?.params_json ?? '{}'); } catch { return {}; }
        })();
        const summary = buildScrapeSummary(meta.kind, params, r.count);
        const targetName = typeof r.targetName === 'string' && r.targetName ? r.targetName : null;
        getDb()
          .prepare(
            `INSERT INTO scrape_results(
               job_id, kind, summary, username_count, csv_path, duration_ms, completed_at, status, error, target_name
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            jobId,
            meta.kind,
            summary,
            Number(r.count) || 0,
            r.csvPath,
            Date.now() - meta.startedAt,
            Date.now(),
            finalStatus,
            null,
            targetName
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

  pendingLoginProxies.delete(jobId);

  emit({ type: 'jobs:done', jobId, status: finalStatus });

  // Login jobs don't carry an accountId (the account row is created *after*
  // the worker succeeds), so they never trigger `jobs:accountDrained` and the
  // renderer wouldn't get a completion cue. Emit a dedicated signal so the
  // UI can play the completion sound when a login job — individual or bulk —
  // finishes.
  if (meta?.kind === 'login') {
    emit({ type: 'jobs:loginFinished', jobId, status: finalStatus });
  }

  // Per-account FIFO: if more jobs are queued for this account, dispatch the
  // next one and keep the account flagged 'busy'. Only when the queue drains
  // do we release the account and emit the "account drained" signal (used by
  // the renderer to play the completion sound exactly once per batch).
  if (meta?.accountId) {
    const startedNext = dispatchNextForAccount(meta.accountId);
    if (!startedNext) {
      // A failed scrape means the *target* or the scrape worker broke — the
      // account's session is still good. Only login failures (and other
      // account-level jobs) should flip the account into 'error'. Scrape
      // failures keep the account idle so it can run more jobs immediately.
      const failedErrorsAccount = finalStatus === 'failed' && !isScrape;
      setAccountStatus(
        meta.accountId,
        failedErrorsAccount ? 'error' : 'idle',
        failedErrorsAccount ? (jobRow?.error ?? null) : null
      );
      emit({
        type: 'jobs:accountDrained',
        accountId: meta.accountId,
        status: finalStatus,
      });
    }
  }

  emit({ type: 'jobs:changed' });
}

function buildScrapeSummary(kind: JobKind, params: any, _count: number): string {
  const target = typeof params?.target === 'number' && params.target > 0 ? params.target : null;
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
      return target ? `Leads from ${u} (target ${target})` : `Leads from ${u}`;
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
  // Cancel any queued jobs up front — they haven't forked yet and won't run
  // during this shutdown.
  try {
    getDb()
      .prepare(`UPDATE jobs SET status='cancelled', ended_at=? WHERE status='queued'`)
      .run(Date.now());
  } catch {}

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

// On app boot, mark any stranded 'running' rows as failed and 'queued' rows
// as cancelled, then flip busy accounts back to idle. Jobs never survive an
// app restart in v1.
export function reconcileOnStartup(): void {
  try {
    const now = Date.now();
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'failed', ended_at = ?, error = 'App restarted before job finished' WHERE status = 'running'`
      )
      .run(now);
    getDb()
      .prepare(
        `UPDATE jobs SET status = 'cancelled', ended_at = ? WHERE status = 'queued'`
      )
      .run(now);
    getDb().prepare(`UPDATE accounts SET status = 'idle' WHERE status = 'busy'`).run();
  } catch (err) {
    console.error('[jobs] reconcileOnStartup failed:', err);
  }
}
