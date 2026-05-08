import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  FolderTree,
  Heart,
  Inbox,
  Instagram,
  Keyboard,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Send,
  Trash2,
  UploadCloud,
  UserPlus,
  Play,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/common/Spinner';
import { AccountStep } from '@/components/common/AccountStep';
import { CategoryChip } from '@/components/common/CategoryChip';
import { Stepper } from '@/components/common/Stepper';
import { SummaryCard } from '@/components/common/SummaryCard';
import { EmptyPanel } from '@/components/common/EmptyPanel';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { JobStartedPanel } from '@/components/common/JobStartedPanel';
import { ScrapeSummaryOf } from '@/components/common/ScrapeSummary';
import { useAccounts } from '@/context/AccountsContext';
import { monchoops } from '@/lib/monchoops';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type {
  AccountPublic,
  LeadCategoryPublic,
  MassDmInteractionsConfig,
  MessageVariantGroupPublic,
  ScrapeResultPublic,
} from '@/types/domain';

const MAX_VARIANTS = 20;
const MAX_LIKE_COUNT = 5;

type Step = 1 | 2 | 3 | 4 | 5;

type SourceKind = 'file' | 'job' | 'category' | 'manual';

interface Source {
  kind: SourceKind;
  path: string;
  count: number;
  label: string;
  refIds?: string[];
  labels?: string[];
}

interface InteractionsState {
  enabled: boolean;
  follow: boolean;
  likeCount: number;
  watchStories: boolean;
  storyDwellSec: number;
}

const DEFAULT_INTERACTIONS: InteractionsState = {
  enabled: false,
  follow: false,
  likeCount: 0,
  watchStories: false,
  storyDwellSec: 3,
};

function interactionsHaveEffect(s: InteractionsState): boolean {
  return s.enabled && (s.follow || s.likeCount > 0 || s.watchStories);
}

