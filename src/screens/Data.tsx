import { useEffect, useState } from 'react';
import { Database, Download, FolderOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import type { ScrapeResultPublic } from '@/types/domain';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export function Data() {
  const [rows, setRows] = useState<ScrapeResultPublic[] | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function load() {
    const list = await b2dm.scrapes.list();
    setRows(list);
  }

  useEffect(() => {
    void load();
    const off = b2dm.jobs.onDone(() => void load());
    return () => off();
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
    <div className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scraped username lists. Download any row as a CSV.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Summary</th>
              <th className="px-4 py-2 text-right">Usernames</th>
              <th className="px-4 py-2 text-right">Duration</th>
              <th className="px-4 py-2 text-left">Completed</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.jobId} className="border-t border-border">
                <td className="px-4 py-3">
                  <div className="font-medium">{row.summary}</div>
                  <div className="text-[11px] text-muted-foreground">{row.kind}</div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.usernameCount}</td>
                <td className="px-4 py-3 text-right text-muted-foreground">{formatDuration(row.durationMs)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(row.completedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void download(row.jobId)}
                      disabled={downloading === row.jobId}
                    >
                      {downloading === row.jobId ? <Spinner /> : <Download className="h-3.5 w-3.5" />}
                      CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void b2dm.scrapes.revealInFolder(row.jobId)}
                      title="Reveal file in folder"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
