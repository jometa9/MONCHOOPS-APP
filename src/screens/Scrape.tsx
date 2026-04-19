import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  FileImage,
  Hash,
  Instagram,
  MapPin,
  Play,
  Tag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/common/Spinner';
import { AccountStep } from '@/components/common/AccountStep';
import { Stepper } from '@/components/common/Stepper';
import { SummaryCard } from '@/components/common/SummaryCard';
import {
  CategoryPicker,
  type CategorySelection,
} from '@/components/common/CategoryPicker';
import { useAccounts } from '@/context/AccountsContext';
import { cn } from '@/lib/cn';
import { b2dm } from '@/lib/b2dm';
import type { LeadCategoryPublic, ScrapeKind } from '@/types/domain';

type Mode = ScrapeKind;
type Step = 1 | 2 | 3;

const STEP_LABELS = ['Account', 'Scrape', 'Review'] as const;

const MODES: { id: Mode; label: string; hint: string; icon: typeof AtSign }[] = [
  {
    id: 'scrape_by_username',
    label: 'By username',
    hint: "Followers + commenters + likers of the profile's posts & reels",
    icon: AtSign,
  },
  {
    id: 'scrape_by_post',
    label: 'By post / reel',
    hint: 'Commenters + likers of a single permalink',
    icon: FileImage,
  },
  {
    id: 'scrape_by_hashtag',
    label: 'By hashtag',
    hint: 'Engagers of every post that matches, within a date range',
    icon: Hash,
  },
  {
    id: 'scrape_by_location',
    label: 'By location',
    hint: 'Engagers of every post tagged at the location, within a date range',
    icon: MapPin,
  },
];

function dateInputToEpoch(value: string): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(t) ? t : undefined;
}

function dateInputToEndOfDay(value: string): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(`${value}T23:59:59`);
  return Number.isFinite(t) ? t : undefined;
}

