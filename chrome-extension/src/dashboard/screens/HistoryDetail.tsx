import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  ExternalLink,
  Instagram,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import { pullDmSends, runSync } from '@/shared/sync';
import type {
  Campaign,
  DmHistoryRow,
  SyncedDmJob,
  SyncedDmSend,
} from '@/shared/types';

interface DisplayRow {
  username: string;
  status: 'sent' | 'failed';
  message: string | null;
  error: string | null;
  timestamp: number;
}

export function HistoryDetail() {
  const { source = '', id = '' } = useParams<{ source: string; id: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const isDesktop = source === 'desktop';

  // ---- Desktop branch — pulls SyncedDmJob + SyncedDmSends -----------------
  const dmJob = useLiveQuery(
    async () => (isDesktop ? await db.dmJobs.get(id) : undefined),
    [isDesktop, id]
  );
  const dmSends = useLiveQuery(
    async () => {
      if (!isDesktop) return [] as SyncedDmSend[];
      const all = await db.dmSends.where('jobId').equals(id).toArray();
      return all.sort((a, b) => b.sentAt - a.sentAt);
    },
    [isDesktop, id],
    [] as SyncedDmSend[]
  );

  useEffect(() => {
    if (!isDesktop || !id) return;
    void pullDmSends(id).catch(() => {
      // Failures surface via the sidebar sync indicator.
    });
  }, [isDesktop, id]);

  // ---- Campaign branch — local extension data ----------------------------
  const campaign = useLiveQuery(
    async () => (!isDesktop ? await db.campaigns.get(id) : undefined),
    [isDesktop, id]
  ) as Campaign | undefined;
  const historyRows = useLiveQuery(
    async () => {
      if (isDesktop) return [] as DmHistoryRow[];
      const all = await db.history.where('campaignId').equals(id).toArray();
      return all.sort((a, b) => b.timestamp - a.timestamp);
    },
    [isDesktop, id],
    [] as DmHistoryRow[]
  );

  const display = useMemo<DisplayRow[]>(() => {
    if (isDesktop) {
      return (dmSends ?? []).map((s) => ({
        username: s.username,
        status: s.status,
        message: s.message,
        error: s.error,
        timestamp: s.sentAt,
      }));
    }
    return (historyRows ?? []).map((r) => ({
      username: r.username,
      status: r.status,
      message: r.message,
      error: r.error ?? null,
      timestamp: r.timestamp,
    }));
  }, [isDesktop, dmSends, historyRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return display;
    return display.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        (r.message ?? '').toLowerCase().includes(q)
    );
  }, [display, query]);

  const meta = useMemo(() => {
    if (isDesktop && dmJob) {
      return {
        title: dmJob.accountUsername ? `@${dmJob.accountUsername}` : 'Desktop run',
        accountUsername: dmJob.accountUsername,
        completedAt: dmJob.completedAt,
        sentCount: dmJob.sentCount,
        failedCount: dmJob.failedCount,
      };
    }
    if (!isDesktop && campaign) {
      return {
        title: campaign.name,
        accountUsername: null,
        completedAt: campaign.completedAt ?? campaign.createdAt,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
      };
    }
    return null;
  }, [isDesktop, dmJob, campaign]);

  async function refresh() {
    setRefreshing(true);
    try {
      if (isDesktop) {
        await Promise.all([runSync(), pullDmSends(id)]);
      } else {
        await runSync();
      }
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScreenHeader
        title={meta?.title ?? 'Run'}
        description={
          meta
            ? `${meta.sentCount} sent · ${meta.failedCount} failed${
                meta.completedAt ? ' · ' + formatDateTime(meta.completedAt) : ''
              }`
            : ' '
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
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
              Refresh
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
            placeholder="Search username or message…"
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {display.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Send className="h-10 w-10" />
              <p className="text-sm font-medium">No per-recipient log</p>
              <p className="text-xs text-muted-foreground">
                {isDesktop
                  ? "This desktop run hasn't been pulled yet, or it predates the detail log."
                  : 'Send your first DM in this campaign to populate the log.'}
              </p>
            </div>
          ) : (
            'No recipients match your search.'
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Message</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">Username</th>
                <th className="px-3 py-1.5 text-left">When</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, idx) => {
                const isFailed = row.status === 'failed';
                const openProfile = () =>
                  window.open(
                    `https://www.instagram.com/${encodeURIComponent(row.username)}/`,
                    '_blank'
                  );
                const openChat = () =>
                  window.open(
                    `https://ig.me/m/${encodeURIComponent(row.username)}`,
                    '_blank'
                  );
                return (
                  <tr
                    key={`${row.username}-${row.timestamp}-${idx}`}
                    className="border-t border-border transition-colors even:bg-muted/30 last:border-b"
                  >
                    <td className="px-3 py-1.5 align-top">
                      {row.message ? (
                        <span
                          className={
                            isFailed
                              ? 'whitespace-pre-wrap text-muted-foreground line-through'
                              : 'whitespace-pre-wrap'
                          }
                        >
                          {row.message}
                        </span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          {isFailed ? row.error ?? 'Not sent' : 'No message captured'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top whitespace-nowrap font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {meta?.accountUsername && isDesktop ? (
                          <Instagram className="h-3 w-3 text-muted-foreground" />
                        ) : null}
                        @{row.username}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 align-top text-xs text-muted-foreground">
                      {formatDateTime(row.timestamp)}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={openProfile}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Open @${row.username} on Instagram`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={openChat}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Open DM thread with @${row.username}`}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
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
