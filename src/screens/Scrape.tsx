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
  Users,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/common/Spinner';
import { AccountStep } from '@/components/common/AccountStep';
import { Stepper } from '@/components/common/Stepper';
import { SummaryCard } from '@/components/common/SummaryCard';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
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
    hint: 'Commenters + likers of posts tagged with the hashtag',
    icon: Hash,
  },
  {
    id: 'scrape_by_location',
    label: 'By location',
    hint: 'Commenters + likers of posts tagged at the location',
    icon: MapPin,
  },
];

export function Scrape() {
  const { accounts: allAccounts, usableAccounts: accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('scrape_by_username');

  const [username, setUsername] = useState('');
  const [maxInput, setMaxInput] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [category, setCategory] = useState<CategorySelection>({ mode: 'none' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [wasEnqueued, setWasEnqueued] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  );

  const config = useMemo(
    () => ({ username, maxInput, postUrl, hashtag, locationUrl }),
    [username, maxInput, postUrl, hashtag, locationUrl]
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
    const enqueued = selectedAccount?.status === 'busy';
    try {
      const categoryPayload =
        category.mode === 'existing' ? { categoryId: category.categoryId } : {};

      const max = parseMaxInput(maxInput);
      const maxPayload = max != null ? { max } : {};
      let params: Record<string, unknown> = { ...categoryPayload };
      if (mode === 'scrape_by_username') {
        params = { ...params, username, ...maxPayload };
      } else if (mode === 'scrape_by_post') {
        params = { ...params, postUrl };
      } else if (mode === 'scrape_by_hashtag') {
        params = { ...params, hashtag, ...maxPayload };
      } else if (mode === 'scrape_by_location') {
        params = { ...params, locationUrl, ...maxPayload };
      }
      const jobId = await b2dm.jobs.startScrape({ accountId, kind: mode, params });
      setWasEnqueued(enqueued);
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
    setCategory({ mode: 'none' });
    setError(null);
    setStartedJobId(null);
    setWasEnqueued(false);
  }

  if (allAccounts.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="Add an Instagram account first"
        description="Scrapes run from a signed-in account."
        action={
          <EmptyStateLinkButton to="/accounts" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            Add accounts
          </EmptyStateLinkButton>
        }
      />
    );
  }

  if (startedJobId) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <div className="border border-border bg-background">
          <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {wasEnqueued ? 'Scrape queued' : 'Scrape started'}
          </div>
          <div className="p-4">
            <div className="flex items-center gap-2 text-sm">
              <Spinner className="h-4 w-4" />
              <span>
                {wasEnqueued
                  ? 'The account is busy — this scrape will start once earlier jobs finish. Track it in the Queue.'
                  : 'Watch the status bar for progress.'}
              </span>
            </div>
          </div>
          <div className="flex items-stretch border-t border-border">
            <Link
              to="/data"
              className="inline-flex h-9 items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              View data
            </Link>
            <Link
              to="/categories"
              className="inline-flex h-9 items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              View categories
            </Link>
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Queue another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-4">
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

      <div className="py-4">
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
            willEnqueue={selectedAccount?.status === 'busy'}
            onEditAccount={() => setStep(1)}
            onEditScrape={() => setStep(2)}
          />
        ) : null}
      </div>

      <div className="flex items-stretch">
        <button
          type="button"
          onClick={back}
          disabled={step === 1}
          className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <div className="flex-1" />
        {step < 3 ? (
          <button
            type="button"
            onClick={next}
            disabled={!canContinue[step]}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Continue
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={confirmAndStart}
            disabled={submitting || !canContinue[step]}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {submitting
              ? selectedAccount?.status === 'busy'
                ? 'Enqueuing…'
                : 'Starting…'
              : selectedAccount?.status === 'busy'
              ? 'Add to queue'
              : 'Start scrape'}
          </button>
        )}
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
  category: CategorySelection;
  onCategoryChange: (c: CategorySelection) => void;
  submitting: boolean;
}) {
  const activeHint = MODES.find((m) => m.id === mode)?.hint;
  return (
    <div className="flex flex-col gap-3">
      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Method
        </div>
        <div className="flex items-stretch border-b border-border">
          {MODES.map((m, idx) => {
            const Icon = m.icon;
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onModeChange(m.id)}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-2 text-xs font-medium transition-colors',
                  idx !== MODES.length - 1 && 'border-r border-border',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>
        {activeHint ? (
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {activeHint}
          </div>
        ) : null}

        <div className="space-y-2 p-3">
          {mode === 'scrape_by_username' ? (
            <>
              <Input
                id="sc-user"
                className="rounded-none"
                value={config.username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Target username (e.g. @nike)"
              />
              <Input
                id="sc-max"
                type="number"
                min={1}
                className="rounded-none"
                value={config.maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="Max leads (blank = all)"
              />
            </>
          ) : null}

          {mode === 'scrape_by_post' ? (
            <Input
              id="sc-post"
              className="rounded-none"
              value={config.postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder="Post or reel URL (https://www.instagram.com/p/… or /reel/…)"
            />
          ) : null}

          {mode === 'scrape_by_hashtag' ? (
            <>
              <Input
                id="sc-tag"
                className="rounded-none"
                value={config.hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                placeholder="Hashtag (no #, e.g. travel)"
              />
              <Input
                id="sc-tag-max"
                type="number"
                min={1}
                className="rounded-none"
                value={config.maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="Max leads (blank = all)"
              />
            </>
          ) : null}

          {mode === 'scrape_by_location' ? (
            <>
              <Input
                id="sc-loc"
                className="rounded-none"
                value={config.locationUrl}
                onChange={(e) => setLocationUrl(e.target.value)}
                placeholder="Location URL or ID"
              />
              <Input
                id="sc-loc-max"
                type="number"
                min={1}
                className="rounded-none"
                value={config.maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="Max leads (blank = all)"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Category
        </div>
        <div className="space-y-2 p-3">
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
  willEnqueue,
  onEditAccount,
  onEditScrape,
}: {
  account: { username: string; profilePicUrl: string | null } | null;
  mode: Mode;
  config: ConfigState;
  category: CategorySelection;
  error: string | null;
  willEnqueue: boolean;
  onEditAccount: () => void;
  onEditScrape: () => void;
}) {
  const modeDef = MODES.find((m) => m.id === mode)!;
  const ModeIcon = modeDef.icon;

  return (
    <div className="flex flex-col gap-2">
      <SummaryCard title="Account" onEdit={onEditAccount}>
        {account ? (
          <div className="flex items-center gap-2.5">
            {account.profilePicUrl ? (
              <img
                src={account.profilePicUrl}
                alt={account.username}
                referrerPolicy="no-referrer"
                className="h-6 w-6 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Instagram className="h-3 w-3" />
              </div>
            )}
            <span className="text-sm font-medium">@{account.username}</span>
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

      {willEnqueue ? (
        <p className="text-[11px] text-muted-foreground">
          This account is busy. The scrape will be added to its queue and start once the
          current jobs finish.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
    const max = parseMaxInput(config.maxInput);
    return (
      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">Hashtag:</span>{' '}
          <span className="font-medium">#{config.hashtag.replace(/^#/, '')}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Max leads: {max != null ? max : 'all available'}
        </div>
      </div>
    );
  }
  const max = parseMaxInput(config.maxInput);
  return (
    <div className="text-sm">
      <div>
        <span className="text-muted-foreground">Location:</span>{' '}
        <span className="break-all font-medium">{config.locationUrl}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Max leads: {max != null ? max : 'all available'}
      </div>
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
