import { useEffect, useState } from 'react';
import { Eye, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/common/Spinner';
import { EmptyState } from '@/components/common/EmptyState';
import { b2dm } from '@/lib/b2dm';
import type { AccountPublic } from '@/types/domain';

export function StoryWatcher() {
  const [accounts, setAccounts] = useState<AccountPublic[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [usernamesText, setUsernamesText] = useState('');
  const [perUserDwellSec, setPerUserDwellSec] = useState(3);
  const [intervalSec, setIntervalSec] = useState(8);
  const [maxStories, setMaxStories] = useState(5);
  const [skipIfNoStory, setSkipIfNoStory] = useState(true);
  const [starting, setStarting] = useState(false);
  const [lastJobId, setLastJobId] = useState<string | null>(null);

  useEffect(() => {
    void b2dm.accounts.list().then((list) => {
      setAccounts(list);
      if (list.length > 0) setAccountId(list[0]!.id);
    });
  }, []);

  async function loadFromCsv() {
    const result = await b2dm.csv.pickAndPersist();
    if (!result) return;
    const list = await b2dm.csv.listUsernames(result.path);
    setUsernamesText(list.join('\n'));
  }

  async function handleStart() {
    if (!accountId) return;
    const usernames = usernamesText
      .split(/\r?\n/)
      .map((s) => s.trim().replace(/^@+/, ''))
      .filter(Boolean);
    if (usernames.length === 0) {
      alert('Add at least one username');
      return;
    }
    setStarting(true);
    try {
      const jobId = await b2dm.storyWatcher.start({
        accountId,
        usernames,
        perUserDwellSec,
        intervalBetweenUsersSec: intervalSec,
        maxStoriesPerUser: maxStories,
        skipIfNoStory,
      });
      setLastJobId(jobId);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  if (accounts === null) {
    return <Spinner className="h-6 w-6" />;
  }
  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Eye className="h-10 w-10" />}
        title="Connect an Instagram account first"
        description="Story Watcher uses an account session to view stories silently."
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-base font-semibold">Story Watcher</h1>
        <p className="text-xs text-muted-foreground">
          Silently watch stories of a list of usernames. Useful as a warm touch before a Cold DM
          run, or as a low-risk visibility bump.
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <Label>Account</Label>
          <select
            value={accountId ?? ''}
            onChange={(e) => setAccountId(e.target.value || null)}
            className="h-9 w-full rounded border border-border bg-transparent px-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label>Usernames (one per line)</Label>
            <Button size="sm" variant="ghost" onClick={() => void loadFromCsv()}>
              Load from CSV
            </Button>
          </div>
          <textarea
            value={usernamesText}
            onChange={(e) => setUsernamesText(e.target.value)}
            placeholder="username1&#10;username2&#10;username3"
            className="min-h-[160px] w-full rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-primary"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Dwell per story (s)</Label>
            <Input
              type="number"
              min={1}
              max={15}
              value={perUserDwellSec}
              onChange={(e) => setPerUserDwellSec(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Interval between users (s)</Label>
            <Input
              type="number"
              min={1}
              max={120}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>Max stories / user</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={maxStories}
              onChange={(e) => setMaxStories(Number(e.target.value))}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={skipIfNoStory}
            onChange={(e) => setSkipIfNoStory(e.target.checked)}
          />
          Skip user if no story is available
        </label>

        <div className="flex justify-end">
          <Button onClick={() => void handleStart()} disabled={starting}>
            {starting ? <Spinner className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            Run
          </Button>
        </div>

        {lastJobId ? (
          <div className="rounded border border-border bg-muted/20 p-3 text-xs">
            Job started: <code>{lastJobId}</code>. Track it on the Queue screen.
          </div>
        ) : null}
      </div>
    </div>
  );
}
