import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListTodo, Loader2, MessageSquare, Pause, Play, RefreshCw, X } from 'lucide-react';
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

const NON_SCRAPE_TITLE: Record<string, string> = {
  login: 'Login',
  mass_dm: 'Cold DM campaign',
};

function formatJobKind(kind: string): string {
  if (NON_SCRAPE_TITLE[kind]) return NON_SCRAPE_TITLE[kind]!;
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
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

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
      subtitle: 'Extension · Cold DM',
      progressDone: c.sentCount + c.failedCount,
      progressTotal: c.totalLeads,
      startedAt: c.createdAt,
    }));
    const fromDesktop: QueueRow[] = (desktopJobs ?? []).map((j) => ({
      source: 'desktop',
      id: j.id,
      status: j.status === 'queued' ? 'queued' : 'running',
      title: formatJobKind(j.kind),
      subtitle: 'Desktop',
      progressDone: j.progressDone,
      progressTotal: j.progressTotal,
      startedAt: j.runningAt ?? j.startedAt,
    }));
    // Running first (extension + desktop), then queued.
    const running = [...fromCampaigns, ...fromDesktop].filter(
      (r) => r.status !== 'queued'
    );
    const queued = fromDesktop.filter((r) => r.status === 'queued');
    return [...running, ...queued];
  }, [campaigns, desktopJobs]);

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
    try {
      if (row.source === 'desktop') {
        await cancelDesktopJob(row.id);
        await runSync();
      } else {
        // Pause the campaign locally — the SW respects it on next tick.
        await db.campaigns.update(row.id, { status: 'paused' });
      }
    } catch (err) {
      console.warn('Cancel failed', err);
    } finally {
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
        title="Queue"
        description={`${rows.length} active job${rows.length === 1 ? '' : 's'} across extension and desktop`}
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
            Refresh
          </button>
        }
      />

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <ListTodo className="h-10 w-10" />
            <p className="text-sm font-medium text-foreground">Nothing running</p>
            <p>Active campaigns or desktop jobs show up here in real time.</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Status</th>
                <th className="px-3 py-1.5 text-left">Job</th>
                <th className="px-3 py-1.5 text-left">Source</th>
                <th className="px-3 py-1.5 text-left">Progress</th>
                <th className="px-3 py-1.5 text-right">Elapsed</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
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
                          Waiting…
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
                            aria-label="Open campaign"
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
                          aria-label="Cancel"
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
  if (status === 'queued') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Queued
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
        Paused
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
      <Loader2 className="h-2.5 w-2.5 animate-spin" />
      Running
    </span>
  );
}
