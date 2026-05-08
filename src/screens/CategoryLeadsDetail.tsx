import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, Search, Users } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { monchoops } from '@/lib/monchoops';
import { formatDateTime } from '@/lib/format';
import type { LeadCategoryPublic, LeadPublic } from '@/types/domain';

export function CategoryLeadsDetail() {
  const { t } = useTranslation();
  const { categoryId = '' } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const [category, setCategory] = useState<LeadCategoryPublic | null>(null);
  const [leads, setLeads] = useState<LeadPublic[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [list, cats] = await Promise.all([
        monchoops.categories.listLeads({ categoryId, limit: 1000 }),
        monchoops.categories.list(),
      ]);
      if (cancelled) return;
      setLeads(list);
      setCategory(cats.find((c) => c.id === categoryId) ?? null);
    }
    void load();
    return () => { cancelled = true; };
  }, [categoryId]);

  const filteredLeads = useMemo(() => {
    if (!leads) return null;
    const q = query.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((lead) => lead.username.toLowerCase().includes(q));
  }, [leads, query]);

  function goBack() {
    navigate('/categories');
  }

  if (leads === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-stretch border-b border-border bg-background">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('screens.categoryLeadsDetail.backAria')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('screens.categoryLeadsDetail.back')}
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.categoryLeadsDetail.searchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {category ? (
          <div className="flex items-center gap-2 border-l border-border px-3 text-xs text-muted-foreground">
            <span className="truncate">{category.name}</span>
            <span className="tabular-nums">- {leads.length}</span>
          </div>
        ) : null}
      </div>

      {filteredLeads!.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={leads.length === 0 ? <Users className="h-10 w-10" /> : <Search className="h-10 w-10" />}
            title={t('screens.categoryLeadsDetail.noResultsTitle')}
            description={
              leads.length === 0
                ? t('screens.categoryLeadsDetail.noResultsEmpty')
                : t('screens.categoryLeadsDetail.noResultsFiltered')
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">{t('screens.categoryLeadsDetail.tableUsername')}</th>
              <th className="px-3 py-1.5 text-left">{t('screens.categoryLeadsDetail.tableSource')}</th>
              <th className="px-3 py-1.5 text-left">{t('screens.categoryLeadsDetail.tableAdded')}</th>
              <th className="px-3 py-1.5 text-right">{t('screens.categoryLeadsDetail.tableProfile')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads!.map((lead) => {
              const openProfile = () =>
                void monchoops.openExternalLink(
                  `https://www.instagram.com/${encodeURIComponent(lead.username)}/`
                );
              return (
                <tr
                  key={lead.id}
                  onClick={openProfile}
                  className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5 font-medium">@{lead.username}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    <LeadSourceCell
                      sourceDetail={lead.sourceDetail}
                      sourceKind={lead.sourceKind}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {formatDateTime(lead.scrapedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openProfile(); }}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('screens.categoryLeadsDetail.openProfile', { username: lead.username })}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}

      {leads.length >= 1000 ? (
        <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          {t('screens.categoryLeadsDetail.showingFirst')}
        </div>
      ) : null}
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
  const parts = (sourceDetail ?? '').split(' | ').map((s) => s.trim()).filter(Boolean);
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
            void monchoops.openExternalLink(refUrl);
          }}
          className="font-medium text-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-primary"
        >
          {linkWord}
        </button>
      ) : null}
    </span>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function labelsFor(kind: string, t: TFn): [string, string] {
  switch (kind) {
    case 'post_comment': return [t('screens.categoryLeadsDetail.sourcePostComment'), t('screens.categoryLeadsDetail.sourcePostLabel')];
    case 'post_like': return [t('screens.categoryLeadsDetail.sourcePostLike'), t('screens.categoryLeadsDetail.sourcePostLabel')];
    case 'reel_comment': return [t('screens.categoryLeadsDetail.sourceReelComment'), t('screens.categoryLeadsDetail.sourceReelLabel')];
    case 'reel_like': return [t('screens.categoryLeadsDetail.sourceReelLike'), t('screens.categoryLeadsDetail.sourceReelLabel')];
    case 'followers': return [t('screens.categoryLeadsDetail.sourceFollowers'), t('screens.categoryLeadsDetail.sourceProfileLabel')];
    default: return [kind.replace(/_/g, ' '), t('screens.categoryLeadsDetail.sourceLink')];
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
  if (hashtagTag) return `https://www.instagram.com/explore/tags/${encodeURIComponent(hashtagTag[1])}/`;
  const locationTag = trimmed.match(/^location:(.+)/);
  if (locationTag) {
    const raw = locationTag[1];
    return /^https?:\/\//i.test(raw) ? raw : `https://www.instagram.com/explore/locations/${raw}/`;
  }
  return null;
}
