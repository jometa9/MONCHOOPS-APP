import { useEffect, useMemo, useState } from 'react';
import { History, Instagram, Search } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { MassDmResultPublic } from '@/types/domain';

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

export function ColdDmHistory() {
  const [rows, setRows] = useState<MassDmResultPublic[] | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.accountUsername ?? '').toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await b2dm.massDms.list();
        if (!cancelled) setRows(list);
      } catch {}
    }
    void load();
    const off = b2dm.jobs.onDone(() => void load());
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      off();
      clearInterval(timer);
    };
  }, []);

  if (rows === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="h-full">
        <EmptyState
          icon={<History className="h-10 w-10" />}
          title="No Cold DM runs yet"
          description="Once you send your first campaign, it will show up here."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-stretch bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by account…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left">Account</th>
            <th className="px-3 py-1.5 text-right">Sent</th>
            <th className="px-3 py-1.5 text-right">Failed</th>
            <th className="px-3 py-1.5 text-right">Duration</th>
            <th className="px-3 py-1.5 text-left">Completed</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows!.length === 0 ? (
            <tr className="border-t border-border last:border-b">
              <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                No runs match your search.
              </td>
            </tr>
          ) : (
            filteredRows!.map((row) => (
              <tr key={row.jobId} className="border-t border-border even:bg-muted/30 last:border-b">
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Instagram className="h-3 w-3" />
                    </div>
                    <span className="font-medium">
                      {row.accountUsername ? `@${row.accountUsername}` : '—'}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.sentCount}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {row.failedCount}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatDuration(row.durationMs)}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {formatDateTime(row.completedAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
