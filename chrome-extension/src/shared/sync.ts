// Sync engine. Reconciles the extension's Dexie mirror with the desktop's
// SQLite over the local HTTP bridge.
//
// Strategy: full-snapshot pull per entity. The bridge GET endpoints return
// the desktop's complete state for each entity, and we diff against the
// local mirror by id + updatedAt:
//
//   - rows present remotely → upsert if remote.updatedAt > local.updatedAt
//   - rows missing remotely → tombstone (deletedAt = now) unless they have
//     pendingPush set (extension-only inserts that the desktop hasn't
//     acknowledged yet)
//   - rows queued in `pendingMutations` → POST/PUT/DELETE to the desktop;
//     drop from the queue on success, increment `attempts` on failure
//
// All entities the user cares about are small (a few hundred rows at most),
// so a full snapshot every 30s is much simpler than maintaining tombstones
// and `?since=` deltas on the desktop side.

import { db } from './db';
import {
  BridgeError,
  createDesktopCategory,
  createVariantGroup,
  deleteDesktopCategory,
  deleteVariantGroup,
  isDesktopReachable,
  listCategoryLeadsFull,
  listDesktopActiveJobs,
  listDesktopCategories,
  listDesktopDmResults,
  listDesktopDmSends,
  listDesktopScrapes,
  listVariantGroups,
  pushLeadsToDesktopCategory,
  renameDesktopCategory,
  updateVariantGroup,
} from './desktop-bridge';
import type {
  PendingMutation,
  SyncedActiveJob,
  SyncedCategory,
  SyncedCategoryLead,
  SyncedDmJob,
  SyncedDmSend,
  SyncedScrape,
  SyncedVariantGroup,
} from './types';

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'connected'; lastSyncAt: number }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

type Listener = (status: SyncStatus) => void;

const listeners = new Set<Listener>();
let current: SyncStatus = { kind: 'idle' };
let inflight: Promise<void> | null = null;
let pollTimer: number | null = null;

const POLL_INTERVAL_MS = 30_000;

export function getSyncStatus(): SyncStatus {
  return current;
}

export function onSyncStatusChange(cb: Listener): () => void {
  listeners.add(cb);
  cb(current);
  return () => listeners.delete(cb);
}

function emit(next: SyncStatus): void {
  current = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch (err) {
      console.warn('[sync] listener threw', err);
    }
  }
}