function formatKind(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function interactionsPayload(s: InteractionsState): MassDmInteractionsConfig | null {
  if (!interactionsHaveEffect(s)) return null;
  return {
    follow: s.follow,
    likeCount: s.likeCount,
    watchStories: s.watchStories,
    storyDwellSec: s.storyDwellSec,
  };
}

export function MassDMs() {
  const { t } = useTranslation();
  const { accounts: allAccounts, usableAccounts: accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [variants, setVariants] = useState<string[]>(['']);
  const [intervalSec, setIntervalSec] = useState(60);
  const [interactions, setInteractions] = useState<InteractionsState>(DEFAULT_INTERACTIONS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [wasEnqueued, setWasEnqueued] = useState(false);
  const [alreadyDmed, setAlreadyDmed] = useState<string[]>([]);
  const [alreadyDmedLoading, setAlreadyDmedLoading] = useState(false);
  const [skipAlreadyDmed, setSkipAlreadyDmed] = useState(true);

  const STEP_LABELS = [
    t('screens.massDms.stepAccount'),
    t('screens.massDms.stepLeads'),
    t('screens.massDms.stepMessage'),
    t('screens.massDms.stepInteractions'),
    t('screens.massDms.stepReview'),
  ] as const;

  const nonEmptyVariants = useMemo(
    () => variants.map((v) => v.trim()).filter((v) => v.length > 0),
    [variants]
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId]
  );

  const canContinue: Record<Step, boolean> = {
    1: !!accountId,
    2: !!source,
    3: nonEmptyVariants.length > 0 && intervalSec >= 30,
    4: true,
    5: true,
  };

  function goTo(next: Step) {
    if (next < step || canContinue[step]) setStep(next);
  }
  function next() {
    if (!canContinue[step]) return;
    if (step === 4 && interactions.enabled && !interactionsHaveEffect(interactions)) {
      setInteractions((prev) => ({ ...prev, enabled: false }));
    }
    if (step < 5) setStep((step + 1) as Step);
  }
  function back() {
    if (step > 1) setStep((step - 1) as Step);
  }

  async function confirmAndStart() {
    if (!accountId || !source || nonEmptyVariants.length === 0) return;
    setSubmitting(true);
    setError(null);
    const enqueued = selectedAccount?.status === 'busy';
    try {
      const jobId = await monchoops.jobs.startMassDm({
        accountId,
        usernamesCsvPath: source.path,
        messages: nonEmptyVariants,
        intervalMs: Math.max(30_000, intervalSec * 1000),
        interactions: interactionsPayload(interactions),
        excludeUsernames: skipAlreadyDmed && alreadyDmed.length > 0 ? alreadyDmed : null,
      });
      setWasEnqueued(enqueued);
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('screens.massDms.couldNotStartJob'));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (step !== 5 || !accountId || !source) {
      setAlreadyDmed([]);
      return;
    }
    let cancelled = false;
    setAlreadyDmedLoading(true);
    (async () => {
      try {
        const [sourceUsers, dmed] = await Promise.all([
          monchoops.csv.listUsernames(source.path),
          monchoops.massDms.listDmedUsernames(accountId),
        ]);
        if (cancelled) return;
        const dmedSet = new Set(dmed.map((u) => u.toLowerCase()));
        const intersection = sourceUsers.filter((u) => dmedSet.has(u.toLowerCase()));
        setAlreadyDmed(intersection);
      } catch {
        if (!cancelled) setAlreadyDmed([]);
      } finally {
        if (!cancelled) setAlreadyDmedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, accountId, source]);

  function resetAll() {
    setStep(1);
    setAccountId(null);
    setSource(null);
    setVariants(['']);
    setIntervalSec(60);
    setInteractions(DEFAULT_INTERACTIONS);
    setError(null);
    setStartedJobId(null);
    setWasEnqueued(false);
    setAlreadyDmed([]);
    setSkipAlreadyDmed(true);
  }

  if (allAccounts.length === 0) {
    return (
      <EmptyState
        icon={<Send className="h-10 w-10" />}
        title={t('screens.massDms.noAccountTitle')}
        description={t('screens.massDms.noAccountDescription')}
        action={
          <EmptyStateLinkButton to="/accounts" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            {t('screens.massDms.addAccounts')}
          </EmptyStateLinkButton>
        }
      />
    );
  }

  if (startedJobId) {
    return (
      <JobStartedPanel
        jobId={startedJobId}
        kind="dm"
        wasEnqueued={wasEnqueued}
        onReset={resetAll}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-4 py-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('screens.massDms.title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('screens.massDms.subtitle')}</p>
      <Stepper
        labels={STEP_LABELS}
        current={step}
        onJump={(s) => goTo(s as Step)}
        canJump={(s) => s < step || canContinue[step]}
      />

      <div className="py-4">
        {step === 1 ? (
          <AccountStep
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
          />
        ) : null}

        {step === 2 ? (
          <LeadsStep value={source} onChange={setSource} />
        ) : null}

        {step === 3 ? (
          <MessageStep
            variants={variants}
            onVariantsChange={setVariants}
            intervalSec={intervalSec}
            onIntervalChange={setIntervalSec}
          />
        ) : null}

        {step === 4 ? (
          <InteractionsStep value={interactions} onChange={setInteractions} />
        ) : null}

        {step === 5 ? (
          <ReviewStep
            account={selectedAccount}
            source={source}
            variants={nonEmptyVariants}
            intervalSec={intervalSec}
            interactions={interactions}
            error={error}
            willEnqueue={selectedAccount?.status === 'busy'}
            alreadyDmed={alreadyDmed}
            alreadyDmedLoading={alreadyDmedLoading}
            skipAlreadyDmed={skipAlreadyDmed}
            onToggleSkipAlreadyDmed={setSkipAlreadyDmed}
            onEditAccount={() => setStep(1)}
            onEditLeads={() => setStep(2)}
            onEditMessage={() => setStep(3)}
            onEditInteractions={() => setStep(4)}
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
        {step < 5 ? (
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
            disabled={submitting || !accountId || !source || nonEmptyVariants.length === 0}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {submitting
              ? selectedAccount?.status === 'busy'
                ? t('screens.massDms.enqueuing')
                : t('common.starting')
              : selectedAccount?.status === 'busy'
              ? t('screens.massDms.addToQueue')
              : t('screens.massDms.startJob')}
          </button>
        )}
      </div>
    </div>
  );
}

type LeadsTab = 'file' | 'job' | 'category' | 'manual';

interface LeadsTabDef {
  id: LeadsTab;
  labelKey: string;
  icon: typeof FileUp;
}

const LEADS_TABS: LeadsTabDef[] = [
  { id: 'file', labelKey: 'screens.massDms.leadsTabFile', icon: UploadCloud },
  { id: 'job', labelKey: 'screens.massDms.leadsTabJob', icon: Inbox },
  { id: 'category', labelKey: 'screens.massDms.leadsTabCategory', icon: FolderTree },
  { id: 'manual', labelKey: 'screens.massDms.leadsTabManual', icon: Keyboard },
];

function LeadsStep({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LeadsTab>(() =>
    value?.kind === 'job'
      ? 'job'
      : value?.kind === 'category'
      ? 'category'
      : value?.kind === 'manual'
      ? 'manual'
      : 'file'
  );

  return (
    <div className="overflow-hidden border border-border bg-background">
      <div className="flex items-stretch border-b border-border">
        {LEADS_TABS.map((tabDef, idx) => {
          const Icon = tabDef.icon;
          const active = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              onClick={() => setTab(tabDef.id)}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                idx !== LEADS_TABS.length - 1 && 'border-r border-border',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(tabDef.labelKey)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col">
        {tab === 'file' ? <FilePanel value={value} onChange={onChange} /> : null}
        {tab === 'job' ? <JobsPanel value={value} onChange={onChange} /> : null}
        {tab === 'category' ? <CategoryPanel value={value} onChange={onChange} /> : null}
        {tab === 'manual' ? <ManualPanel value={value} onChange={onChange} /> : null}
      </div>
    </div>
  );
}

function ManualPanel({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<string[]>(() =>
    value?.kind === 'manual' && value.refIds && value.refIds.length > 0
      ? [...value.refIds]
      : ['']
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function update(i: number, val: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? val : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, '']);
  }
  function removeRow(i: number) {
    setRows((prev) => (prev.length <= 1 ? [''] : prev.filter((_, idx) => idx !== i)));
  }

  useEffect(() => {
    const cleaned = rows
      .map((r) => r.trim().replace(/^[@#]+/, '').trim())
      .filter((r) => r.length > 0);
    const dedup = Array.from(new Set(cleaned));
    if (dedup.length === 0) {
      if (value?.kind === 'manual') onChange(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setBusy(true);
      setErr(null);
      void (async () => {
        try {
          const res = await monchoops.csv.persistFromUsernames(dedup);
          if (cancelled) return;
          const label =
            dedup.length === 1
              ? t('screens.massDms.manualOneLabel', { username: dedup[0] })
              : t('screens.massDms.manualManyLabel', { count: dedup.length });
          onChange({
            kind: 'manual',
            path: res.path,
            count: res.count,
            label,
            refIds: rows,
            labels: dedup.map((u) => `@${u}`),
          });
        } catch (e) {
          if (!cancelled) setErr(e instanceof Error ? e.message : t('screens.massDms.couldNotSaveList'));
        } finally {
          if (!cancelled) setBusy(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };

  }, [rows]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{t('screens.massDms.manualUsernames')}</span>
        <span className="normal-case font-normal">
          {value?.kind === 'manual'
            ? t('screens.massDms.manualUniqueCount', { count: value.count })
            : t('screens.massDms.manualEmpty')}
          {busy ? t('screens.massDms.manualSaving') : ''}
        </span>
      </div>
      <div className="max-h-[42vh] space-y-2 overflow-auto p-3">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder={
                i === 0
                  ? t('screens.massDms.manualPlaceholderFirst')
                  : t('screens.massDms.manualPlaceholderNth', { n: i + 1 })
              }
              value={row}
              onChange={(e) => update(i, e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={rows.length <= 1 && row.trim().length === 0}
              aria-label={t('screens.massDms.manualRemove', { n: i + 1 })}
              className="inline-flex h-9 w-9 flex-none items-center justify-center bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40 disabled:hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('screens.massDms.addUsername')}
        </button>
      </div>
      {err ? (
        <p className="border-t border-border px-3 py-2 text-xs text-destructive">{err}</p>
      ) : null}
    </div>
  );
}

function FilePanel({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = value?.kind === 'file' ? value : null;

  async function handleFile(srcPath: string, fallbackName?: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await monchoops.csv.persistFromPath(srcPath);
      const label = fallbackName ?? srcPath.split(/[\\/]/).pop() ?? 'file';
      onChange({ kind: 'file', path: res.path, count: res.count, label });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('screens.massDms.couldNotLoadFile'));
    } finally {
      setLoading(false);
    }
  }

  async function pickDialog() {
    setLoading(true);
    setErr(null);
    try {
      const res = await monchoops.csv.pickAndPersist();
      if (!res) return;
      const label = res.path.split(/[\\/]/).pop() ?? 'file';
      onChange({ kind: 'file', path: res.path, count: res.count, label });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('screens.massDms.couldNotLoadFile'));
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const anyFile = file as File & { path?: string };
    if (anyFile.path) void handleFile(anyFile.path, file.name);
    else setErr(t('screens.massDms.fileDragNotSupported'));
  }

  return (
    <div className="p-3">
      <div
        role="button"
        tabIndex={loading ? -1 : 0}
        onClick={() => !loading && void pickDialog()}
        onKeyDown={(e) => {
          if (!loading && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            void pickDialog();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-[50vh] cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-accent',
          dragOver && 'border-primary bg-primary/5',
          loading && 'cursor-wait opacity-60'
        )}
      >
        {loading ? (
          <Spinner className="h-6 w-6 text-muted-foreground" />
        ) : active ? (
          <Check className="h-8 w-8 text-primary" />
        ) : (
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
        )}
        <div className="text-sm font-medium">
          {active ? active.label : t('screens.massDms.fileEmpty')}
        </div>
        <div className="text-xs text-muted-foreground">
          {active
            ? t('screens.massDms.fileUsernamesCount', { count: active.count })
            : t('screens.massDms.fileFormatHint')}
        </div>
        {active ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
            {t('screens.massDms.fileClear')}
          </button>
        ) : null}
      </div>
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

function JobsPanel({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ScrapeResultPublic[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(value?.kind === 'job' ? value.refIds ?? [] : []),
    [value]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await monchoops.scrapes.list();
      if (!cancelled) setRows(list);
    })();
    const off = monchoops.jobs.onDone(async () => {
      const list = await monchoops.scrapes.list();
      if (!cancelled) setRows(list);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.summary, r.kind, r.targetName ?? '', r.categoryName ?? ''].join(' ').toLowerCase().includes(q)
    );
  }, [rows, query]);

  async function toggle(row: ScrapeResultPublic) {
    const next = new Set(selectedIds);
    if (next.has(row.jobId)) next.delete(row.jobId);
    else next.add(row.jobId);

    if (next.size === 0) {
      onChange(null);
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const ids = Array.from(next);
      const res = await monchoops.csv.persistFromScrapes(ids);
      const labels = ids
        .map((id) => (rows ?? []).find((r) => r.jobId === id)?.summary)
        .filter((s): s is string => !!s);
      const label =
        labels.length === 1
          ? labels[0]!
          : t('screens.massDms.scrapesManyLabel', { count: labels.length });
      onChange({
        kind: 'job',
        path: res.path,
        count: res.count,
        label,
        refIds: ids,
        labels,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('screens.massDms.couldNotLoadScrape'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex items-stretch border-b border-border bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.massDms.scrapesSearchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex h-[50vh] flex-col overflow-auto">
        {rows === null ? (
          <div className="flex items-center justify-center p-6">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<Inbox className="h-8 w-8" />}
            title={t('screens.massDms.noScrapesTitle')}
            description={t('screens.massDms.noScrapesDescription')}
          />
        ) : filtered!.length === 0 ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title={t('common.noResults')}
            description={t('screens.massDms.scrapesNoMatch')}
            className="py-0"
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableSummary')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableCategory')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.massDms.tableLeads')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableCompleted')}</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filtered!.map((row) => {
                const selected = selectedIds.has(row.jobId);
                return (
                  <tr
                    key={row.jobId}
                    onClick={() => void toggle(row)}
                    className={cn(
                      'cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40',
                      selected && 'bg-primary/5 hover:bg-primary/10',
                      busy && 'opacity-60'
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <ScrapeSummaryOf row={row} className="text-sm font-medium" />
                      <div className="text-[11px] text-muted-foreground">
                        {formatKind(row.kind)}
                        {row.accountUsername ? (
                          <>
                            {' '}
                            {t('screens.queue.withAccount')}{' '}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void monchoops.openExternalLink(
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
                    <td className="w-8 px-2 py-1.5 text-right">
                      {selected ? (
                        <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {err ? <p className="border-t border-border px-3 py-2 text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

function CategoryPanel({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LeadCategoryPublic[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedIds = useMemo(
    () => new Set(value?.kind === 'category' ? value.refIds ?? [] : []),
    [value]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await monchoops.categories.list();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = monchoops.categories.onChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  async function toggle(row: LeadCategoryPublic) {
    if (row.leadCount === 0) return;
    const next = new Set(selectedIds);
    if (next.has(row.id)) next.delete(row.id);
    else next.add(row.id);

    if (next.size === 0) {
      onChange(null);
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const ids = Array.from(next);
      const res = await monchoops.csv.persistFromCategories(ids);
      const labels = ids
        .map((id) => (rows ?? []).find((r) => r.id === id)?.name)
        .filter((s): s is string => !!s);
      const label =
        labels.length === 1
          ? labels[0]!
          : t('screens.massDms.categoriesManyLabel', { count: labels.length });
      onChange({
        kind: 'category',
        path: res.path,
        count: res.count,
        label,
        refIds: ids,
        labels,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('screens.massDms.couldNotLoadCategory'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex items-stretch border-b border-border bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.massDms.categoriesSearchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex h-[50vh] flex-col overflow-auto">
        {rows === null ? (
          <div className="flex items-center justify-center p-6">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<FolderTree className="h-8 w-8" />}
            title={t('screens.massDms.noCategoriesTitle')}
            description={t('screens.massDms.noCategoriesDescription')}
          />
        ) : filtered!.length === 0 ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title={t('common.noResults')}
            description={t('screens.massDms.categoriesNoMatch')}
            className="py-0"
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableName')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.massDms.tableLeads')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableLastActivity')}</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filtered!.map((row) => {
                const selected = selectedIds.has(row.id);
                const disabled = row.leadCount === 0;
                return (
                  <tr
                    key={row.id}
                    onClick={() => !disabled && void toggle(row)}
                    className={cn(
                      'border-t border-border transition-colors even:bg-muted/30 last:border-b',
                      !disabled && 'cursor-pointer hover:bg-accent/40',
                      selected && 'bg-primary/5 hover:bg-primary/10',
                      disabled && 'cursor-not-allowed opacity-50',
                      busy && 'opacity-60'
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <CategoryChip name={row.name} />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{row.leadCount}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {formatDateTime(row.lastActivityAt)}
                    </td>
                    <td className="w-8 px-2 py-1.5 text-right">
                      {selected ? (
                        <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {err ? <p className="border-t border-border px-3 py-2 text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

type MessageTab = 'write' | 'saved';

interface MessageTabDef {
  id: MessageTab;
  labelKey: string;
  icon: typeof Pencil;
}

const MESSAGE_TABS: MessageTabDef[] = [
  { id: 'write', labelKey: 'screens.massDms.messageTabWrite', icon: Pencil },
  { id: 'saved', labelKey: 'screens.massDms.messageTabSaved', icon: MessageSquareText },
];

function MessageStep({
  variants,
  onVariantsChange,
  intervalSec,
  onIntervalChange,
}: {
  variants: string[];
  onVariantsChange: (v: string[]) => void;
  intervalSec: number;
  onIntervalChange: (n: number) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MessageTab>('write');

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden border border-border bg-background">
        <div className="flex items-stretch border-b border-border">
          {MESSAGE_TABS.map((tabDef, idx) => {
            const Icon = tabDef.icon;
            const active = tab === tabDef.id;
            return (
              <button
                key={tabDef.id}
                type="button"
                onClick={() => setTab(tabDef.id)}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  idx !== MESSAGE_TABS.length - 1 && 'border-r border-border',
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(tabDef.labelKey)}
              </button>
            );
          })}
        </div>

        {tab === 'write' ? (
          <WriteVariantsPanel variants={variants} onChange={onVariantsChange} />
        ) : (
          <SavedVariantsPanel
            onLoad={(loaded) => {
              onVariantsChange(loaded);
              setTab('write');
            }}
          />
        )}
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t('screens.massDms.pace')}
        </div>
        <div className="space-y-1 p-3">
          <Label htmlFor="dm-interval">{t('screens.massDms.intervalLabel')}</Label>
          <Input
            id="dm-interval"
            type="number"
            min={30}
            max={600}
            value={intervalSec}
            onChange={(e) =>
              onIntervalChange(Math.max(30, Math.min(600, Number(e.target.value) || 60)))
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {t('screens.massDms.intervalHint')}
          </p>
        </div>
      </div>
    </div>
  );
}

function WriteVariantsPanel({
  variants,
  onChange,
}: {
  variants: string[];
  onChange: (v: string[]) => void;
}) {
  const { t } = useTranslation();
  const nonEmpty = variants.filter((v) => v.trim().length > 0).length;

  function updateVariant(i: number, value: string) {
    onChange(variants.map((v, idx) => (idx === i ? value : v)));
  }
  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return;
    onChange([...variants, '']);
  }
  function removeVariant(i: number) {
    if (variants.length <= 1) return;
    onChange(variants.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{t('screens.massDms.messageVariantsTitle')}</span>
        <span className="normal-case font-normal">
          {t('screens.massDms.variantsCount', { n: nonEmpty, max: MAX_VARIANTS })}
          <code className="rounded bg-background px-1 py-0.5 text-[10px]">{'{{username}}'}</code>
        </span>
      </div>
      <div className="max-h-[45vh] space-y-2 overflow-auto p-3">
        {variants.map((value, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea
              rows={3}
              placeholder={
                i === 0
                  ? t('screens.massDms.variantPlaceholderFirst')
                  : t('screens.massDms.variantPlaceholderNth', { n: i + 1 })
              }
              value={value}
              onChange={(e) => updateVariant(i, e.target.value)}
            />
            <button
              type="button"
              onClick={() => removeVariant(i)}
              disabled={variants.length <= 1}
              aria-label={t('screens.massDms.removeVariant', { n: i + 1 })}
              className="inline-flex h-9 w-9 flex-none items-center justify-center bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40 disabled:hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2">
        <button
          type="button"
          onClick={addVariant}
          disabled={variants.length >= MAX_VARIANTS}
          className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('screens.massDms.addVariant')}
        </button>
      </div>
    </div>
  );
}

function SavedVariantsPanel({ onLoad }: { onLoad: (variants: string[]) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MessageVariantGroupPublic[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await monchoops.messageVariants.list();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = monchoops.messageVariants.onChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  function pick(group: MessageVariantGroupPublic) {
    const snapshot = group.variants.length > 0 ? [...group.variants] : [''];
    onLoad(snapshot);
  }

  return (
    <div className="flex flex-col overflow-hidden">
      <div className="flex items-stretch border-b border-border bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.massDms.savedSearchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex h-[45vh] flex-col overflow-auto">
        {rows === null ? (
          <div className="flex items-center justify-center p-6">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<MessageSquareText className="h-8 w-8" />}
            title={t('screens.massDms.noSavedTitle')}
            description={t('screens.massDms.noSavedDescription')}
          />
        ) : filtered!.length === 0 ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title={t('common.noResults')}
            description={t('screens.massDms.savedNoMatch')}
            className="py-0"
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableName')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.massDms.tableVariants')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.massDms.tableLastUpdated')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered!.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => pick(row)}
                  className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5 font-medium">{row.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.variants.length}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatDateTime(row.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function InteractionsStep({
  value,
  onChange,
}: {
  value: InteractionsState;
  onChange: (s: InteractionsState) => void;
}) {
  const { t } = useTranslation();
  function update(patch: Partial<InteractionsState>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            {t('screens.massDms.interactionsTitle')}
          </span>
          <span className="normal-case font-normal">{t('screens.massDms.interactionsOptional')}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{t('screens.massDms.interactionsWarmTitle')}</div>
            <p className="text-[11px] text-muted-foreground">
              {t('screens.massDms.interactionsWarmDesc')}
            </p>
          </div>
          <Switch
            checked={value.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
      </div>

      {value.enabled ? (
        <>
          <div className="border border-border bg-background">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <UserPlus className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                <div>
                  <div className="font-medium">{t('screens.massDms.followTitle')}</div>
                  <p className="text-[11px] text-muted-foreground">{t('screens.massDms.followDesc')}</p>
                </div>
              </div>
              <Switch
                checked={value.follow}
                onCheckedChange={(follow) => update({ follow })}
              />
            </div>
          </div>

          <div className="border border-border bg-background">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <Heart className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                <div>
                  <div className="font-medium">{t('screens.massDms.likeTitle')}</div>
                  <p className="text-[11px] text-muted-foreground">{t('screens.massDms.likeDesc')}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => update({ likeCount: n })}
                    className={cn(
                      'inline-flex h-8 min-w-[32px] items-center justify-center border border-border px-2 text-xs font-medium transition-colors',
                      value.likeCount === n
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="border border-border bg-background">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                <div>
                  <div className="font-medium">{t('screens.massDms.watchTitle')}</div>
                  <p className="text-[11px] text-muted-foreground">{t('screens.massDms.watchDesc')}</p>
                </div>
              </div>
              <Switch
                checked={value.watchStories}
                onCheckedChange={(watchStories) => update({ watchStories })}
              />
            </div>
            {value.watchStories ? (
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs">
                <span className="text-muted-foreground">{t('screens.massDms.dwellLabel')}</span>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={value.storyDwellSec}
                  onChange={(e) => update({ storyDwellSec: Number(e.target.value) || 3 })}
                  className="h-7 w-16 rounded border border-border bg-transparent px-2 text-right outline-none focus:border-primary"
                />
              </div>
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t('screens.massDms.interactionsFootnote', { max: MAX_LIKE_COUNT })}
          </p>
        </>
      ) : null}
    </div>
  );
}

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function summariseInteractions(s: InteractionsState, t: TFn): string {
  if (!interactionsHaveEffect(s)) return t('screens.massDms.summaryNoInteractions');
  const parts: string[] = [];
  if (s.follow) parts.push(t('screens.massDms.summaryFollow'));
  if (s.likeCount > 0) parts.push(t('screens.massDms.summaryLike', { count: s.likeCount }));
  if (s.watchStories) parts.push(t('screens.massDms.summaryWatch', { secs: s.storyDwellSec }));
  return parts.join(' - ');
}

function ReviewStep({
  account,
  source,
  variants,
  intervalSec,
  interactions,
  error,
  willEnqueue,
  alreadyDmed,
  alreadyDmedLoading,
  skipAlreadyDmed,
  onToggleSkipAlreadyDmed,
  onEditAccount,
  onEditLeads,
  onEditMessage,
  onEditInteractions,
}: {
  account: AccountPublic | null;
  source: Source | null;
  variants: string[];
  intervalSec: number;
  interactions: InteractionsState;
  error: string | null;
  willEnqueue: boolean;
  alreadyDmed: string[];
  alreadyDmedLoading: boolean;
  skipAlreadyDmed: boolean;
  onToggleSkipAlreadyDmed: (skip: boolean) => void;
  onEditAccount: () => void;
  onEditLeads: () => void;
  onEditMessage: () => void;
  onEditInteractions: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel =
    source?.kind === 'file'
      ? t('screens.massDms.summarySourceFile')
      : source?.kind === 'job'
      ? t('screens.massDms.summarySourceJob')
      : source?.kind === 'category'
      ? t('screens.massDms.summarySourceCategory')
      : source?.kind === 'manual'
      ? t('screens.massDms.summarySourceManual')
      : '—';
  const sourcePlural =
    source?.kind === 'category'
      ? t('screens.massDms.sourcePluralCategory')
      : source?.kind === 'job'
      ? t('screens.massDms.sourcePluralJob')
      : source?.kind === 'manual'
      ? t('screens.massDms.sourcePluralManual')
      : t('screens.massDms.sourcePluralFile');

  return (
    <div className="flex flex-col gap-2">
      <SummaryCard title={t('screens.massDms.summaryAccount')} onEdit={onEditAccount}>
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

      <SummaryCard title={t('screens.massDms.summaryLeads')} onEdit={onEditLeads}>
        {source ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {source.labels && source.labels.length > 1
                    ? t('screens.massDms.summarySelectedCount', {
                        count: source.labels.length,
                        plural: sourcePlural,
                      })
                    : source.label.length > 40
                    ? `${source.label.slice(0, 40)}…`
                    : source.label}
                </div>
                <div className="text-[11px] text-muted-foreground">{sourceLabel}</div>
              </div>
              <span className="tabular-nums text-sm">
                {t('screens.massDms.summaryUsernamesCount', { count: source.count })}
              </span>
            </div>
            {source.labels && source.labels.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {source.labels.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="inline-flex max-w-full items-center gap-1.5 border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {source.kind === 'category' ? (
                      <Tag className="h-3 w-3 flex-none" />
                    ) : source.kind === 'job' ? (
                      <Inbox className="h-3 w-3 flex-none" />
                    ) : null}
                    <span className="truncate">{name}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </SummaryCard>

      <SummaryCard
        title={t('screens.massDms.summaryMessageWithVariants', { count: variants.length })}
        onEdit={onEditMessage}
      >
        <div className="space-y-1.5">
          {variants.length === 0 ? (
            <span className="text-sm text-muted-foreground">{t('screens.massDms.summaryNoVariants')}</span>
          ) : (
            variants.map((v, i) => (
              <div
                key={i}
                className="border border-border bg-muted/30 px-2 py-1.5 text-xs"
              >
                {v}
              </div>
            ))
          )}
        </div>
      </SummaryCard>

      <SummaryCard title={t('screens.massDms.summaryPace')} onEdit={onEditMessage}>
        <div className="text-sm">
          {t('screens.massDms.summaryPaceText')} <span className="font-medium">{intervalSec}s</span>
          <span className="ml-1 text-[11px] text-muted-foreground">
            {t('screens.massDms.summaryPaceJitter')}
          </span>
        </div>
      </SummaryCard>

      <SummaryCard title={t('screens.massDms.summaryInteractions')} onEdit={onEditInteractions}>
        <div className="flex items-center gap-2 text-sm">
          {interactionsHaveEffect(interactions) ? (
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          ) : null}
          <span className={interactionsHaveEffect(interactions) ? 'font-medium' : 'text-muted-foreground'}>
            {summariseInteractions(interactions, t)}
          </span>
        </div>
      </SummaryCard>

      {alreadyDmed.length > 0 && source ? (
        <div className="border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">
                {t('screens.massDms.alreadyDmedTitle', {
                  count: alreadyDmed.length,
                  total: source.count,
                  account: account
                    ? `@${account.username}`
                    : t('screens.massDms.alreadyDmedThisAccount'),
                })}
              </div>
              <div className="mt-0.5 text-muted-foreground">
                {skipAlreadyDmed
                  ? t('screens.massDms.alreadyDmedSkipping', {
                      count: source.count - alreadyDmed.length,
                    })
                  : t('screens.massDms.alreadyDmedNotSkipping')}
              </div>
            </div>
            <label className="inline-flex flex-none items-center gap-2">
              <Switch
                checked={skipAlreadyDmed}
                onCheckedChange={(v) => onToggleSkipAlreadyDmed(!!v)}
              />
              <span className="text-[11px] font-medium">{t('screens.massDms.skip')}</span>
            </label>
          </div>
        </div>
      ) : alreadyDmedLoading ? (
        <p className="text-[11px] text-muted-foreground">{t('screens.massDms.alreadyDmedLoading')}</p>
      ) : null}
      {willEnqueue ? (
        <p className="text-[11px] text-muted-foreground">
          {t('screens.massDms.willEnqueue')}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
