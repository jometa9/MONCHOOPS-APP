import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquareText, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { MessageVariantGroupPublic } from '@/types/domain';

const MAX_VARIANTS = 20;

export function MessageVariants() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MessageVariantGroupPublic[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MessageVariantGroupPublic | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MessageVariantGroupPublic | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await b2dm.messageVariants.list();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = b2dm.messageVariants.onChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

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
          icon={<MessageSquareText className="h-10 w-10" />}
          title={t('screens.messageVariants.noGroupsTitle')}
          description={t('screens.messageVariants.noGroupsDescription')}
          action={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.messageVariants.newGroup')}
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
                placeholder={t('screens.messageVariants.searchPlaceholder')}
                className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.messageVariants.newGroup')}
            </button>
          </div>

          {filteredRows!.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
              <EmptyState
                icon={<Search className="h-10 w-10" />}
                title={t('common.noResults')}
                description={t('screens.messageVariants.noMatchDescription')}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left">{t('screens.messageVariants.tableName')}</th>
                    <th className="px-3 py-1.5 text-right">{t('screens.messageVariants.tableVariants')}</th>
                    <th className="px-3 py-1.5 text-left">{t('screens.messageVariants.tableLastUpdated')}</th>
                    <th className="px-3 py-1.5 text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows!.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-t border-border bg-background even:bg-muted last:border-b hover:bg-accent"
                      onClick={() => setEditing(row)}
                    >
                      <td className="px-3 py-1.5 font-medium">{row.name}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {row.variants.length}
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {formatDateTime(row.updatedAt)}
                      </td>
                      <td className="px-2 py-1.5">
                        <div
                          className="flex items-center justify-end gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t('screens.messageVariants.editGroup')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(row)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t('screens.messageVariants.deleteGroup')}
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

      {creating ? <EditGroupDialog onClose={() => setCreating(false)} /> : null}
      {editing ? (
        <EditGroupDialog group={editing} onClose={() => setEditing(null)} />
      ) : null}
      {deleteTarget ? (
        <ConfirmDeleteGroupDialog
          group={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </>
  );
}

function EditGroupDialog({
  group,
  onClose,
}: {
  group?: MessageVariantGroupPublic;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = !!group;
  const [name, setName] = useState(group?.name ?? '');
  const [variants, setVariants] = useState<string[]>(
    group && group.variants.length > 0 ? group.variants : ['']
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nonEmpty = variants.filter((v) => v.trim().length > 0).length;
  const canSubmit = name.trim().length > 0 && nonEmpty > 0 && !busy;

  function updateVariant(i: number, value: string) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }
  function addVariant() {
    setVariants((prev) => (prev.length >= MAX_VARIANTS ? prev : [...prev, '']));
  }
  function removeVariant(i: number) {
    setVariants((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit && group) {
        await b2dm.messageVariants.update({
          id: group.id,
          name: name.trim(),
          variants,
        });
      } else {
        await b2dm.messageVariants.create({ name: name.trim(), variants });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.messageVariants.couldNotSave'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={
        isEdit
          ? t('screens.messageVariants.editDialogTitle', { name: group!.name })
          : t('screens.messageVariants.newDialogTitle')
      }
      description={t('screens.messageVariants.dialogDescription')}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? <Spinner /> : null}
            {busy
              ? isEdit
                ? t('screens.messageVariants.saving')
                : t('screens.messageVariants.creating')
              : isEdit
              ? t('screens.messageVariants.saveChanges')
              : t('screens.messageVariants.createGroup')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="mvg-name">{t('screens.messageVariants.nameLabel')}</Label>
          <Input
            id="mvg-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('screens.messageVariants.namePlaceholder')}
            disabled={busy}
          />
        </div>

        <div className="flex flex-col border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>{t('screens.messageVariants.variants')}</span>
            <span className="normal-case font-normal">
              {t('screens.messageVariants.variantsCount', { n: nonEmpty, max: MAX_VARIANTS })}
              <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                {'{{username}}'}
              </code>
            </span>
          </div>
          <div className="max-h-[40vh] space-y-2 overflow-auto p-3">
            {variants.map((value, i) => (
              <div key={i} className="flex items-start gap-2">
                <Textarea
                  rows={3}
                  placeholder={
                    i === 0
                      ? t('screens.messageVariants.variantPlaceholderFirst')
                      : t('screens.messageVariants.variantPlaceholderNth', { n: i + 1 })
                  }
                  value={value}
                  onChange={(e) => updateVariant(i, e.target.value)}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => removeVariant(i)}
                  disabled={variants.length <= 1 || busy}
                  aria-label={t('screens.messageVariants.removeVariant', { n: i + 1 })}
                  className="inline-flex h-9 w-9 flex-none items-center justify-center bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40 disabled:hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={addVariant}
              disabled={variants.length >= MAX_VARIANTS || busy}
              className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.messageVariants.addVariant')}
            </button>
          </div>
        </div>

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  );
}

function ConfirmDeleteGroupDialog({
  group,
  onClose,
}: {
  group: MessageVariantGroupPublic;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await b2dm.messageVariants.delete(group.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.messageVariants.couldNotDelete'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t('screens.messageVariants.deleteDialogTitle', { name: group.name })}
      description={t('screens.messageVariants.deleteDialogDescription')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm} disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? t('screens.messageVariants.deleting') : t('screens.messageVariants.deleteButton')}
          </Button>
        </>
      }
    >
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </Dialog>
  );
}
