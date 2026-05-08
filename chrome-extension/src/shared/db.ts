

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

class MonchoOpsExtDb extends Dexie {

  campaigns!: Table<Campaign, string>;
  leads!: Table<Lead, number>;
  history!: Table<DmHistoryRow, string>;
  meta!: Table<MetaRow, string>;

  categories!: Table<SyncedCategory, string>;
  categoryLeads!: Table<SyncedCategoryLead, number>;
  variantGroups!: Table<SyncedVariantGroup, string>;
  scrapes!: Table<SyncedScrape, string>;
  dmJobs!: Table<SyncedDmJob, string>;
  dmSends!: Table<SyncedDmSend, string>;
  activeJobs!: Table<SyncedActiveJob, string>;

  pendingMutations!: Table<PendingMutation, number>;

  constructor() {
    super('monchoops-ext');
    this.version(1).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: 'id, updatedAt',
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
    });

    this.version(2).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: null,
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
    });

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

export const db = new MonchoOpsExtDb();

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