export function Scrape() {
  const { accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('scrape_by_username');

  const [username, setUsername] = useState('');
  const [maxInput, setMaxInput] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [category, setCategory] = useState<CategorySelection>({ mode: 'none' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  );

  const config = useMemo(
    () => ({ username, maxInput, postUrl, hashtag, locationUrl, fromDate, toDate }),
    [username, maxInput, postUrl, hashtag, locationUrl, fromDate, toDate]
  );

  const targetFilled =
    (mode === 'scrape_by_username' && username.trim().length > 0) ||
    (mode === 'scrape_by_post' && postUrl.trim().length > 0) ||
    (mode === 'scrape_by_hashtag' && hashtag.trim().length > 0) ||
    (mode === 'scrape_by_location' && locationUrl.trim().length > 0);

  const canContinue: Record<Step, boolean> = {
    1: !!accountId,
    2: targetFilled,
    3: true,
  };

  function goTo(next: Step) {
    if (next < step || canContinue[step]) setStep(next);
  }
  function next() {
    if (!canContinue[step]) return;
    if (step < 3) setStep((step + 1) as Step);
  }
  function back() {
    if (step > 1) setStep((step - 1) as Step);
  }

  async function confirmAndStart() {
    if (!accountId || !targetFilled) return;
    setSubmitting(true);
    setError(null);
    try {
      const categoryPayload =
        category.mode === 'existing' ? { categoryId: category.categoryId } : {};

      let params: Record<string, unknown> = { ...categoryPayload };
      if (mode === 'scrape_by_username') {
        const max = parseMaxInput(maxInput);
        params = { ...params, username, ...(max != null ? { max } : {}) };
      } else if (mode === 'scrape_by_post') {
        params = { ...params, postUrl };
      } else if (mode === 'scrape_by_hashtag') {
        params = {
          ...params,
          hashtag,
          from: dateInputToEpoch(fromDate),
          to: dateInputToEndOfDay(toDate),
        };
      } else if (mode === 'scrape_by_location') {
        params = {
          ...params,
          locationUrl,
          from: dateInputToEpoch(fromDate),
          to: dateInputToEndOfDay(toDate),
        };
      }
      const jobId = await b2dm.jobs.startScrape({ accountId, kind: mode, params });
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start scrape');
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStep(1);
    setAccountId(null);
    setMode('scrape_by_username');
    setUsername('');
    setMaxInput('');
    setPostUrl('');
    setHashtag('');
    setLocationUrl('');
    setFromDate('');
    setToDate('');
    setCategory({ mode: 'none' });
    setError(null);
    setStartedJobId(null);
  }

  if (startedJobId) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-2 text-sm">
            <Spinner className="h-4 w-4" />
            <span>Scrape started. Watch the status bar for progress.</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Link to="/data">
              <Button variant="outline">View data</Button>
            </Link>
            <Link to="/categories">
              <Button variant="outline">View categories</Button>
            </Link>
            <Button variant="ghost" onClick={resetAll}>
              Queue another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col pb-[8vh]">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Scrape leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Three quick steps: pick the account, configure the scrape, review and start.
        </p>
        <Stepper
          labels={STEP_LABELS}
          current={step}
          onJump={(s) => goTo(s as Step)}
          canJump={(s) => s < step || canContinue[step]}
        />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pt-4">
        {step === 1 ? (
          <AccountStep accounts={accounts} value={accountId} onChange={setAccountId} />
        ) : null}

        {step === 2 ? (
          <ScrapeConfigStep
            mode={mode}
            onModeChange={setMode}
            config={config}
            setUsername={setUsername}
            setMaxInput={setMaxInput}
            setPostUrl={setPostUrl}
            setHashtag={setHashtag}
            setLocationUrl={setLocationUrl}
            setFromDate={setFromDate}
            setToDate={setToDate}
            category={category}
            onCategoryChange={setCategory}
            submitting={submitting}
          />
        ) : null}

        {step === 3 ? (
          <ReviewStep
            account={selectedAccount ? { username: selectedAccount.username, profilePicUrl: selectedAccount.profilePicUrl } : null}
            mode={mode}
            config={config}
            category={category}
            error={error}
            submitting={submitting}
            onEditAccount={() => setStep(1)}
            onEditScrape={() => setStep(2)}
            onConfirm={confirmAndStart}
          />
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 pt-3">
        <Button variant="ghost" onClick={back} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {step < 3 ? (
          <Button onClick={next} disabled={!canContinue[step]}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Step 2: Scrape config ---------------- */

interface ConfigState {
  username: string;
  maxInput: string;
  postUrl: string;
  hashtag: string;
  locationUrl: string;
  fromDate: string;
  toDate: string;
}

function ScrapeConfigStep({
  mode,
  onModeChange,
  config,
  setUsername,
  setMaxInput,
  setPostUrl,
  setHashtag,
  setLocationUrl,
  setFromDate,
  setToDate,
  category,
  onCategoryChange,
  submitting,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  config: ConfigState;
  setUsername: (v: string) => void;
  setMaxInput: (v: string) => void;
  setPostUrl: (v: string) => void;
  setHashtag: (v: string) => void;
  setLocationUrl: (v: string) => void;
  setFromDate: (v: string) => void;
  setToDate: (v: string) => void;
  category: CategorySelection;
  onCategoryChange: (c: CategorySelection) => void;
  submitting: boolean;
}) {
  const activeHint = MODES.find((m) => m.id === mode)?.hint;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Method
        </Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:grid-cols-4">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                className={cn(
                  'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                  active
                    ? 'bg-background shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>
        {activeHint ? (
          <p className="text-[11px] text-muted-foreground">{activeHint}</p>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-background p-4">
        {mode === 'scrape_by_username' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sc-user">Target username</Label>
              <Input
                id="sc-user"
                value={config.username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="@nike"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-max">Max leads (blank = all)</Label>
              <Input
                id="sc-max"
                type="number"
                min={1}
                value={config.maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="e.g. 2000"
              />
              <p className="text-[11px] text-muted-foreground">
                We pull followers first, then post &amp; reel engagers, stopping once the
                cap is reached (or everything is exhausted).
              </p>
            </div>
          </div>
        ) : null}

        {mode === 'scrape_by_post' ? (
          <div className="space-y-1">
            <Label htmlFor="sc-post">Post or reel URL</Label>
            <Input
              id="sc-post"
              value={config.postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="https://www.instagram.com/p/… or /reel/…"
            />
          </div>
        ) : null}

        {mode === 'scrape_by_hashtag' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sc-tag">Hashtag (no #)</Label>
              <Input
                id="sc-tag"
                value={config.hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                placeholder="travel"
              />
            </div>
            <DateRangeFields
              from={config.fromDate}
              to={config.toDate}
              setFrom={setFromDate}
              setTo={setToDate}
            />
          </div>
        ) : null}

        {mode === 'scrape_by_location' ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sc-loc">Location URL or ID</Label>
              <Input
                id="sc-loc"
                value={config.locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="https://www.instagram.com/explore/locations/213385402/new-york-new-york/"
              />
            </div>
            <DateRangeFields
              from={config.fromDate}
              to={config.toDate}
              setFrom={setFromDate}
              setTo={setToDate}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-background p-4">
        <Label>Category</Label>
        <CategoryPicker
          value={category}
          onChange={onCategoryChange}
          disabled={submitting}
        />
        <p className="text-[11px] text-muted-foreground">
          Optional. Tagged scrapes get pooled into a deduplicated lead category.
        </p>
      </div>
    </div>
  );
}

function DateRangeFields({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label htmlFor="sc-from">From (optional)</Label>
        <Input
          id="sc-from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="sc-to">To (optional)</Label>
        <Input
          id="sc-to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>
      <p className="col-span-2 text-[11px] text-muted-foreground">
        Instagram has no built-in date filter — we walk the grid newest-first and visit
        each post to check its date. Leave blank to scrape everything currently visible.
      </p>
    </div>
  );
}

/* ---------------- Step 3: Review ---------------- */

function ReviewStep({
  account,
  mode,
  config,
  category,
  error,
  submitting,
  onEditAccount,
  onEditScrape,
  onConfirm,
}: {
  account: { username: string; profilePicUrl: string | null } | null;
  mode: Mode;
  config: ConfigState;
  category: CategorySelection;
  error: string | null;
  submitting: boolean;
  onEditAccount: () => void;
  onEditScrape: () => void;
  onConfirm: () => void;
}) {
  const modeDef = MODES.find((m) => m.id === mode)!;
  const ModeIcon = modeDef.icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      <SummaryCard title="Account" onEdit={onEditAccount}>
        {account ? (
          <div className="flex items-center gap-3">
            {account.profilePicUrl ? (
              <img
                src={account.profilePicUrl}
                alt={account.username}
                referrerPolicy="no-referrer"
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Instagram className="h-4 w-4" />
              </div>
            )}
            <span className="font-medium">@{account.username}</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </SummaryCard>

      <SummaryCard title="Method" onEdit={onEditScrape}>
        <div className="flex items-center gap-2 text-sm">
          <ModeIcon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{modeDef.label}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{modeDef.hint}</p>
      </SummaryCard>

      <SummaryCard title="Target" onEdit={onEditScrape}>
        <TargetSummary mode={mode} config={config} />
      </SummaryCard>

      <SummaryCard title="Category" onEdit={onEditScrape}>
        <CategorySummary value={category} />
      </SummaryCard>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting ? <Spinner /> : <Play className="h-4 w-4" />}
          {submitting ? 'Starting…' : 'Start scrape'}
        </Button>
      </div>
    </div>
  );
}

function TargetSummary({ mode, config }: { mode: Mode; config: ConfigState }) {
  if (mode === 'scrape_by_username') {
    const max = parseMaxInput(config.maxInput);
    return (
      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">Username:</span>{' '}
          <span className="font-medium">@{config.username.replace(/^@/, '')}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Max leads: {max != null ? max : 'all available'}
        </div>
      </div>
    );
  }
  if (mode === 'scrape_by_post') {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground">URL:</span>{' '}
        <span className="break-all font-medium">{config.postUrl}</span>
      </div>
    );
  }
  if (mode === 'scrape_by_hashtag') {
    return (
      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">Hashtag:</span>{' '}
          <span className="font-medium">#{config.hashtag.replace(/^#/, '')}</span>
        </div>
        <DateRangeSummary from={config.fromDate} to={config.toDate} />
      </div>
    );
  }
  return (
    <div className="text-sm">
      <div>
        <span className="text-muted-foreground">Location:</span>{' '}
        <span className="break-all font-medium">{config.locationUrl}</span>
      </div>
      <DateRangeSummary from={config.fromDate} to={config.toDate} />
    </div>
  );
}

function DateRangeSummary({ from, to }: { from: string; to: string }) {
  if (!from && !to) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Date range: everything visible
      </div>
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground">
      Date range: {from || '—'} → {to || '—'}
    </div>
  );
}

function CategorySummary({ value }: { value: CategorySelection }) {
  const [categories, setCategories] = useState<LeadCategoryPublic[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await b2dm.categories.list();
      if (!cancelled) setCategories(list);
    })();
    const off = b2dm.categories.onChange(async () => {
      const list = await b2dm.categories.list();
      if (!cancelled) setCategories(list);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  if (value.mode === 'none') {
    return <span className="text-sm text-muted-foreground">No category</span>;
  }
  const cat = categories?.find((c) => c.id === value.categoryId);
  return (
    <div className="flex items-center gap-2 text-sm">
      <Tag className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium">{cat?.name ?? '…'}</span>
    </div>
  );
}

function parseMaxInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
