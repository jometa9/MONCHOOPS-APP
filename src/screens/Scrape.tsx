import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/common/Spinner';
import { AccountPicker } from '@/components/common/AccountPicker';
import { useAccounts } from '@/context/AccountsContext';
import { cn } from '@/lib/cn';
import { b2dm } from '@/lib/b2dm';
import type { ScrapeKind } from '@/types/domain';

type Mode = ScrapeKind;

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'scrape_by_username', label: 'By username', hint: "Followers or last N posts of a profile" },
  { id: 'scrape_by_post', label: 'By post URL', hint: 'Commenters of a single post' },
  { id: 'scrape_by_hashtag', label: 'By hashtag', hint: 'Engagers of top posts for a hashtag' },
  { id: 'scrape_by_location', label: 'By location', hint: 'Engagers of top posts at a location' },
];

export function Scrape() {
  const { accounts } = useAccounts();
  const [mode, setMode] = useState<Mode>('scrape_by_username');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);

  const [username, setUsername] = useState('');
  const [collectFollowers, setCollectFollowers] = useState(true);
  const [postsCount, setPostsCount] = useState(10);
  const [postUrl, setPostUrl] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [postsToCheck, setPostsToCheck] = useState(20);
  const [locationUrl, setLocationUrl] = useState('');

  async function start() {
    if (!accountId) return;
    setSubmitting(true);
    setError(null);
    try {
      let params: Record<string, unknown> = {};
      if (mode === 'scrape_by_username') {
        params = { username, collectFollowers, postsCount, collectFromComments: true };
      } else if (mode === 'scrape_by_post') {
        params = { postUrl, collectCommenters: true, collectLikers: true };
      } else if (mode === 'scrape_by_hashtag') {
        params = { hashtag, postsToCheck };
      } else if (mode === 'scrape_by_location') {
        params = { locationUrl, postsToCheck };
      }
      const jobId = await b2dm.jobs.startScrape({ accountId, kind: mode, params });
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start scrape');
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    !!accountId &&
    ((mode === 'scrape_by_username' && username.trim().length > 0) ||
      (mode === 'scrape_by_post' && postUrl.trim().length > 0) ||
      (mode === 'scrape_by_hashtag' && hashtag.trim().length > 0) ||
      (mode === 'scrape_by_location' && locationUrl.trim().length > 0));

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <Link to="/actions" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        <ArrowLeft className="h-3 w-3" />
        Back to actions
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Scrape usernames</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a source, run the job, and the results will appear in the Data screen as a downloadable CSV.
      </p>

      <div className="mt-6 grid grid-cols-4 gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              'rounded-md px-3 py-2 text-xs font-medium transition-colors',
              m.id === mode ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}</p>

      {startedJobId ? (
        <div className="mt-6 rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-2 text-sm">
            <Spinner className="h-4 w-4" />
            <span>Scrape started. Check the status bar for progress, or head to Data when it's done.</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Link to="/data">
              <Button variant="outline">View data</Button>
            </Link>
            <Button variant="ghost" onClick={() => setStartedJobId(null)}>Queue another</Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div>
            <Label>Instagram account</Label>
            <div className="mt-2">
              <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
            </div>
          </div>

          {mode === 'scrape_by_username' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sc-user">Target username</Label>
                <Input id="sc-user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@nike" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={collectFollowers}
                  onChange={(e) => setCollectFollowers(e.target.checked)}
                />
                Collect followers (otherwise: commenters of last posts)
              </label>
              {!collectFollowers ? (
                <div className="space-y-1">
                  <Label htmlFor="sc-posts">Posts to walk</Label>
                  <Input
                    id="sc-posts"
                    type="number"
                    min={1}
                    max={50}
                    value={postsCount}
                    onChange={(e) => setPostsCount(Number(e.target.value) || 10)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'scrape_by_post' ? (
            <div className="space-y-1">
              <Label htmlFor="sc-post">Post URL</Label>
              <Input
                id="sc-post"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://www.instagram.com/p/…"
              />
            </div>
          ) : null}

          {mode === 'scrape_by_hashtag' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sc-tag">Hashtag (no #)</Label>
                <Input
                  id="sc-tag"
                  value={hashtag}
                  onChange={(e) => setHashtag(e.target.value)}
                  placeholder="travel"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-tagposts">Posts to check</Label>
                <Input
                  id="sc-tagposts"
                  type="number"
                  min={1}
                  max={100}
                  value={postsToCheck}
                  onChange={(e) => setPostsToCheck(Number(e.target.value) || 20)}
                />
              </div>
            </div>
          ) : null}

          {mode === 'scrape_by_location' ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sc-loc">Location URL or ID</Label>
                <Input
                  id="sc-loc"
                  value={locationUrl}
                  onChange={(e) => setLocationUrl(e.target.value)}
                  placeholder="https://www.instagram.com/explore/locations/213385402/new-york-new-york/"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-locposts">Posts to check</Label>
                <Input
                  id="sc-locposts"
                  type="number"
                  min={1}
                  max={100}
                  value={postsToCheck}
                  onChange={(e) => setPostsToCheck(Number(e.target.value) || 20)}
                />
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div>
            <Button onClick={start} disabled={submitting || !canSubmit}>
              {submitting ? <Spinner /> : <Play className="h-4 w-4" />}
              {submitting ? 'Starting…' : 'Start scrape'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