/** Trigger a sync now. Concurrent calls dedupe onto the same in-flight run. */
export async function runSync(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    emit({ kind: 'syncing' });
    try {
      if (!(await isDesktopReachable())) {
        emit({ kind: 'offline' });
        return;
      }
      // Drain pending mutations first so subsequent pulls reflect them.
      await flushPendingMutations();
      await Promise.all([
        pullCategories(),
        pullVariants(),
        pullScrapes(),
        pullDmJobs(),
        pullActiveJobs(),
      ]);
      emit({ kind: 'connected', lastSyncAt: Date.now() });
    } catch (err) {
      const offline = err instanceof BridgeError && err.code === 'no_desktop';
      if (offline) {
        emit({ kind: 'offline' });
      } else {
        emit({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Start the periodic background sync. Idempotent — calling twice does not
 *  schedule two timers. */
export function startSyncPolling(): void {
  if (pollTimer !== null) return;
  void runSync();
  pollTimer = window.setInterval(() => {
    void runSync();
  }, POLL_INTERVAL_MS);
}

export function stopSyncPolling(): void {
  if (pollTimer === null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

// --- pulls ---------------------------------------------------------------

async function pullCategories(): Promise<void> {
  const remote = await listDesktopCategories();
  const local = await db.categories.toArray();
  const remoteById = new Map(remote.map((r) => [r.id, r]));
  const localById = new Map(local.map((r) => [r.id, r]));

  const toPut: SyncedCategory[] = [];

  // Upsert / refresh from remote.
  for (const r of remote) {
    const l = localById.get(r.id);
    if (!l || r.updatedAt >= (l.updatedAt ?? 0)) {
      toPut.push({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        leadCount: r.leadCount,
        scrapeCount: r.scrapeCount,
        lastActivityAt: r.lastActivityAt,
        deletedAt: null,
        pendingPush: false,
      });
    }
  }

  // Tombstone local rows that disappeared remotely (unless they're queued
  // for an initial push — those haven't been seen by the desktop yet).
  const now = Date.now();
  for (const l of local) {
    if (remoteById.has(l.id)) continue;
    if (l.pendingPush) continue;
    if (l.deletedAt) continue;
    toPut.push({ ...l, deletedAt: now, updatedAt: now });
  }

  if (toPut.length > 0) await db.categories.bulkPut(toPut);
}

async function pullVariants(): Promise<void> {
  const remote = await listVariantGroups();
  const local = await db.variantGroups.toArray();
  const remoteById = new Map(remote.map((r) => [r.id, r]));

  const toPut: SyncedVariantGroup[] = [];

  for (const r of remote) {
    const l = local.find((x) => x.id === r.id);
    if (!l || r.updatedAt >= (l.updatedAt ?? 0)) {
      toPut.push({
        id: r.id,
        name: r.name,
        variants: r.variants,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        deletedAt: null,
        pendingPush: false,
      });
    }
  }

  const now = Date.now();
  for (const l of local) {
    if (remoteById.has(l.id)) continue;
    if (l.pendingPush) continue;
    if (l.deletedAt) continue;
    toPut.push({ ...l, deletedAt: now, updatedAt: now });
  }

  if (toPut.length > 0) await db.variantGroups.bulkPut(toPut);
}

async function pullScrapes(): Promise<void> {
  // Scrapes are produced exclusively on the desktop, so sync is one-way.
  const remote = await listDesktopScrapes();
  const local = await db.scrapes.toArray();
  const remoteById = new Map(remote.map((r) => [r.jobId, r]));

  const toPut: SyncedScrape[] = remote.map((r) => ({
    jobId: r.jobId,
    summary: r.summary,
    usernameCount: r.usernameCount,
    completedAt: r.completedAt,
    targetName: r.targetName,
    kind: r.kind,
    accountUsername: r.accountUsername,
    updatedAt: r.completedAt,
    deletedAt: null,
  }));

  const now = Date.now();
  for (const l of local) {
    if (remoteById.has(l.jobId)) continue;
    if (l.deletedAt) continue;
    toPut.push({ ...l, deletedAt: now, updatedAt: now });
  }

  if (toPut.length > 0) await db.scrapes.bulkPut(toPut);
}

async function pullDmJobs(): Promise<void> {
  const remote = await listDesktopDmResults();
  const local = await db.dmJobs.toArray();
  const remoteById = new Map(remote.map((r) => [r.jobId, r]));

  const toPut: SyncedDmJob[] = remote.map((r) => ({
    jobId: r.jobId,
    accountId: r.accountId,
    accountUsername: r.accountUsername,
    accountProfilePicUrl: r.accountProfilePicUrl,
    sentCount: r.sentCount,
    failedCount: r.failedCount,
    totalCount: r.totalCount,
    durationMs: r.durationMs,
    completedAt: r.completedAt,
    updatedAt: r.completedAt,
    deletedAt: null,
  }));

  const now = Date.now();
  for (const l of local) {
    if (remoteById.has(l.jobId)) continue;
    if (l.deletedAt) continue;
    toPut.push({ ...l, deletedAt: now, updatedAt: now });
  }

  if (toPut.length > 0) await db.dmJobs.bulkPut(toPut);
}

async function pullActiveJobs(): Promise<void> {
  // Active jobs change every second while running — don't bother diffing.
  // Just replace the table with a fresh snapshot every sync.
  const remote = await listDesktopActiveJobs();
  const fetchedAt = Date.now();
  const rows: SyncedActiveJob[] = remote.map((j) => ({
    id: j.id,
    kind: j.kind,
    status: j.status,
    accountId: j.accountId,
    startedAt: j.startedAt,
    runningAt: j.runningAt,
    finishedAt: j.finishedAt,
    progressDone: j.progressDone,
    progressTotal: j.progressTotal,
    error: j.error,
    paramsJson: j.params ? JSON.stringify(j.params) : null,
    fetchedAt,
  }));
  await db.transaction('rw', db.activeJobs, async () => {
    await db.activeJobs.clear();
    if (rows.length > 0) await db.activeJobs.bulkPut(rows);
  });
}

/** On-demand pull for the per-recipient sends of a single mass-DM job.
 *  Filled when the user opens a DM job's detail screen. */
export async function pullDmSends(jobId: string): Promise<void> {
  if (!(await isDesktopReachable())) return;
  const remote = await listDesktopDmSends(jobId);
  const rows: SyncedDmSend[] = remote.map((s) => ({
    key: `${s.jobId}::${s.username.toLowerCase()}::${s.sentAt}`,
    jobId: s.jobId,
    username: s.username,
    status: s.status,
    message: s.message,
    error: s.error,
    sentAt: s.sentAt,
    updatedAt: s.sentAt,
  }));
  await db.transaction('rw', db.dmSends, async () => {
    await db.dmSends.where('jobId').equals(jobId).delete();
    if (rows.length > 0) await db.dmSends.bulkPut(rows);
  });
}

/** On-demand pull for the leads inside a specific category. Called when the
 *  user opens a CategoryDetail screen — we don't keep all category leads
 *  hot-cached because they can be 5000 per category. */
export async function pullCategoryLeads(categoryId: string): Promise<void> {
  if (!(await isDesktopReachable())) return;
  const remote = await listCategoryLeadsFull(categoryId);
  const local = await db.categoryLeads.where('categoryId').equals(categoryId).toArray();
  const remoteByUsername = new Map(remote.map((r) => [r.username.toLowerCase(), r]));
  const localByUsername = new Map(local.map((r) => [r.username.toLowerCase(), r]));

  const toPut: SyncedCategoryLead[] = [];

  for (const r of remote) {
    const key = r.username.toLowerCase();
    const l = localByUsername.get(key);
    if (!l || (r.scrapedAt ?? 0) >= (l.updatedAt ?? 0)) {
      toPut.push({
        id: l?.id,
        categoryId: r.categoryId,
        username: r.username,
        sourceKind: r.sourceKind,
        sourceJobId: r.sourceJobId,
        sourceDetail: r.sourceDetail,
        scrapedAt: r.scrapedAt,
        updatedAt: r.scrapedAt,
        deletedAt: null,
        pendingPush: false,
      });
    }
  }

  const toDelete: number[] = [];
  for (const l of local) {
    if (remoteByUsername.has(l.username.toLowerCase())) continue;
    if (l.pendingPush) continue;
    if (l.id !== undefined) toDelete.push(l.id);
  }

  await db.transaction('rw', db.categoryLeads, async () => {
    if (toPut.length > 0) await db.categoryLeads.bulkPut(toPut);
    if (toDelete.length > 0) await db.categoryLeads.bulkDelete(toDelete);
  });
}

// --- pushes --------------------------------------------------------------

/** Enqueue a mutation that will be flushed to the desktop on the next sync.
 *  The local DB is already updated by the caller; this just records the
 *  intent to propagate. */
export async function enqueuePush(
  entity: PendingMutation['entity'],
  op: PendingMutation['op'],
  refId: string,
  payload: unknown
): Promise<void> {
  await db.pendingMutations.add({
    entity,
    op,
    refId,
    payload: JSON.stringify(payload ?? {}),
    createdAt: Date.now(),
    attempts: 0,
  });
  // Best-effort flush. If the desktop is offline this no-ops; the row
  // stays queued for the next periodic run.
  void runSync();
}

async function flushPendingMutations(): Promise<void> {
  const queue = await db.pendingMutations.orderBy('createdAt').toArray();
  for (const m of queue) {
    try {
      await dispatchMutation(m);
      if (m.id !== undefined) await db.pendingMutations.delete(m.id);
    } catch (err) {
      const offline = err instanceof BridgeError && err.code === 'no_desktop';
      // If the desktop went away mid-flush, stop and let the next run pick
      // up where we left off.
      if (offline) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (m.id !== undefined) {
        await db.pendingMutations.update(m.id, {
          attempts: (m.attempts ?? 0) + 1,
          lastError: msg,
        });
      }
      // Move on so one bad row doesn't block the queue forever.
    }
  }
}

async function dispatchMutation(m: PendingMutation): Promise<void> {
  const body = m.payload ? (JSON.parse(m.payload) as Record<string, unknown>) : {};

  if (m.entity === 'category') {
    if (m.op === 'create') {
      const name = String(body.name ?? '');
      const remote = await createDesktopCategory(name);
      // Remote id may differ from local id (extension uses local UUIDs
      // before the desktop assigns one). Migrate the local row to the
      // remote id so subsequent updates target it.
      await reattachCategoryLocalId(m.refId, remote.id);
      return;
    }
    if (m.op === 'update') {
      await renameDesktopCategory(m.refId, String(body.name ?? ''));
      return;
    }
    if (m.op === 'delete') {
      await deleteDesktopCategory(m.refId);
      return;
    }
  }

  if (m.entity === 'categoryLead') {
    if (m.op === 'create') {
      const usernames = Array.isArray(body.usernames) ? (body.usernames as string[]) : [];
      await pushLeadsToDesktopCategory(m.refId, usernames, String(body.sourceDetail ?? 'extension'));
      return;
    }
  }

  if (m.entity === 'variants') {
    if (m.op === 'create') {
      const remote = await createVariantGroup({
        name: String(body.name ?? ''),
        variants: Array.isArray(body.variants) ? (body.variants as string[]) : [],
      });
      await reattachVariantGroupLocalId(m.refId, remote.id);
      return;
    }
    if (m.op === 'update') {
      await updateVariantGroup(m.refId, {
        name: String(body.name ?? ''),
        variants: Array.isArray(body.variants) ? (body.variants as string[]) : [],
      });
      return;
    }
    if (m.op === 'delete') {
      await deleteVariantGroup(m.refId);
      return;
    }
  }
}

async function reattachCategoryLocalId(localId: string, remoteId: string): Promise<void> {
  if (localId === remoteId) {
    await db.categories.update(localId, { pendingPush: false });
    return;
  }
  const row = await db.categories.get(localId);
  if (!row) return;
  await db.transaction('rw', db.categories, async () => {
    await db.categories.delete(localId);
    await db.categories.put({ ...row, id: remoteId, pendingPush: false });
  });
}

async function reattachVariantGroupLocalId(
  localId: string,
  remoteId: string
): Promise<void> {
  if (localId === remoteId) {
    await db.variantGroups.update(localId, { pendingPush: false });
    return;
  }
  const row = await db.variantGroups.get(localId);
  if (!row) return;
  await db.transaction('rw', db.variantGroups, async () => {
    await db.variantGroups.delete(localId);
    await db.variantGroups.put({ ...row, id: remoteId, pendingPush: false });
  });
}
