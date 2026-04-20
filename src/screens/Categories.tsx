import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, FolderTree, Plus, Search, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { LeadCategoryPublic } from '@/types/domain';

export function Categories() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LeadCategoryPublic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LeadCategoryPublic | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q));
  }, [rows, query]);

  async function load() {
    const list = await b2dm.categories.list();
    setRows(list);
  }

  useEffect(() => {
    void load();
    const offCats = b2dm.categories.onChange(() => void load());
    const offDone = b2dm.jobs.onDone(() => void load());
    return () => {
      offCats();
      offDone();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportCsv(id: string) {
    setBusy(id);
    try {
      await b2dm.categories.exportCsv(id);
    } finally {
      setBusy(null);
    }
  }

  if (rows === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {rows.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-10 w-10" />}
          title="No categories yet"
          description="Group scrapes under a shared category to pool leads and dedupe across runs."
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New category
            </button>
          }
        />
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-stretch">
            <div className="relative min-w-0 flex-1 border-r border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New category
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-right">Leads</th>
                <th className="px-3 py-1.5 text-right">Scrapes</th>
                <th className="px-3 py-1.5 text-left">Last activity</th>
                <th className="px-3 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows!.length === 0 ? (
                <tr className="border-t border-border bg-background last:border-b">
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No categories match your search.
                  </td>
                </tr>
              ) : (
                filteredRows!.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent"
                    onClick={() => navigate(`/categories/${row.id}`)}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{row.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.leadCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.scrapeCount}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{formatDateTime(row.lastActivityAt)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => navigate(`/categories/${row.id}`)}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          title="View leads"
                          aria-label="View leads"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportCsv(row.id)}
                          disabled={busy === row.id || row.leadCount === 0}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                          title="Download CSV"
                          aria-label="Download CSV"
                        >
                          {busy === row.id ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(row)}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          title="Delete category"
                          aria-label="Delete category"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {creating ? (
        <CreateCategoryDialog onClose={() => setCreating(false)} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteCategoryDialog
          category={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
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
      await b2dm.categories.create(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="New category"
      description="Pool scraped leads under a shared name. Scrapes tagged with this category feed into the same deduplicated list."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : null}
            {busy ? 'Creating…' : 'Create category'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fitness coaches"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && !busy) void submit();
            }}
            disabled={busy}
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function ConfirmDeleteCategoryDialog({
  category,
  onClose,
}: {
  category: LeadCategoryPublic;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await b2dm.categories.delete(category.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete category');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete ${category.name}?`}
      description="This removes the category and every lead pooled inside it. Linked scrapes stay intact."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Deleting…' : 'Delete category'}
          </Button>
        </>
      }
    >
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}
