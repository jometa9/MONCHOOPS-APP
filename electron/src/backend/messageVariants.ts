import crypto from 'crypto';
import { getDb } from './db';

export const MAX_VARIANTS_PER_GROUP = 20;

export interface MessageVariantGroupPublic {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
}

interface GroupRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface VariantRow {
  group_id: string;
  content: string;
  position: number;
}

function sanitizeVariants(raw: string[]): string[] {
  const out: string[] = [];
  for (const v of raw) {
    const trimmed = typeof v === 'string' ? v.trim() : '';
    if (trimmed.length === 0) continue;
    out.push(trimmed);
    if (out.length >= MAX_VARIANTS_PER_GROUP) break;
  }
  return out;
}

function assembleGroups(rows: GroupRow[]): MessageVariantGroupPublic[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const variants = getDb()
    .prepare<string[], VariantRow>(
      `SELECT group_id, content, position
         FROM message_variants
        WHERE group_id IN (${placeholders})
        ORDER BY group_id, position ASC`
    )
    .all(...ids);

  const byGroup = new Map<string, string[]>();
  for (const v of variants) {
    const list = byGroup.get(v.group_id) ?? [];
    list.push(v.content);
    byGroup.set(v.group_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    variants: byGroup.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function listMessageVariantGroups(): MessageVariantGroupPublic[] {
  const rows = getDb()
    .prepare<[], GroupRow>(
      `SELECT id, name, created_at, updated_at
         FROM message_variant_groups
        ORDER BY created_at DESC`
    )
    .all();
  return assembleGroups(rows);
}

export function getMessageVariantGroup(id: string): MessageVariantGroupPublic | null {
  const row = getDb()
    .prepare<[string], GroupRow>(
      `SELECT id, name, created_at, updated_at FROM message_variant_groups WHERE id = ?`
    )
    .get(id);
  if (!row) return null;
  return assembleGroups([row])[0] ?? null;
}

function writeVariants(groupId: string, variants: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM message_variants WHERE group_id = ?').run(groupId);
  if (variants.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO message_variants(group_id, content, position) VALUES (?, ?, ?)`
  );
  for (let i = 0; i < variants.length; i++) {
    insert.run(groupId, variants[i], i);
  }
}

export function createMessageVariantGroup(
  name: string,
  variants: string[]
): MessageVariantGroupPublic {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Group name is required');
  const cleaned = sanitizeVariants(variants);
  if (cleaned.length === 0) throw new Error('At least one variant is required');

  const db = getDb();
  const existing = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM message_variant_groups WHERE name = ?`
    )
    .get(trimmedName);
  if (existing) throw new Error('A group with that name already exists');

  const id = crypto.randomUUID();
  const now = Date.now();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO message_variant_groups(id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(id, trimmedName, now, now);
    writeVariants(id, cleaned);
  });
  txn();

  return getMessageVariantGroup(id)!;
}

export function updateMessageVariantGroup(
  id: string,
  name: string,
  variants: string[]
): MessageVariantGroupPublic {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error('Group name is required');
  const cleaned = sanitizeVariants(variants);
  if (cleaned.length === 0) throw new Error('At least one variant is required');

  const db = getDb();
  const existing = db
    .prepare<[string, string], { id: string }>(
      `SELECT id FROM message_variant_groups WHERE name = ? AND id != ?`
    )
    .get(trimmedName, id);
  if (existing) throw new Error('A group with that name already exists');

  const now = Date.now();
  const txn = db.transaction(() => {
    const res = db
      .prepare(
        `UPDATE message_variant_groups SET name = ?, updated_at = ? WHERE id = ?`
      )
      .run(trimmedName, now, id);
    if (res.changes === 0) throw new Error('Group not found');
    writeVariants(id, cleaned);
  });
  txn();

  return getMessageVariantGroup(id)!;
}

export function deleteMessageVariantGroup(id: string): void {
  // Variants cascade via FK.
  getDb().prepare('DELETE FROM message_variant_groups WHERE id = ?').run(id);
}
