import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Database,
  Download,
  Eye,
  FolderOpen,
  RotateCw,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CategoryChip } from '@/components/common/CategoryChip';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { ScrapeSummaryOf } from '@/components/common/ScrapeSummary';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type { ScrapeKind, ScrapeResultPublic } from '@/types/domain';

const SCRAPE_KINDS: ReadonlyArray<ScrapeKind> = [
  'scrape_by_username',
  'scrape_by_post',
  'scrape_by_hashtag',
  'scrape_by_location',
];

function isScrapeKind(kind: string): kind is ScrapeKind {
  return (SCRAPE_KINDS as readonly string[]).includes(kind);
}

function formatKind(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function Data() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ScrapeResultPublic[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      return [row.summary, row.kind, row.targetName ?? '', row.categoryName ?? '', row.status]
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

  async function retry(row: ScrapeResultPublic) {
    if (!row.accountId || !isScrapeKind(row.kind) || !row.params || typeof row.params !== 'object') {
      setRetryError('Cannot retry this scrape — original account or parameters are missing.');
      return;
    }
    setRetrying(row.jobId);
    setRetryError(null);
    try {
      await b2dm.jobs.startScrape({
        accountId: row.accountId,
        kind: row.kind,
        params: row.params as Record<string, unknown>,
      });
      navigate('/queue');
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Could not restart scrape');
    } finally {
      setRetrying(null);
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
      <EmptyState
        icon={<Database className="h-10 w-10" />}
        title="No scraped data yet"
        description="Scraped leads show up here, ready to export or reuse in a campaign."
        action={
          <EmptyStateLinkButton to="/scrape" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            Scrape data
          </EmptyStateLinkButton>
        }
      />
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
            placeholder="Search by summary, kind, category or status…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {retryError ? (
        <div className="border-t border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {retryError}
        </div>
      ) : null}
      {filteredRows!.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="No results"
            description="No scrapes match your search."
          />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Summary</th>
              <th className="px-3 py-1.5 text-left">Status</th>
              <th className="px-3 py-1.5 text-left">Category</th>
              <th className="px-3 py-1.5 text-right">Leads</th>
              <th className="px-3 py-1.5 text-left">Finished</th>
              <th className="px-3 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows!.map((row) => {
                const hasCsv = !!row.csvPath;
                const canRetry =
                  row.status === 'failed' &&
                  !!row.accountId &&
                  isScrapeKind(row.kind) &&
                  !!row.params;
                return (
                  <tr
                    key={row.jobId}
                    className="border-t border-border even:bg-muted/30 last:border-b"
                  >
                    <td className="px-3 py-1.5">
                      <ScrapeSummaryOf row={row} className="text-sm font-medium" />
                      <div className="text-[11px] text-muted-foreground">
                        {formatKind(row.kind)}
                        {row.accountUsername ? (
                          <>
                            {' with '}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void b2dm.openExternalLink(
                                  `https://www.instagram.com/${encodeURIComponent(row.accountUsername!)}/`
                                );
                              }}
                              className="text-muted-foreground transition-colors hover:text-foreground"
                            >
                              @{row.accountUsername}
                            </button>
                          </>
                        ) : null}
                      </div>
                      {row.status === 'failed' && row.error ? (
                        <div className="mt-0.5 max-w-md truncate text-[11px] text-destructive">
                          {row.error}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      {row.categoryName ? (
                        <CategoryChip name={row.categoryName} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.usernameCount}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatDateTime(row.completedAt)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {canRetry ? (
                          <button
                            type="button"
                            onClick={() => void retry(row)}
                            disabled={retrying === row.jobId}
                            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                            aria-label="Retry scrape"
                          >
                            {retrying === row.jobId ? <Spinner /> : <RotateCw className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => navigate(`/data/${row.jobId}`)}
                          disabled={!hasCsv}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                          aria-label="View usernames"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void download(row.jobId)}
                          disabled={!hasCsv || downloading === row.jobId}
                          className={cn(
                            'inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40',
                            !hasCsv && 'disabled:hover:text-muted-foreground'
                          )}
                          aria-label="Download CSV"
                        >
                          {downloading === row.jobId ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void b2dm.scrapes.revealInFolder(row.jobId)}
                          disabled={!hasCsv}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                          aria-label="Reveal file in folder"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
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

function StatusBadge({ status }: { status: ScrapeResultPublic['status'] }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>;
  if (status === 'cancelled') return <Badge variant="muted">Cancelled</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}
