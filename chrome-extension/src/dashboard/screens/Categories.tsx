import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, FolderTree, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { db } from '@/shared/db';
import { uuid } from '@/shared/format';
import { enqueuePush, runSync } from '@/shared/sync';
import { CategoryChip } from '../components/CategoryChip';
import { ScreenHeader } from '../components/ScreenHeader';
import type { SyncedCategory } from '@/shared/types';

export function Categories() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SyncedCategory | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const rows = useLiveQuery(
    async () => {
      const all = await db.categories.toArray();
      return all
        .filter((c) => !c.deletedAt)
        .sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt));
    },
    [],
    [] as SyncedCategory[]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  async function refresh() {
    setRefreshing(true);
    try {
      await runSync();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="Categories"
        description="Lead categories — synced live with the desktop app."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw
                className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')}
              />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New category
            </button>
          </div>
        }
      />

      {(rows ?? []).length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <FolderTree className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No categories yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Group scraped leads under a shared name. Create one here or run a scrape on
              the desktop.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mt-4 inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New category
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              No categories match your search.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-right">Leads</th>
                    <th className="px-4 py-2 text-right">Scrapes</th>
                    <th className="px-4 py-2 text-left">Last activity</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                      onClick={() => navigate(`/categories/${row.id}`)}
                    >
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <CategoryChip name={row.name} />
                          {row.pendingPush ? (
                            <span className="text-[10px] uppercase tracking-wide text-amber-600">
                              pending sync
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {row.leadCount}
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums">
                        {row.scrapeCount}
                      </td>
                      <td className="px-4 py-1.5 text-muted-foreground">
                        {row.lastActivityAt
                          ? new Date(row.lastActivityAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/categories/${row.id}`)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="View leads"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(row)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-destructive"
                            aria-label="Delete category"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {creating ? <CreateCategoryDialog onClose={() => setCreating(false)} /> : null}
      {deleteTarget ? (
        <DeleteCategoryDialog
          category={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  );
}

function CreateCategoryDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const id = uuid();
      const now = Date.now();
      await db.categories.put({
        id,
        name: trimmed,
        createdAt: now,
        updatedAt: now,
        leadCount: 0,
        scrapeCount: 0,
        lastActivityAt: now,
        pendingPush: true,
      });
      await enqueuePush('category', 'create', id, { name: trimmed });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New category" onClose={onClose}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          Pool scraped leads under a shared name. Created here, pushed to the desktop the
          next time it's reachable.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Fitness coaches"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && !busy) void submit();
          }}
          disabled={busy}
          className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground disabled:opacity-60"
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-9 items-center px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim()}
          className="inline-flex h-9 items-center bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create category'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function DeleteCategoryDialog({
  category,
  onClose,
}: {
  category: SyncedCategory;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      // Tombstone locally so the UI hides it immediately. The push runs the
      // real DELETE on the desktop; if offline it stays queued and the
      // tombstone keeps the item out of every screen until reconciled.
      await db.categories.update(category.id, {
        deletedAt: now,
        updatedAt: now,
        pendingPush: true,
      });
      await enqueuePush('category', 'delete', category.id, {});
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Delete "${category.name}"?`} onClose={onClose}>
      <div className="space-y-2 p-4 text-xs text-muted-foreground">
        <p>
          This removes the category and every lead pooled inside it. Linked scrapes stay
          intact.
        </p>
        {error ? <p className="text-destructive">{error}</p> : null}
      </div>
      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="inline-flex h-9 items-center px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="inline-flex h-9 items-center bg-destructive px-4 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete category'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({ children }: { children: React.ReactNode }) {
  return (
    <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
      {children}
    </footer>
  );
}
