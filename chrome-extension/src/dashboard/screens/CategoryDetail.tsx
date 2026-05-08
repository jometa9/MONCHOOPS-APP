import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ExternalLink,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '@/shared/db';
import { parseUsernamesText } from '@/shared/csv';
import { formatDateTime } from '@/shared/format';
import { enqueuePush, pullCategoryLeads, runSync } from '@/shared/sync';
import { ScreenHeader } from '../components/ScreenHeader';
import type { SyncedCategoryLead } from '@/shared/types';

export function CategoryDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const category = useLiveQuery(() => db.categories.get(id), [id]);
  const leads = useLiveQuery(
    async () => {
      const all = await db.categoryLeads.where('categoryId').equals(id).toArray();
      return all
        .filter((l) => !l.deletedAt)
        .sort((a, b) => b.scrapedAt - a.scrapedAt);
    },
    [id],
    [] as SyncedCategoryLead[]
  );

  useEffect(() => {
    if (!id) return;
    void pullCategoryLeads(id).catch(() => {

    });
  }, [id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return leads ?? [];
    return (leads ?? []).filter((l) => l.username.toLowerCase().includes(q));
  }, [leads, query]);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([runSync(), pullCategoryLeads(id)]);
    } finally {
      setRefreshing(false);
    }
  }

  function openProfile(username: string) {
    window.open(`https://www.instagram.com/${encodeURIComponent(username)}/`, '_blank');
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScreenHeader
        title={category?.name ?? t('screens.categoryDetail.fallbackTitle')}
        description={
          category
            ? t('screens.categoryDetail.summaryPlural', {
                count: category.leadCount,
                leadCount: category.leadCount,
                scrapeCount: category.scrapeCount,
              })
            : ' '
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/categories')}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('screens.categoryDetail.back')}
            </button>
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
              onClick={() => setAddOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('screens.categoryDetail.addLeads')}
            </button>
          </div>
        }
      />

      <div className="border-b border-border">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.categoryDetail.searchPlaceholder')}
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {(leads ?? []).length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Users className="h-10 w-10" />
              <p className="text-sm font-medium">{t('screens.categoryDetail.noLeadsTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t('screens.categoryDetail.noLeadsHint')}
              </p>
            </div>
          ) : (
            t('common.noResults')
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.categoryDetail.thUsername')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.categoryDetail.thSource')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.categoryDetail.thAdded')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.categoryDetail.thProfile')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lead) => (
                <tr
                  key={lead.id ?? lead.username}
                  onClick={() => openProfile(lead.username)}
                  className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5 font-medium">@{lead.username}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    <LeadSourceCell sourceDetail={lead.sourceDetail} sourceKind={lead.sourceKind} />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {formatDateTime(lead.scrapedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openProfile(lead.username);
                        }}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('screens.categoryDetail.openProfileAria', { username: lead.username })}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(leads ?? []).length >= 1000 ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          {t('screens.categoryDetail.showingFirst')}
        </div>
      ) : null}

      {addOpen ? (
        <AddLeadsDialog
          categoryId={id}
          existing={new Set((leads ?? []).map((l) => l.username.toLowerCase()))}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AddLeadsDialog({
  categoryId,
  existing,
  onClose,
}: {
  categoryId: string;
  existing: Set<string>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseUsernamesText(text), [text]);
  const fresh = useMemo(
    () => parsed.filter((p) => !existing.has(p.username.toLowerCase())),
    [parsed, existing]
  );

  async function submit() {
    if (fresh.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();

      await db.transaction('rw', db.categoryLeads, async () => {
        for (const p of fresh) {
          await db.categoryLeads.put({
            categoryId,
            username: p.username,
            sourceKind: 'manual',
            sourceJobId: null,
            sourceDetail: 'extension | manual',
            scrapedAt: now,
            updatedAt: now,
            pendingPush: true,
          });
        }
      });

      const cat = await db.categories.get(categoryId);
      if (cat) {
        await db.categories.update(categoryId, {
          leadCount: cat.leadCount + fresh.length,
          lastActivityAt: now,
          updatedAt: now,
        });
      }
      await enqueuePush('categoryLead', 'create', categoryId, {
        usernames: fresh.map((f) => f.username),
        sourceDetail: 'extension | manual',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.categoryDetail.couldNotAdd'));
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
          <h2 className="text-sm font-semibold">{t('screens.categoryDetail.addDialogTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('screens.categoryDetail.addDialogHint')}
          </p>
        </header>

        <div className="space-y-3 p-4">
          <textarea
            rows={6}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('screens.categoryDetail.addingPlaceholder')}
            className="w-full resize-y border border-border bg-background p-2 text-sm outline-none focus:border-foreground"
          />
          <p className="text-[11px] text-muted-foreground">
            {parsed.length === 0
              ? t('screens.categoryDetail.noUsernamesParsed')
              : t('screens.categoryDetail.parsedSummary', {
                  parsed: parsed.length,
                  fresh: fresh.length,
                })}
          </p>
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
            onClick={submit}
            disabled={busy || fresh.length === 0}
            className="inline-flex h-9 items-center bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy
              ? t('screens.categoryDetail.adding')
              : t('screens.categoryDetail.addLeadsCta', { count: fresh.length || 0 })}
          </button>
        </footer>
      </div>
    </div>
  );
}

function LeadSourceCell({
  sourceDetail,
  sourceKind,
}: {
  sourceDetail: string | null;
  sourceKind: string;
}) {
  const { t } = useTranslation();
  const parts = (sourceDetail ?? '')
    .split(' | ')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return <span>{sourceKind}</span>;

  const kind = parts[0] ?? sourceKind;
  const [kindLabel, linkWord] = labelsFor(kind, t);
  const ref = parts.slice(1).find(Boolean) ?? null;
  const refUrl = refToUrl(ref);

  return (
    <span className="inline-flex items-center gap-1">
      <span>{kindLabel}</span>
      {refUrl ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.open(refUrl, '_blank');
          }}
          className="font-medium text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
        >
          {linkWord}
        </button>
      ) : null}
    </span>
  );
}

function labelsFor(kind: string, t: (key: string) => string): [string, string] {
  switch (kind) {
    case 'post_comment':
      return [t('screens.categoryDetail.sourceCommentedOn'), t('screens.categoryDetail.refPost')];
    case 'post_like':
      return [t('screens.categoryDetail.sourceLiked'), t('screens.categoryDetail.refPost')];
    case 'reel_comment':
      return [t('screens.categoryDetail.sourceCommentedOn'), t('screens.categoryDetail.refReel')];
    case 'reel_like':
      return [t('screens.categoryDetail.sourceLiked'), t('screens.categoryDetail.refReel')];
    case 'followers':
      return [t('screens.categoryDetail.sourceFollows'), t('screens.categoryDetail.refProfile')];
    default:
      return [kind.replace(/_/g, ' '), t('screens.categoryDetail.refLink')];
  }
}

function refToUrl(ref: string | null): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('@')) {
    return `https://www.instagram.com/${encodeURIComponent(trimmed.slice(1))}/`;
  }
  if (trimmed.startsWith('#')) {
    return `https://www.instagram.com/explore/tags/${encodeURIComponent(trimmed.slice(1))}/`;
  }
  const hashtagTag = trimmed.match(/^hashtag:#?(.+)/);
  if (hashtagTag) {
    return `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtagTag[1]!)}/`;
  }
  const locationTag = trimmed.match(/^location:(.+)/);
  if (locationTag) {
    const raw = locationTag[1]!;
    return /^https?:\/\//i.test(raw)
      ? raw
      : `https://www.instagram.com/explore/locations/${raw}/`;
  }
  return null;
}
