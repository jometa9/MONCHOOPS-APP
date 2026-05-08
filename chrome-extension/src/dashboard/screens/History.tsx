import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Instagram, MessageSquare, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime, formatDuration } from '@/shared/format';
import { runSync } from '@/shared/sync';
import type { Campaign, SyncedDmJob } from '@/shared/types';

interface UnifiedRow {

  source: 'campaign' | 'desktop';

  id: string;
  title: string;
  subtitle: string;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number | null;
  completedAt: number;
  accountUsername: string | null;
  accountProfilePicUrl: string | null;
}

export function History() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const campaigns = useLiveQuery(
    () => db.campaigns.orderBy('createdAt').reverse().toArray(),
    [],
    [] as Campaign[]
  );
  const dmJobs = useLiveQuery(
    async () => {
      const all = await db.dmJobs.toArray();
      return all
        .filter((j) => !j.deletedAt)
        .sort((a, b) => b.completedAt - a.completedAt);
    },
    [],
    [] as SyncedDmJob[]
  );

  const rows = useMemo<UnifiedRow[]>(() => {
    const fromCampaigns: UnifiedRow[] = (campaigns ?? [])
      .filter((c) => c.status === 'done' || c.sentCount > 0 || c.failedCount > 0)
      .map((c) => ({
        source: 'campaign',
        id: c.id,
        title: c.name,
        subtitle: t('screens.history.subtitleExtension'),
        sentCount: c.sentCount,
        failedCount: c.failedCount,
        totalCount: c.totalLeads,
        durationMs:
          c.completedAt && c.createdAt ? c.completedAt - c.createdAt : null,
        completedAt: c.completedAt ?? c.createdAt,
        accountUsername: null,
        accountProfilePicUrl: null,
      }));
    const fromDesktop: UnifiedRow[] = (dmJobs ?? []).map((j) => ({
      source: 'desktop',
      id: j.jobId,
      title: j.accountUsername ? `@${j.accountUsername}` : t('screens.history.desktopRunFallback'),
      subtitle: t('screens.history.subtitleDesktop'),
      sentCount: j.sentCount,
      failedCount: j.failedCount,
      totalCount: j.totalCount,
      durationMs: j.durationMs,
      completedAt: j.completedAt,
      accountUsername: j.accountUsername,
      accountProfilePicUrl: j.accountProfilePicUrl,
    }));
    return [...fromCampaigns, ...fromDesktop].sort(
      (a, b) => b.completedAt - a.completedAt
    );
  }, [campaigns, dmJobs, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q) ||
        (r.accountUsername ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totals = useMemo(() => {
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      sent += r.sentCount;
      failed += r.failedCount;
    }
    return { sent, failed };
  }, [rows]);

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
        title={t('screens.history.title')}
        description={t('screens.history.description', {
          count: rows.length,
          sent: totals.sent,
          failed: totals.failed,
        })}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={'h-3.5 w-3.5 ' + (refreshing ? 'animate-spin' : '')} />
            {t('common.refresh')}
          </button>
        }
      />

      <div className="border-b border-border">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.history.searchPlaceholder')}
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {rows.length === 0
            ? t('screens.history.noneYet')
            : t('common.noResults')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.history.thRun')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.history.thSource')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.history.thSent')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.history.thFailed')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.history.thDuration')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.history.thCompleted')}</th>
                <th className="px-2 py-1.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const detailPath =
                  row.source === 'desktop'
                    ? `/history/desktop/${row.id}`
                    : `/history/campaign/${row.id}`;
                return (
                  <tr
                    key={`${row.source}:${row.id}`}
                    onClick={() => navigate(detailPath)}
                    className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        {row.accountProfilePicUrl ? (
                          <img
                            src={row.accountProfilePicUrl}
                            alt={row.accountUsername ?? ''}
                            className="h-6 w-6 flex-none rounded-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
                            {row.source === 'desktop' ? (
                              <Instagram className="h-3 w-3" />
                            ) : (
                              <MessageSquare className="h-3 w-3" />
                            )}
                          </div>
                        )}
                        <span className="font-medium">{row.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {row.subtitle}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {row.sentCount}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {row.failedCount}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {row.durationMs != null ? formatDuration(row.durationMs) : '—'}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatDateTime(row.completedAt)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div
                        className="flex items-center justify-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => navigate(detailPath)}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t('screens.history.ariaViewDetail')}
                        >
                          <Eye className="h-3.5 w-3.5" />
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
    </div>
  );
}
