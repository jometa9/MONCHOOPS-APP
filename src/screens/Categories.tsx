import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, FolderTree, Plus, Search, Tag, Trash2, X } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { LeadCategoryPublic } from '@/types/domain';

export function Categories() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LeadCategoryPublic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
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

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy('create');
    try {
      await b2dm.categories.create(name);
      setNewName('');
      setCreating(false);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this category and all its leads?')) return;
    setBusy(id);
    try {
      await b2dm.categories.delete(id);
    } finally {
      setBusy(null);
    }
  }

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
    <div>
      {rows.length === 0 && !creating ? (
        <div>
          <EmptyState
            icon={<FolderTree className="h-10 w-10" />}
            title="No categories yet"
            description='Create one with "New category", or tag your next scrape with "New category" in Scrape leads.'
            action={
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                New category
              </button>
            }
          />
        </div>
      ) : (
        <div className="bg-background">
          <div className="sticky top-0 z-20 flex items-stretch bg-background">
            <div className="relative min-w-0 flex-1 border-r border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name…"
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {creating ? (
              <>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Category name…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void create();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                    }
                  }}
                  className="h-9 w-64 border-r border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={busy === 'create' || !newName.trim()}
                  className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy === 'create' ? <Spinner /> : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setNewName(''); }}
                  className="inline-flex h-9 w-9 items-center justify-center bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                New category
              </button>
            )}
          </div>

          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-9 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
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
                <tr className="border-t border-border last:border-b">
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    {rows.length === 0 ? 'No categories yet.' : 'No categories match your search.'}
                  </td>
                </tr>
              ) : (
                filteredRows!.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-t border-border even:bg-muted/30 last:border-b hover:bg-accent/40"
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
                          onClick={() => void remove(row.id)}
                          disabled={busy === row.id}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
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
      )}

    </div>
  );
}
