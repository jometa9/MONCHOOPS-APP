import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database, Download, Eye, FolderOpen, Search, Tag } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { ScrapeResultPublic } from '@/types/domain';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export function Data() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ScrapeResultPublic[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      return [row.summary, row.kind, row.categoryName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query]);

  async function load() {
    const list = await b2dm.scrapes.list();
    setRows(list);
  }

  useEffect(() => {
    void load();
    const off = b2dm.jobs.onDone(() => void load());
    const timer = setInterval(() => void load(), 5000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);

  async function download(jobId: string) {
    setDownloading(jobId);
    try {
      await b2dm.scrapes.download(jobId);
    } finally {
      setDownloading(null);
    }
  }

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
          icon={<Database className="h-10 w-10" />}
          title="No scraped data yet"
          description="Run a scrape from Actions → Scrape usernames. Results will appear here with a download button."
        />
      </div>
    );
  }

  return (
    <div className="bg-background">
        <div className="sticky top-0 z-20 flex items-stretch bg-background">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by summary, kind or category…"
              className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-9 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Summary</th>
              <th className="px-3 py-1.5 text-left">Category</th>
              <th className="px-3 py-1.5 text-right">Usernames</th>
              <th className="px-3 py-1.5 text-right">Duration</th>
              <th className="px-3 py-1.5 text-left">Completed</th>
              <th className="px-3 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows!.length === 0 ? (
              <tr className="border-t border-border last:border-b">
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No scrapes match your search.
                </td>
              </tr>
            ) : filteredRows!.map((row) => (
              <tr key={row.jobId} className="border-t border-border even:bg-muted/30 last:border-b">
                <td className="px-3 py-1.5">
                  <div className="font-medium">{row.summary}</div>
                  <div className="text-[11px] text-muted-foreground">{row.kind}</div>
                </td>
                <td className="px-3 py-1.5">
                  {row.categoryName ? (
                    <div className="inline-flex items-center gap-1.5 text-xs">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      <span>{row.categoryName}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.usernameCount}</td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">{formatDuration(row.durationMs)}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{formatDateTime(row.completedAt)}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/data/${row.jobId}`)}
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      title="View usernames"
                      aria-label="View usernames"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void download(row.jobId)}
                      disabled={downloading === row.jobId}
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                      title="Download CSV"
                      aria-label="Download CSV"
                    >
                      {downloading === row.jobId ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => void b2dm.scrapes.revealInFolder(row.jobId)}
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                      title="Reveal file in folder"
                      aria-label="Reveal file in folder"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
    </div>
  );
}
