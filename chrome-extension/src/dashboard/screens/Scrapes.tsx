import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Inbox, RefreshCw, Search } from 'lucide-react';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import { runSync } from '@/shared/sync';
import type { SyncedScrape } from '@/shared/types';

function formatKind(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Scrapes() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const rows = useLiveQuery(
    async () => {
      const all = await db.scrapes.toArray();
      return all
        .filter((s) => !s.deletedAt)
        .sort((a, b) => b.completedAt - a.completedAt);
    },
    [],
    [] as SyncedScrape[]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows ?? [];
    return (rows ?? []).filter(
      (r) =>
        r.summary.toLowerCase().includes(q) ||
        (r.targetName ?? '').toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q) ||
        (r.accountUsername ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

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
        title="Scrapes"
        description="Lead scrapes that ran on the desktop. Read-only — start a scrape from the desktop app."
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

      {(rows ?? []).length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground">
            <Inbox className="h-10 w-10" />
            <p className="text-sm font-medium text-foreground">No scrapes yet</p>
            <p>Run one from the desktop app — it'll show up here once it finishes.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by summary, target, kind or account…"
                className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              No scrapes match your search.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full whitespace-nowrap text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Summary</th>
                    <th className="px-3 py-1.5 text-left">Kind</th>
                    <th className="px-3 py-1.5 text-left">Account</th>
                    <th className="px-3 py-1.5 text-right">Leads</th>
                    <th className="px-3 py-1.5 text-left">Completed</th>
                    <th className="px-2 py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.jobId}
                      onClick={() => navigate(`/scrapes/${row.jobId}`)}
                      className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-medium">
                          {row.targetName ?? row.summary}
                        </div>
                        {row.targetName && row.targetName !== row.summary ? (
                          <div className="text-[11px] text-muted-foreground">
                            {row.summary}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {formatKind(row.kind)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {row.accountUsername ? `@${row.accountUsername}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {row.usernameCount}
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
                            onClick={() => navigate(`/scrapes/${row.jobId}`)}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                            aria-label="View leads"
                          >
                            <Eye className="h-3.5 w-3.5" />
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
    </div>
  );
}
