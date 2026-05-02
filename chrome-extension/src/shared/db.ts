// IndexedDB-backed persistence. Mirrors the SQLite schema of the desktop
// app but only for the slice the extension needs: campaigns, leads,
// reusable variant groups, DM history, and a small key/value meta store.
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
  VariantGroup,
} from './types';

class B2dmExtDb extends Dexie {
  campaigns!: Table<Campaign, string>;
  leads!: Table<Lead, number>;
  variantGroups!: Table<VariantGroup, string>;
  history!: Table<DmHistoryRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('b2dm-ext');
    this.version(1).stores({
      campaigns: 'id, status, createdAt',
      // ++id = autoinc primary key. Compound index on
      // [campaignId+status] lets the scheduler grab the next pending lead
      // for a campaign with a single index range query.
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: 'id, updatedAt',
      history: 'id, campaignId, timestamp, status',
      meta: 'key',
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
