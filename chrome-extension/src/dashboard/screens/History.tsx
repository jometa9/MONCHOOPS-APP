import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search } from 'lucide-react';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import type { DmHistoryRow } from '@/shared/types';

export function History() {
  const rows = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().toArray(),
    [],
    [] as DmHistoryRow[]
  );
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!rows) return [] as DmHistoryRow[];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.username.toLowerCase().includes(q) ||
        r.campaignName.toLowerCase().includes(q) ||
        r.message.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const totalSent = useMemo(() => rows?.filter((r) => r.status === 'sent').length ?? 0, [rows]);
  const totalFailed = useMemo(() => rows?.filter((r) => r.status === 'failed').length ?? 0, [rows]);

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title="DM history"
        description={`${totalSent} sent · ${totalFailed} failed`}
      />
      <div className="border-b border-border">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username, campaign, or message…"
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {rows && rows.length === 0
            ? 'No DMs sent yet — your first run will show up here.'
            : 'No results.'}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">When</th>
                <th className="px-4 py-2 text-left">Lead</th>
                <th className="px-4 py-2 text-left">Campaign</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Message</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-1.5 text-muted-foreground">{formatDateTime(r.timestamp)}</td>
                  <td className="px-4 py-1.5 font-medium">@{r.username}</td>
                  <td className="px-4 py-1.5 text-muted-foreground">{r.campaignName}</td>
                  <td className="px-4 py-1.5">
                    <span
                      className={
                        'inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ' +
                        (r.status === 'sent'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700')
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    <div className="max-w-[40ch] truncate">{r.error ?? r.message}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
