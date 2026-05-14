import crypto from 'crypto';
import fs from 'fs';
import { getDb } from './db';

export interface LeadCategoryPublic {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  leadCount: number;
  scrapeCount: number;
  lastActivityAt: number | null;
}

export interface LeadPublic {
  id: number;
  categoryId: string;
  username: string;
  sourceKind: string;
  sourceJobId: string | null;
  sourceDetail: string | null;
  scrapedAt: number;
}

interface CategoryRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface CategoryWithStatsRow extends CategoryRow {
  lead_count: number;
  scrape_count: number;
  last_activity_at: number | null;
}

interface LeadRow {
  id: number;
  category_id: string;
  username: string;
  source_kind: string;
  source_job_id: string | null;
  source_detail: string | null;
  scraped_at: number;
}

function categoryRowToPublic(row: CategoryWithStatsRow): LeadCategoryPublic {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    leadCount: Number(row.lead_count) || 0,
    scrapeCount: Number(row.scrape_count) || 0,
    lastActivityAt: row.last_activity_at,
  };
}

function leadRowToPublic(row: LeadRow): LeadPublic {
  return {
    id: row.id,
    categoryId: row.category_id,
    username: row.username,
    sourceKind: row.source_kind,
    sourceJobId: row.source_job_id,
    sourceDetail: row.source_detail,
    scrapedAt: row.scraped_at,
  };
}

export function listCategories(): LeadCategoryPublic[] {
  const rows = getDb()
    .prepare<[], CategoryWithStatsRow>(
      `SELECT
         c.id, c.name, c.created_at, c.updated_at,
         COALESCE(l.lead_count, 0) AS lead_count,
         COALESCE(s.scrape_count, 0) AS scrape_count,
         MAX(COALESCE(l.last_scraped_at, 0), COALESCE(s.last_added_at, 0), c.created_at) AS last_activity_at
       FROM lead_categories c
       LEFT JOIN (
         SELECT category_id, COUNT(*) AS lead_count, MAX(scraped_at) AS last_scraped_at
         FROM leads GROUP BY category_id
       ) l ON l.category_id = c.id
       LEFT JOIN (
         SELECT category_id, COUNT(*) AS scrape_count, MAX(added_at) AS last_added_at
         FROM category_scrapes GROUP BY category_id
       ) s ON s.category_id = c.id
       ORDER BY c.created_at DESC`
    )
    .all();
  return rows.map(categoryRowToPublic);
}

export function getCategory(id: string): LeadCategoryPublic | null {
  const rows = listCategories();
  return rows.find((c) => c.id === id) ?? null;
}

export function createCategory(name: string): LeadCategoryPublic {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name is required');
  const existing = getDb()
    .prepare<[string], CategoryRow>('SELECT * FROM lead_categories WHERE name = ?')
    .get(trimmed);
  if (existing) return getCategory(existing.id)!;

  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO lead_categories(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
    .run(id, trimmed, now, now);
  return getCategory(id)!;
}

export function renameCategory(id: string, name: string): LeadCategoryPublic {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name is required');
  getDb()
    .prepare(`UPDATE lead_categories SET name = ?, updated_at = ? WHERE id = ?`)
    .run(trimmed, Date.now(), id);
  const cat = getCategory(id);
  if (!cat) throw new Error('Category not found');
  return cat;
}

export function deleteCategory(id: string): void {

  getDb().prepare('DELETE FROM lead_categories WHERE id = ?').run(id);
}

export function resolveCategoryRef(ref: {
  categoryId?: string | null;
  newCategoryName?: string | null;
}): LeadCategoryPublic | null {
  if (ref.categoryId) {
    const cat = getCategory(ref.categoryId);
    if (!cat) throw new Error('Category not found');
    return cat;
  }
  if (ref.newCategoryName && ref.newCategoryName.trim().length > 0) {
    return createCategory(ref.newCategoryName);
  }
  return null;
}

export interface IngestLeadInput {
  username: string;
  sourceDetail?: string | null;
}

export function sanitizeUsername(raw: string): string {
  return raw.trim().replace(/^[@#]+/, '').trim();
}

export function ingestLeads(
  categoryId: string,
  sourceKind: string,
  sourceJobId: string | null,
  items: IngestLeadInput[]
): number {
  const cleaned = items
    .map((r) => ({ ...r, username: sanitizeUsername(r.username) }))
    .filter((r) => r.username.length > 0);
  if (cleaned.length === 0) return 0;
  const db = getDb();
  const now = Date.now();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO leads(category_id, username, source_kind, source_job_id, source_detail, scraped_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const txn = db.transaction((rows: IngestLeadInput[]) => {
    let added = 0;
    for (const row of rows) {
      const res = insert.run(
        categoryId,
        row.username,
        sourceKind,
        sourceJobId,
        row.sourceDetail ?? null,
        now
      );
      if (res.changes > 0) added += 1;
    }
    return added;
  });

  const added = txn(cleaned);

  if (sourceJobId) {
    db.prepare(
      `INSERT INTO category_scrapes(category_id, job_id, added_count, added_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(category_id, job_id) DO UPDATE SET
         added_count = excluded.added_count,
         added_at = excluded.added_at`
    ).run(categoryId, sourceJobId, added, now);
  }

  db.prepare(`UPDATE lead_categories SET updated_at = ? WHERE id = ?`).run(now, categoryId);

  return added;
}

export function ingestLeadsFromCsv(
  categoryId: string,
  sourceKind: string,
  sourceJobId: string | null,
  csvPath: string
): number {
  if (!fs.existsSync(csvPath)) return 0;
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const items: IngestLeadInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const parts = parseCsvLine(line);
    const username = parts[0]?.trim();
    if (!username) continue;
    const source = parts[1] ?? '';
    const sourceRef = parts[2] ?? '';
    items.push({
      username,
      sourceDetail: [source, sourceRef].filter(Boolean).join(' | ') || null,
    });
  }
  return ingestLeads(categoryId, sourceKind, sourceJobId, items);
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

export interface ListLeadsOpts {
  categoryId: string;
  limit?: number;
  offset?: number;
}

export function listUsernamesInCategory(categoryId: string): string[] {
  const rows = getDb()
    .prepare<[string], { username: string }>(
      'SELECT username FROM leads WHERE category_id = ?'
    )
    .all(categoryId);
  return rows.map((r) => r.username);
}

export function listLeads(opts: ListLeadsOpts): LeadPublic[] {
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
  const offset = Math.max(opts.offset ?? 0, 0);
  const rows = getDb()
    .prepare<[string, number, number], LeadRow>(
      `SELECT * FROM leads WHERE category_id = ? ORDER BY scraped_at DESC LIMIT ? OFFSET ?`
    )
    .all(opts.categoryId, limit, offset);
  return rows.map(leadRowToPublic);
}

export function exportCategoryCsv(categoryId: string): string {
  const rows = getDb()
    .prepare<[string], LeadRow>(
      `SELECT * FROM leads WHERE category_id = ? ORDER BY scraped_at DESC`
    )
    .all(categoryId);
  const escape = (s: string | null) => {
    if (s == null) return '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = 'username,source_kind,source_detail,scraped_at\n';
  const body = rows
    .map((r) =>
      [
        escape(r.username),
        escape(r.source_kind),
        escape(r.source_detail),
        new Date(r.scraped_at).toISOString(),
      ].join(',')
    )
    .join('\n');
  return header + body + (body ? '\n' : '');
}
