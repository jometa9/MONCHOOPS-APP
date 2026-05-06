import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, ExternalLink, RefreshCw, Search, Users } from 'lucide-react';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import { listScrapeLeads } from '@/shared/desktop-bridge';

interface UsernameRow {
  username: string;
}

export function ScrapeDetail() {
  const { jobId = '' } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [usernames, setUsernames] = useState<UsernameRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrape = useLiveQuery(() => db.scrapes.get(jobId), [jobId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const list = await listScrapeLeads(jobId);
      setUsernames(list.map((u) => ({ username: u.username })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (jobId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = usernames ?? [];
    if (!q) return list;
    return list.filter((u) => u.username.toLowerCase().includes(q));
  }, [usernames, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ScreenHeader
        title={scrape?.targetName ?? scrape?.summary ?? 'Scrape'}
        description={
          scrape
            ? `${scrape.usernameCount} leads · ${formatDateTime(scrape.completedAt)}`
            : ' '
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/scrapes')}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
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
            placeholder="Search username…"
            className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {error ? (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {usernames === null ? (
            'Loading leads…'
          ) : usernames.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <Users className="h-10 w-10" />
              <p className="text-sm font-medium">No leads</p>
              <p>This scrape returned no usernames.</p>
            </div>
          ) : (
            'No leads match your search.'
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Username</th>
                <th className="px-2 py-1.5 text-right">Profile</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const url = `https://www.instagram.com/${encodeURIComponent(u.username)}/`;
                return (
                  <tr
                    key={u.username}
                    onClick={() => window.open(url, '_blank')}
                    className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                  >
                    <td className="px-3 py-1.5 font-medium">@{u.username}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(url, '_blank');
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Open @${u.username} on Instagram`}
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
