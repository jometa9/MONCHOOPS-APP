import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListTodo, Loader2, MessageSquare, Pause, Play, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { cancelDesktopJob } from '@/shared/desktop-bridge';
import { runSync } from '@/shared/sync';
import type { Campaign, SyncedActiveJob } from '@/shared/types';

interface QueueRow {
  source: 'campaign' | 'desktop';
  id: string;
  status: 'queued' | 'running' | 'paused';
  title: string;
  subtitle: string;
  progressDone: number;
  progressTotal: number | null;
  startedAt: number;
}

function formatJobKind(kind: string, t: TFunction): string {
  if (kind === 'login') return t('screens.queue.jobLogin');
  if (kind === 'mass_dm') return t('screens.queue.jobMassDm');
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function Queue() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [cancelError, setCancelError] = useState<string | null>(null);

  const campaigns = useLiveQuery(
    () =>
      db.campaigns
        .where('status')
        .anyOf('running', 'paused')
        .toArray(),
    [],
    [] as Campaign[]
  );

  const desktopJobs = useLiveQuery(
    () => db.activeJobs.toArray(),
    [],
    [] as SyncedActiveJob[]
  );

  const rows = useMemo<QueueRow[]>(() => {
    const fromCampaigns: QueueRow[] = (campaigns ?? []).map((c) => ({
      source: 'campaign',
      id: c.id,
      status: c.status === 'paused' ? 'paused' : 'running',
      title: c.name,
      subtitle: t('screens.queue.subtitleExtension'),
      progressDone: c.sentCount + c.failedCount,
      progressTotal: c.totalLeads,
      startedAt: c.createdAt,
    }));
    const fromDesktop: QueueRow[] = (desktopJobs ?? []).map((j) => ({
      source: 'desktop',
      id: j.id,
      status: j.status === 'queued' ? 'queued' : 'running',
      title: formatJobKind(j.kind, t),
      subtitle: t('screens.queue.subtitleDesktop'),
      progressDone: j.progressDone,
      progressTotal: j.progressTotal,
      startedAt: j.runningAt ?? j.startedAt,
    }));

    const running = [...fromCampaigns, ...fromDesktop].filter(
      (r) => r.status !== 'queued'
    );
    const queued = fromDesktop.filter((r) => r.status === 'queued');
    return [...running, ...queued];
  }, [campaigns, desktopJobs, t]);

  useEffect(() => {
    if (cancellingIds.size === 0) return;
    const desktopIds = new Set((desktopJobs ?? []).map((j) => j.id));
    setCancellingIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) {
        if (!desktopIds.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [desktopJobs, cancellingIds.size]);

  async function refresh() {
    setRefreshing(true);
    try {
      await runSync();
    } finally {
      setRefreshing(false);
    }
  }

  async function cancelRow(row: QueueRow) {
    setCancellingIds((prev) => new Set(prev).add(row.id));
    setCancelError(null);
    try {
      if (row.source === 'desktop') {
        await cancelDesktopJob(row.id);
        await runSync();
      } else {
        await db.campaigns.update(row.id, { status: 'paused' });
        setCancellingIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      }
    } catch (err) {
      console.warn('Cancel failed', err);
      setCancelError(err instanceof Error ? err.message : String(err));
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t('screens.queue.title')}
        description={t('screens.queue.description', { count: rows.length })}
        actions={
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
        }
      />

      {cancelError ? (
        <div className="flex items-start justify-between gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          <span className="break-words">
            <strong className="font-medium">Cancel failed:</strong> {cancelError}
          </span>
          <button
            type="button"
            onClick={() => setCancelError(null)}
            className="shrink-0 text-red-600 hover:text-red-900"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <ListTodo className="h-10 w-10" />
            <p className="text-sm font-medium text-foreground">{t('screens.queue.nothingRunning')}</p>
            <p>{t('screens.queue.nothingRunningHint')}</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.queue.thStatus')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.queue.thJob')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.queue.thSource')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.queue.thProgress')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.queue.thElapsed')}</th>
                <th className="px-2 py-1.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct =
                  row.progressTotal && row.progressTotal > 0
                    ? Math.min(
                        100,
                        Math.round((row.progressDone / row.progressTotal) * 100)
                      )
                    : null;
                const cancelling = cancellingIds.has(row.id);
                return (
                  <tr
                    key={`${row.source}:${row.id}`}
                    className="border-t border-border even:bg-muted/30 last:border-b"
                  >
                    <td className="px-3 py-1.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-medium">{row.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {row.subtitle}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.status === 'queued' ? (
                        <span className="text-[11px] text-muted-foreground">
                          {t('screens.queue.waiting')}
                        </span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-foreground/70 transition-[width]"
                              style={{ width: pct != null ? `${pct}%` : '30%' }}
                            />
                          </div>
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {row.progressTotal != null
                              ? `${row.progressDone}/${row.progressTotal}`
                              : `${row.progressDone}`}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {row.status === 'queued' ? '—' : formatElapsed(row.startedAt)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {row.source === 'campaign' ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/campaigns/${row.id}`)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label={t('screens.queue.openCampaignAria')}
                          >
                            {row.status === 'paused' ? (
                              <Play className="h-3.5 w-3.5" />
                            ) : (
                              <Pause className="h-3.5 w-3.5" />
                            )}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void cancelRow(row)}
                          disabled={cancelling}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                          aria-label={t('screens.queue.cancelAria')}
                        >
                          {cancelling ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
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

function StatusBadge({ status }: { status: 'running' | 'queued' | 'paused' }) {
  const { t } = useTranslation();
  if (status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('screens.queue.statusQueued')}
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
        {t('screens.queue.statusPaused')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      {t('screens.queue.statusRunning')}
    </span>
  );
}
