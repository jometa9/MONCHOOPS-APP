import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  AtSign,
  FileImage,
  Hash,
  Instagram,
  MapPin,
  Play,
  Users,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/common/Spinner';
import { AccountStep } from '@/components/common/AccountStep';
import { CategoryChip } from '@/components/common/CategoryChip';
import { Stepper } from '@/components/common/Stepper';
import { SummaryCard } from '@/components/common/SummaryCard';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import {
  CategoryPicker,
  type CategorySelection,
} from '@/components/common/CategoryPicker';
import { useAccounts } from '@/context/AccountsContext';
import { JobStartedPanel } from '@/components/common/JobStartedPanel';
import { cn } from '@/lib/cn';
import { b2dm } from '@/lib/b2dm';
import type { LeadCategoryPublic, ScrapeKind } from '@/types/domain';

type Mode = ScrapeKind;
type Step = 1 | 2 | 3;

interface ModeDef {
  id: Mode;
  labelKey: string;
  hintKey: string;
  icon: typeof AtSign;
}

const MODES: ModeDef[] = [
  {
    id: 'scrape_by_username',
    labelKey: 'screens.scrape.modeUsernameLabel',
    hintKey: 'screens.scrape.modeUsernameHint',
    icon: AtSign,
  },
  {
    id: 'scrape_by_post',
    labelKey: 'screens.scrape.modePostLabel',
    hintKey: 'screens.scrape.modePostHint',
    icon: FileImage,
  },
  {
    id: 'scrape_by_hashtag',
    labelKey: 'screens.scrape.modeHashtagLabel',
    hintKey: 'screens.scrape.modeHashtagHint',
    icon: Hash,
  },
  {
    id: 'scrape_by_location',
    labelKey: 'screens.scrape.modeLocationLabel',
    hintKey: 'screens.scrape.modeLocationHint',
    icon: MapPin,
  },
];

