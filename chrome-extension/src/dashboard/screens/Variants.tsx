import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '../components/ScreenHeader';
import { db } from '@/shared/db';
import { uuid } from '@/shared/format';
import { formatDateTime } from '@/shared/format';
import { enqueuePush, runSync } from '@/shared/sync';
import type { SyncedVariantGroup } from '@/shared/types';

const MAX_VARIANTS = 20;

export function Variants() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<SyncedVariantGroup | 'new' | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const groups = useLiveQuery(
    async () => {
      const all = await db.variantGroups.toArray();
      return all
        .filter((g) => !g.deletedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [],
    [] as SyncedVariantGroup[]
  );

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
        title={t('screens.variants.title')}
        description={t('screens.variants.description')}
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
              {t('common.refresh')}
            </button>
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.variants.newGroup')}
            </button>
          </div>
        }
      />

      {(groups ?? []).length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium">{t('screens.variants.noneYet')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('screens.variants.noneHint')}
            </p>
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="mt-4 inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.variants.newGroup')}
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">{t('screens.variants.thName')}</th>
                <th className="px-4 py-2 text-right">{t('screens.variants.thVariants')}</th>
                <th className="px-4 py-2 text-left">{t('screens.variants.thUpdated')}</th>
                <th className="px-2 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {(groups ?? []).map((g) => (
                <tr
                  key={g.id}
                  className="cursor-pointer border-b border-border transition-colors hover:bg-accent/40"
                  onClick={() => setEditing(g)}
                >
                  <td className="px-4 py-2 font-medium">
                    {g.name}
                    {g.pendingPush ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">
                        {t('screens.variants.pendingSync')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{g.variants.length}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {formatDateTime(g.updatedAt)}
                  </td>
                  <td className="px-2 py-2">
                    <div
                      className="flex items-center justify-end gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setEditing(g)}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={t('screens.variants.ariaEdit')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm(t('screens.variants.deleteConfirm', { name: g.name }))) return;
                          const now = Date.now();
                          await db.variantGroups.update(g.id, {
                            deletedAt: now,
                            updatedAt: now,
                            pendingPush: true,
                          });
                          await enqueuePush('variants', 'delete', g.id, {});
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-destructive"
                        aria-label={t('screens.variants.ariaDelete')}
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

      {editing ? (
        <EditDialog
          group={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function EditDialog({
  group,
  onClose,
}: {
  group: SyncedVariantGroup | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(group?.name ?? '');
  const [variants, setVariants] = useState<string[]>(
    group && group.variants.length > 0 ? group.variants : ['']
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = useMemo(() => variants.map((v) => v.trim()).filter(Boolean), [variants]);

  async function save() {
    if (!name.trim() || cleaned.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      if (group) {
        await db.variantGroups.update(group.id, {
          name: name.trim(),
          variants: cleaned,
          updatedAt: now,
          pendingPush: true,
        });
        await enqueuePush('variants', 'update', group.id, {
          name: name.trim(),
          variants: cleaned,
        });
      } else {
        const id = uuid();
        await db.variantGroups.put({
          id,
          name: name.trim(),
          variants: cleaned,
          createdAt: now,
          updatedAt: now,
          pendingPush: true,
        });
        await enqueuePush('variants', 'create', id, {
          name: name.trim(),
          variants: cleaned,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.variants.couldNotSave'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            {group
              ? t('screens.variants.editDialogTitle', { name: group.name })
              : t('screens.variants.newDialogTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('screens.variants.dialogHint')}
          </p>
        </header>

        <div className="space-y-3 p-4">
          <div className="space-y-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('screens.variants.fieldName')}
            </label>
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder={t('screens.variants.namePlaceholder')}
              className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </div>

          <div className="border border-border">
            <header className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>{t('screens.variants.variantsHeader')}</span>
              <span className="font-normal normal-case">
                {t('screens.variants.variantsCount', {
                  count: cleaned.length,
                  max: MAX_VARIANTS,
                })}
                <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                  {'{{username}}'}
                </code>
              </span>
            </header>
            <div className="max-h-[40vh] space-y-2 overflow-auto p-3">
              {variants.map((v, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea
                    rows={3}
                    value={v}
                    onChange={(e) =>
                      setVariants((prev) =>
                        prev.map((x, idx) => (idx === i ? e.target.value : x))
                      )
                    }
                    placeholder={
                      i === 0
                        ? t('screens.variants.variantPlaceholderFirst')
                        : t('screens.variants.variantPlaceholder', { index: i + 1 })
                    }
                    className="w-full resize-y border border-border bg-background p-2 text-sm outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setVariants((prev) =>
                        prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)
                      )
                    }
                    disabled={variants.length <= 1}
                    aria-label={t('screens.variants.removeVariantAria', { index: i + 1 })}
                    className="inline-flex h-9 w-9 flex-none items-center justify-center bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="border-t border-border p-2">
              <button
                type="button"
                onClick={() =>
                  setVariants((prev) =>
                    prev.length >= MAX_VARIANTS ? prev : [...prev, '']
                  )
                }
                disabled={variants.length >= MAX_VARIANTS}
                className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('screens.variants.addVariant')}
              </button>
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || !name.trim() || cleaned.length === 0}
            className="inline-flex h-9 items-center bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy
              ? t('screens.variants.saving')
              : group
              ? t('screens.variants.saveChanges')
              : t('screens.variants.createGroup')}
          </button>
        </footer>
      </div>
    </div>
  );
}
