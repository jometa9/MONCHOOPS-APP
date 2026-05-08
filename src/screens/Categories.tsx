import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, Eye, FolderTree, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CategoryChip } from '@/components/common/CategoryChip';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { monchoops } from '@/lib/monchoops';
import { formatDateTime } from '@/lib/format';
import type { LeadCategoryPublic } from '@/types/domain';

export function Categories() {
  const { t } = useTranslation();
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
    const list = await monchoops.categories.list();
    setRows(list);
  }

  useEffect(() => {
    void load();
    const offCats = monchoops.categories.onChange(() => void load());
    const offDone = monchoops.jobs.onDone(() => void load());
    return () => {
      offCats();
      offDone();
    };

  }, []);

  async function exportCsv(id: string) {
    setBusy(id);
    try {
      await monchoops.categories.exportCsv(id);
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
          title={t('screens.categories.noCategoriesTitle')}
          description={t('screens.categories.noCategoriesDescription')}
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.categories.newCategory')}
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
                placeholder={t('screens.categories.searchPlaceholder')}
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.categories.newCategory')}
            </button>
          </div>

          {filteredRows!.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
              <EmptyState
                icon={<Search className="h-10 w-10" />}
                title={t('common.noResults')}
                description={t('screens.categories.noMatchDescription')}
              />
            </div>
          ) : (
          <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.categories.tableName')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.categories.tableLeads')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.categories.tableScrapes')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.categories.tableLastActivity')}</th>
                <th className="px-3 py-1.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows!.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent"
                  onClick={() => navigate(`/categories/${row.id}`)}
                >
                  <td className="px-3 py-1.5">
                    <CategoryChip name={row.name} />
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
                        aria-label={t('screens.categories.viewLeads')}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportCsv(row.id)}
                        disabled={busy === row.id || row.leadCount === 0}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                        aria-label={t('screens.categories.downloadCsv')}
                      >
                        {busy === row.id ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('screens.categories.deleteCategory')}
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
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await monchoops.categories.create(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.categories.couldNotCreate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('screens.categories.createDialogTitle')}
      description={t('screens.categories.createDialogDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim()}>
            {busy ? <Spinner /> : null}
            {busy ? t('screens.categories.creating') : t('screens.categories.createButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cat-name">{t('screens.categories.nameLabel')}</Label>
          <Input
            id="cat-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('screens.categories.namePlaceholder')}
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
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await monchoops.categories.delete(category.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.categories.couldNotDelete'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('screens.categories.deleteDialogTitle', { name: category.name })}
      description={t('screens.categories.deleteDialogDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? t('screens.categories.deleting') : t('screens.categories.deleteButton')}
          </Button>
        </>
      }
    >
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}