export function Scrape() {
  const { t } = useTranslation();
  const { accounts: allAccounts, usableAccounts: accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('scrape_by_username');

  const [username, setUsername] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [postUrl, setPostUrl] = useState('');
  const [hashtag, setHashtag] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [category, setCategory] = useState<CategorySelection>({ mode: 'none' });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [wasEnqueued, setWasEnqueued] = useState(false);

  const STEP_LABELS = [
    t('screens.scrape.stepAccount'),
    t('screens.scrape.stepScrape'),
    t('screens.scrape.stepReview'),
  ] as const;

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  );

  const config = useMemo(
    () => ({ username, targetInput, postUrl, hashtag, locationUrl }),
    [username, targetInput, postUrl, hashtag, locationUrl]
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

      const target = parseTargetInput(targetInput);
      const targetPayload = target != null ? { target } : {};
      let params: Record<string, unknown> = { ...categoryPayload };
      if (mode === 'scrape_by_username') {
        params = { ...params, username, ...targetPayload };
      } else if (mode === 'scrape_by_post') {
        params = { ...params, postUrl };
      } else if (mode === 'scrape_by_hashtag') {
        params = { ...params, hashtag, ...targetPayload };
      } else if (mode === 'scrape_by_location') {
        params = { ...params, locationUrl, ...targetPayload };
      }
      const jobId = await b2dm.jobs.startScrape({ accountId, kind: mode, params });
      setWasEnqueued(enqueued);
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.scrape.couldNotStart'));
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStep(1);
    setAccountId(null);
    setMode('scrape_by_username');
    setUsername('');
    setTargetInput('');
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
        title={t('screens.scrape.noAccountTitle')}
        description={t('screens.scrape.noAccountDescription')}
        action={
          <EmptyStateLinkButton to="/accounts" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            {t('screens.scrape.addAccounts')}
          </EmptyStateLinkButton>
        }
      />
    );
  }

  if (startedJobId) {
    return (
      <JobStartedPanel
        jobId={startedJobId}
        kind="scrape"
        wasEnqueued={wasEnqueued}
        onReset={resetAll}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('screens.scrape.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('screens.scrape.subtitle')}</p>
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
            setTargetInput={setTargetInput}
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
          {t('common.back')}
        </button>
        <div className="flex-1" />
        {step < 3 ? (
          <button
            type="button"
            onClick={next}
            disabled={!canContinue[step]}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {t('common.continue')}
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
                ? t('screens.scrape.enqueuing')
                : t('common.starting')
              : selectedAccount?.status === 'busy'
              ? t('screens.scrape.addToQueue')
              : t('screens.scrape.startScrape')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 2: Scrape config ---------------- */

interface ConfigState {
  username: string;
  targetInput: string;
  postUrl: string;
  hashtag: string;
  locationUrl: string;
}

function ScrapeConfigStep({
  mode,
  onModeChange,
  config,
  setUsername,
  setTargetInput,
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
  setTargetInput: (v: string) => void;
  setPostUrl: (v: string) => void;
  setHashtag: (v: string) => void;
  setLocationUrl: (v: string) => void;
  category: CategorySelection;
  onCategoryChange: (c: CategorySelection) => void;
  submitting: boolean;
}) {
  const { t } = useTranslation();
  const activeMode = MODES.find((m) => m.id === mode);
  const activeHint = activeMode ? t(activeMode.hintKey) : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('screens.scrape.method')}
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
                {t(m.labelKey)}
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
                placeholder={t('screens.scrape.usernamePlaceholder')}
              />
              <Input
                id="sc-target"
                type="number"
                min={1}
                className="rounded-none"
                value={config.targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder={t('screens.scrape.targetLeadsPlaceholder')}
              />
            </>
          ) : null}

          {mode === 'scrape_by_post' ? (
            <Input
              id="sc-post"
              className="rounded-none"
              value={config.postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder={t('screens.scrape.postUrlPlaceholder')}
            />
          ) : null}

          {mode === 'scrape_by_hashtag' ? (
            <>
              <Input
                id="sc-tag"
                className="rounded-none"
                value={config.hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                placeholder={t('screens.scrape.hashtagPlaceholder')}
              />
              <Input
                id="sc-tag-target"
                type="number"
                min={1}
                className="rounded-none"
                value={config.targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder={t('screens.scrape.targetLeadsPlaceholder')}
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
                placeholder={t('screens.scrape.locationPlaceholder')}
              />
              <Input
                id="sc-loc-target"
                type="number"
                min={1}
                className="rounded-none"
                value={config.targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder={t('screens.scrape.targetLeadsPlaceholder')}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('screens.scrape.category')}
        </div>
        <div className="space-y-2 p-3">
          <CategoryPicker
            value={category}
            onChange={onCategoryChange}
            disabled={submitting}
          />
          <p className="text-[11px] text-muted-foreground">
            {t('screens.scrape.categoryHint')}
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
  const { t } = useTranslation();
  const modeDef = MODES.find((m) => m.id === mode)!;
  const ModeIcon = modeDef.icon;

  return (
    <div className="flex flex-col gap-2">
      <SummaryCard title={t('screens.scrape.summaryAccount')} onEdit={onEditAccount}>
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

      <SummaryCard title={t('screens.scrape.summaryMethod')} onEdit={onEditScrape}>
        <div className="flex items-center gap-2 text-sm">
          <ModeIcon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t(modeDef.labelKey)}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{t(modeDef.hintKey)}</p>
      </SummaryCard>

      <SummaryCard title={t('screens.scrape.summaryTarget')} onEdit={onEditScrape}>
        <TargetSummary mode={mode} config={config} />
      </SummaryCard>

      <SummaryCard title={t('screens.scrape.summaryCategory')} onEdit={onEditScrape}>
        <CategorySummary value={category} />
      </SummaryCard>

      {willEnqueue ? (
        <p className="text-[11px] text-muted-foreground">{t('screens.scrape.willEnqueue')}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function TargetSummary({ mode, config }: { mode: Mode; config: ConfigState }) {
  const { t } = useTranslation();
  if (mode === 'scrape_by_username') {
    const target = parseTargetInput(config.targetInput);
    return (
      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">{t('screens.scrape.targetUsername')}</span>{' '}
          <span className="font-medium">@{config.username.replace(/^@/, '')}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('screens.scrape.targetLeadsLabel')} {target != null ? target : t('screens.scrape.defaultLeads')}
        </div>
      </div>
    );
  }
  if (mode === 'scrape_by_post') {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground">{t('screens.scrape.targetUrl')}</span>{' '}
        <span className="break-all font-medium">{config.postUrl}</span>
      </div>
    );
  }
  if (mode === 'scrape_by_hashtag') {
    const target = parseTargetInput(config.targetInput);
    return (
      <div className="text-sm">
        <div>
          <span className="text-muted-foreground">{t('screens.scrape.targetHashtag')}</span>{' '}
          <span className="font-medium">#{config.hashtag.replace(/^#/, '')}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('screens.scrape.targetLeadsLabel')} {target != null ? target : t('screens.scrape.defaultLeads')}
        </div>
      </div>
    );
  }
  const target = parseTargetInput(config.targetInput);
  return (
    <div className="text-sm">
      <div>
        <span className="text-muted-foreground">{t('screens.scrape.targetLocation')}</span>{' '}
        <span className="break-all font-medium">{config.locationUrl}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {t('screens.scrape.targetLeadsLabel')} {target != null ? target : t('screens.scrape.defaultLeads')}
      </div>
    </div>
  );
}

function CategorySummary({ value }: { value: CategorySelection }) {
  const { t } = useTranslation();
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
    return <span className="text-sm text-muted-foreground">{t('screens.scrape.noCategory')}</span>;
  }
  const cat = categories?.find((c) => c.id === value.categoryId);
  return <CategoryChip name={cat?.name ?? '…'} />;
}

function parseTargetInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}
