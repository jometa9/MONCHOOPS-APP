import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FileUp, Play, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/common/Spinner';
import { AccountPicker } from '@/components/common/AccountPicker';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';

export function MassDMs() {
  const { accounts } = useAccounts();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [csvPath, setCsvPath] = useState<string | null>(null);
  const [csvCount, setCsvCount] = useState<number>(0);
  const [message, setMessage] = useState('');
  const [intervalSec, setIntervalSec] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);

  async function pickCsv() {
    try {
      const res = await b2dm.csv.pickAndPersist();
      if (!res) return;
      setCsvPath(res.path);
      setCsvCount(res.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load file');
    }
  }

  async function start() {
    if (!accountId || !csvPath || !message.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await b2dm.jobs.startMassDm({
        accountId,
        usernamesCsvPath: csvPath,
        message: message.trim(),
        intervalMs: Math.max(3000, intervalSec * 1000),
      });
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start job');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
      <Link to="/actions" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        <ArrowLeft className="h-3 w-3" />
        Back to actions
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Mass DMs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Send the same message to a list of Instagram usernames. Use <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{username}}'}</code> to personalise it.
      </p>

      {startedJobId ? (
        <div className="mt-6 rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-2 text-sm">
            <Spinner className="h-4 w-4" />
            <span>Job started. Watch progress in the bottom status bar.</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={() => setStartedJobId(null)}>Queue another</Button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <div>
            <Label>1. Choose an Instagram account</Label>
            <div className="mt-2">
              <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
            </div>
          </div>

          <div>
            <Label>2. Upload a usernames file</Label>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="outline" onClick={pickCsv} type="button">
                <FileUp className="h-4 w-4" />
                Choose CSV / XLSX / TXT
              </Button>
              {csvPath ? (
                <span className="text-xs text-muted-foreground">{csvCount} usernames loaded</span>
              ) : (
                <span className="text-xs text-muted-foreground">First column = username. Header optional.</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="dm-msg">3. Your message</Label>
            <Textarea
              id="dm-msg"
              rows={4}
              placeholder={'Hey {{username}}, …'}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="dm-interval">4. Interval between DMs (seconds)</Label>
            <Input
              id="dm-interval"
              type="number"
              min={3}
              max={600}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Math.max(3, Math.min(600, Number(e.target.value) || 12)))}
            />
            <p className="text-[11px] text-muted-foreground">Minimum 3s. Jitter ±25% is applied automatically.</p>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button
              onClick={start}
              disabled={submitting || !accountId || !csvPath || !message.trim()}
            >
              {submitting ? <Spinner /> : <Play className="h-4 w-4" />}
              {submitting ? 'Starting…' : 'Start mass DM job'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => { setMessage(''); setCsvPath(null); setCsvCount(0); }}>
              <Upload className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
