// IndexedDB-backed persistence. Mirrors the SQLite schema of the desktop
// app but only for the slice the extension owns: campaigns, leads, DM
// history, and a small key/value meta store. Variant groups live on the
// desktop app — the extension reads/writes them through the bridge.
//
// Service worker, popup, and dashboard all open the same Dexie instance —
// IndexedDB serializes writes per-store across contexts, so concurrent
// access from multiple extension pages is safe without explicit locking.

import Dexie, { type Table } from 'dexie';
import type { Campaign, DmHistoryRow, Lead, MetaRow } from './types';

class B2dmExtDb extends Dexie {
  campaigns!: Table<Campaign, string>;
  leads!: Table<Lead, number>;
  history!: Table<DmHistoryRow, string>;
  meta!: Table<MetaRow, string>;

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
    // local table so we stop double-bookkeeping. Existing rows are silently
    // discarded — users still on a stale install lose only the local copy
    // they were never using, since the desktop is now the source of truth.
    this.version(2).stores({
      campaigns: 'id, status, createdAt',
      leads: '++id, campaignId, status, [campaignId+status], username',
      variantGroups: null,
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
