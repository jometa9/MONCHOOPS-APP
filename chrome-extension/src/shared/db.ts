// IndexedDB-backed persistence. Mirrors the SQLite schema of the desktop
// app. The extension owns its own copy of every entity it cares about so
// the dashboard renders fast and works while the desktop app is offline.
// The sync engine in `sync.ts` reconciles these tables with the desktop
// over the local HTTP bridge.
//
// Service worker, popup, and dashboard all open the same Dexie instance —
// IndexedDB serializes writes per-store across contexts, so concurrent
// access from multiple extension pages is safe without explicit locking.

import Dexie, { type Table } from 'dexie';
import type {
  Campaign,
  DmHistoryRow,
  Lead,
  MetaRow,
  PendingMutation,
  SyncedActiveJob,
  SyncedCategory,
  SyncedCategoryLead,
  SyncedDmJob,
  SyncedDmSend,
  SyncedScrape,
  SyncedVariantGroup,
} from './types';

class B2dmExtDb extends Dexie {
  // Extension-owned tables (campaigns the extension itself runs).
  campaigns!: Table<Campaign, string>;
  leads!: Table<Lead, number>;
  history!: Table<DmHistoryRow, string>;
  meta!: Table<MetaRow, string>;

  // Mirror of desktop entities — kept in sync via `sync.ts`. Filled on first
  // dashboard mount and refreshed periodically while the bridge is reachable.
  categories!: Table<SyncedCategory, string>;
  categoryLeads!: Table<SyncedCategoryLead, number>;
  variantGroups!: Table<SyncedVariantGroup, string>;
  scrapes!: Table<SyncedScrape, string>;
  dmJobs!: Table<SyncedDmJob, string>;
  dmSends!: Table<SyncedDmSend, string>;
  activeJobs!: Table<SyncedActiveJob, string>;

  // Local mutations that haven't yet been acknowledged by the desktop.
  pendingMutations!: Table<PendingMutation, number>;

  constructor() {
    super('b2dm-ext');
    this.version(1).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: 'id, updatedAt',
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
    });
    // v2: variantGroups moved to the desktop app over the bridge. Drop the
    // local table so we stop double-bookkeeping.
    this.version(2).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: null,
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
    });
    // v3: re-introduce variantGroups as a local mirror, plus full mirrors of
    // categories / category leads / scrapes and a queue of pending pushes
    // for offline-tolerant CRUD against the desktop.
    this.version(3).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
      categories: 'id, updatedAt, deletedAt',
      categoryLeads: '++id, &[categoryId+username], categoryId, updatedAt, deletedAt',
      variantGroups: 'id, updatedAt, deletedAt',
      scrapes: 'jobId, completedAt, updatedAt, deletedAt',
      pendingMutations: '++id, entity, refId, createdAt',
    });
    // v4: add mirrors for desktop-side cold DM history (jobs + per-DM rows)
    // and the live job queue. The dashboard renders these alongside the
    // extension's own campaigns so the user sees one unified view.
    this.version(4).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
      categories: 'id, updatedAt, deletedAt',
      categoryLeads: '++id, &[categoryId+username], categoryId, updatedAt, deletedAt',
      variantGroups: 'id, updatedAt, deletedAt',
      scrapes: 'jobId, completedAt, updatedAt, deletedAt',
      pendingMutations: '++id, entity, refId, createdAt',
      dmJobs: 'jobId, completedAt, updatedAt, deletedAt',
      dmSends: 'key, jobId, sentAt',
      activeJobs: 'id, status, startedAt',
    });
  }
}

export const db = new B2dmExtDb();

// --- meta helpers ---------------------------------------------------------

export async function metaGet(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function metaSet(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.meta.delete(key);
    return;
  }
  await db.meta.put({ key, value });
}

export async function metaGetJson<T>(key: string): Promise<T | null> {
  const raw = await metaGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function metaSetJson(key: string, value: unknown): Promise<void> {
  await metaSet(key, JSON.stringify(value));
}

export async function metaGetNumber(key: string): Promise<number> {
  const raw = await metaGet(key);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export async function metaSetNumber(key: string, value: number): Promise<void> {
  await metaSet(key, String(value));
}

// --- domain queries used by both UI and SW --------------------------------

export async function nextPendingLead(campaignId: string): Promise<Lead | undefined> {
  return db.leads.where('[campaignId+status]').equals([campaignId, 'pending']).first();
}

export async function countLeads(
  campaignId: string,
  status?: Lead['status']
): Promise<number> {
  if (!status) return db.leads.where('campaignId').equals(campaignId).count();
  return db.leads
    .where('[campaignId+status]')
    .equals([campaignId, status])
    .count();
}
