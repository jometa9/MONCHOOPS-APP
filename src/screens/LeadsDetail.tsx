import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Search, Users } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { ScrapeSummaryOf } from '@/components/common/ScrapeSummary';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import type { ScrapeResultPublic, ScrapeUsernameRow } from '@/types/domain';

export function LeadsDetail() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<ScrapeResultPublic | null>(null);
  const [rows, setRows] = useState<ScrapeUsernameRow[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [meta, list] = await Promise.all([
        b2dm.scrapes.get(jobId),
        b2dm.scrapes.listUsernames(jobId),
      ]);
      if (cancelled) return;
      setResult(meta);
      setRows(list);
    }
    void load();
    return () => { cancelled = true; };
  }, [jobId]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.username.toLowerCase().includes(q));
  }, [rows, query]);

  function goBack() {
    navigate('/data');
  }

  if (rows === null) {
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
          aria-label="Back to leads"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search username…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {result ? (
          <div className="flex items-center gap-2 border-l border-border px-3 text-xs text-muted-foreground">
            <ScrapeSummaryOf row={result} className="truncate text-xs text-muted-foreground" />
            <span className="tabular-nums">· {result.usernameCount}</span>
          </div>
        ) : null}
      </div>

      {filteredRows!.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={rows.length === 0 ? <Users className="h-10 w-10" /> : <Search className="h-10 w-10" />}
            title="No results"
            description={
              rows.length === 0
                ? 'This scrape finished without producing any usernames.'
                : 'No usernames match your search.'
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Username</th>
              <th className="px-3 py-1.5 text-right">Profile</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows!.map((row) => {
              const openProfile = () =>
                void b2dm.openExternalLink(
                  `https://www.instagram.com/${encodeURIComponent(row.username)}/`
                );
              return (
                <tr
                  key={row.username}
                  onClick={openProfile}
                  className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5 font-medium">@{row.username}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openProfile(); }}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={`Open @${row.username} on Instagram`}
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
    </div>
  );
}
