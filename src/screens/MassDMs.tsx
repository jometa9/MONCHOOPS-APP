import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  FolderTree,
  Heart,
  Inbox,
  Instagram,
  Plus,
  Search,
  Send,
  Trash2,
  UploadCloud,
  UserPlus,
  Play,
  Sparkles,
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
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type {
  AccountPublic,
  LeadCategoryPublic,
  MassDmInteractionsConfig,
  ScrapeResultPublic,
} from '@/types/domain';

const MAX_VARIANTS = 20;
const MAX_LIKE_COUNT = 5;
const STEP_LABELS = ['Account', 'Leads', 'Message', 'Interactions', 'Review'] as const;

type Step = 1 | 2 | 3 | 4 | 5;

type SourceKind = 'file' | 'job' | 'category';

interface Source {
  kind: SourceKind;
  path: string;
  count: number;
  label: string;
  refIds?: string[];
}

interface InteractionsState {
  enabled: boolean;
  follow: boolean;
  likeCount: number;
}

const DEFAULT_INTERACTIONS: InteractionsState = {
  enabled: false,
  follow: false,
  likeCount: 0,
};

function interactionsHaveEffect(s: InteractionsState): boolean {
  return s.enabled && (s.follow || s.likeCount > 0);
}

function interactionsPayload(s: InteractionsState): MassDmInteractionsConfig | null {
  if (!interactionsHaveEffect(s)) return null;
  return { follow: s.follow, likeCount: s.likeCount };
}

export function MassDMs() {
  const { accounts: allAccounts, usableAccounts: accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [variants, setVariants] = useState<string[]>(['']);
  const [intervalSec, setIntervalSec] = useState(12);
  const [interactions, setInteractions] = useState<InteractionsState>(DEFAULT_INTERACTIONS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);
  const [wasEnqueued, setWasEnqueued] = useState(false);

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
    3: nonEmptyVariants.length > 0 && intervalSec >= 3,
    4: !interactions.enabled || interactions.follow || interactions.likeCount > 0,
    5: true,
  };

  function goTo(next: Step) {
    if (next < step || canContinue[step]) setStep(next);
  }
  function next() {
    if (!canContinue[step]) return;
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
      const jobId = await b2dm.jobs.startMassDm({
        accountId,
        usernamesCsvPath: source.path,
        messages: nonEmptyVariants,
        intervalMs: Math.max(3000, intervalSec * 1000),
        interactions: interactionsPayload(interactions),
      });
      setWasEnqueued(enqueued);
      setStartedJobId(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start job');
    } finally {
      setSubmitting(false);
    }
  }

  function resetAll() {
    setStep(1);
    setAccountId(null);
    setSource(null);
    setVariants(['']);
    setIntervalSec(12);
    setInteractions(DEFAULT_INTERACTIONS);
    setError(null);
    setStartedJobId(null);
    setWasEnqueued(false);
  }

  if (allAccounts.length === 0) {
    return (
      <EmptyState
        icon={<Send className="h-10 w-10" />}
        title="Add an Instagram account first"
        description="Cold DMs run from a signed-in account."
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
      <JobStartedPanel
        jobId={startedJobId}
        kind="dm"
        wasEnqueued={wasEnqueued}
        onReset={resetAll}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-4">
      <h1 className="text-2xl font-semibold tracking-tight">Cold DM</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Five steps: pick the account, the leads, the message, any pre-DM interactions, then review and send.
      </p>
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
          Back
        </button>
        <div className="flex-1" />
        {step < 5 ? (
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
            disabled={submitting || !accountId || !source || nonEmptyVariants.length === 0}
            className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? <Spinner /> : <Play className="h-3.5 w-3.5" />}
            {submitting
              ? selectedAccount?.status === 'busy'
                ? 'Enqueuing…'
                : 'Starting…'
              : selectedAccount?.status === 'busy'
              ? 'Add to queue'
              : 'Start Cold DM job'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 2: Leads ---------------- */

type LeadsTab = 'file' | 'job' | 'category';

const LEADS_TABS: { id: LeadsTab; label: string; icon: typeof FileUp }[] = [
  { id: 'file', label: 'Upload file', icon: UploadCloud },
  { id: 'job', label: 'From a scrape', icon: Inbox },
  { id: 'category', label: 'From a category', icon: FolderTree },
];

function LeadsStep({
  value,
  onChange,
}: {
  value: Source | null;
  onChange: (s: Source | null) => void;
}) {
  const [tab, setTab] = useState<LeadsTab>(() =>
    value?.kind === 'job' ? 'job' : value?.kind === 'category' ? 'category' : 'file'
  );

  return (
    <div className="overflow-hidden border border-border bg-background">
      <div className="flex items-stretch border-b border-border">
        {LEADS_TABS.map((t, idx) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                idx !== LEADS_TABS.length - 1 && 'border-r border-border',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col">
        {tab === 'file' ? <FilePanel value={value} onChange={onChange} /> : null}
        {tab === 'job' ? <JobsPanel value={value} onChange={onChange} /> : null}
        {tab === 'category' ? <CategoryPanel value={value} onChange={onChange} /> : null}
      </div>
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
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const active = value?.kind === 'file' ? value : null;

  async function handleFile(srcPath: string, fallbackName?: string) {
    setLoading(true);
    setErr(null);
    try {
      const res = await b2dm.csv.persistFromPath(srcPath);
      const label = fallbackName ?? srcPath.split(/[\\/]/).pop() ?? 'file';
      onChange({ kind: 'file', path: res.path, count: res.count, label });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load file');
    } finally {
      setLoading(false);
    }
  }

  async function pickDialog() {
    setLoading(true);
    setErr(null);
    try {
      const res = await b2dm.csv.pickAndPersist();
      if (!res) return;
      const label = res.path.split(/[\\/]/).pop() ?? 'file';
      onChange({ kind: 'file', path: res.path, count: res.count, label });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load file');
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
    else setErr('Drag-and-drop from this source is not supported — use "Browse" instead.');
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
          {active ? active.label : 'Drop a usernames file or click to browse'}
        </div>
        <div className="text-xs text-muted-foreground">
          {active
            ? `${active.count} usernames`
            : 'CSV, TXT, XLSX or XLS — first column is the username.'}
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
            Clear
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
      const list = await b2dm.scrapes.list();
      if (!cancelled) setRows(list);
    })();
    const off = b2dm.jobs.onDone(async () => {
      const list = await b2dm.scrapes.list();
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
      const res = await b2dm.csv.persistFromScrapes(ids);
      const labels = ids
        .map((id) => (rows ?? []).find((r) => r.jobId === id)?.summary)
        .filter((s): s is string => !!s);
      const label =
        labels.length === 1
          ? labels[0]!
          : `${labels.length} scrapes`;
      onChange({
        kind: 'job',
        path: res.path,
        count: res.count,
        label,
        refIds: ids,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load scrape');
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
            placeholder="Search scrapes by summary, kind or category…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="h-[50vh] overflow-auto">
        {rows === null ? (
          <div className="flex items-center justify-center p-6">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<Inbox className="h-8 w-8" />}
            title="No scrapes yet"
            description="Run a scrape from Scrape Leads. Once it finishes, you can reuse its results here."
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Summary</th>
                <th className="px-3 py-1.5 text-right">Leads</th>
                <th className="px-3 py-1.5 text-left">Completed</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filtered!.length === 0 ? (
                <tr className="border-t border-border last:border-b">
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No scrapes match your search.
                  </td>
                </tr>
              ) : (
                filtered!.map((row) => {
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
                        <ScrapeSummaryOf row={row} className="text-sm font-medium leading-tight" />
                        <div className="flex items-center gap-2 text-[11px] leading-tight text-muted-foreground">
                          <span>{row.kind}</span>
                          {row.categoryName ? (
                            <CategoryChip name={row.categoryName} />
                          ) : null}
                        </div>
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
                })
              )}
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
      const list = await b2dm.categories.list();
      if (!cancelled) setRows(list);
    }
    void load();
    const off = b2dm.categories.onChange(() => void load());
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
      const res = await b2dm.csv.persistFromCategories(ids);
      const labels = ids
        .map((id) => (rows ?? []).find((r) => r.id === id)?.name)
        .filter((s): s is string => !!s);
      const label =
        labels.length === 1
          ? labels[0]!
          : `${labels.length} categories`;
      onChange({
        kind: 'category',
        path: res.path,
        count: res.count,
        label,
        refIds: ids,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load category');
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
            placeholder="Search categories by name…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="h-[50vh] overflow-auto">
        {rows === null ? (
          <div className="flex items-center justify-center p-6">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<FolderTree className="h-8 w-8" />}
            title="No categories yet"
            description="Tag a scrape with a category to start pooling leads."
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-right">Leads</th>
                <th className="px-3 py-1.5 text-left">Last activity</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filtered!.length === 0 ? (
                <tr className="border-t border-border last:border-b">
                  <td colSpan={4} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No categories match your search.
                  </td>
                </tr>
              ) : (
                filtered!.map((row) => {
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
                })
              )}
            </tbody>
          </table>
        )}
      </div>
      {err ? <p className="border-t border-border px-3 py-2 text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

/* ---------------- Step 3: Message ---------------- */

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
  const nonEmpty = variants.filter((v) => v.trim().length > 0).length;

  function updateVariant(i: number, value: string) {
    onVariantsChange(variants.map((v, idx) => (idx === i ? value : v)));
  }
  function addVariant() {
    if (variants.length >= MAX_VARIANTS) return;
    onVariantsChange([...variants, '']);
  }
  function removeVariant(i: number) {
    if (variants.length <= 1) return;
    onVariantsChange(variants.filter((_, idx) => idx !== i));
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Message variants</span>
          <span className="normal-case font-normal">
            {nonEmpty}/{MAX_VARIANTS} · one picked at random per DM ·{' '}
            <code className="rounded bg-background px-1 py-0.5 text-[10px]">{'{{username}}'}</code>
          </span>
        </div>
        <div ref={scrollRef} className="max-h-[50vh] space-y-2 overflow-auto p-3">
          {variants.map((value, i) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea
                rows={3}
                placeholder={i === 0 ? 'Hey {{username}}, …' : `Variant ${i + 1}`}
                value={value}
                onChange={(e) => updateVariant(i, e.target.value)}
              />
              <button
                type="button"
                onClick={() => removeVariant(i)}
                disabled={variants.length <= 1}
                aria-label={`Remove variant ${i + 1}`}
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
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
            Add variant
          </button>
        </div>
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pace
        </div>
        <div className="space-y-1 p-3">
          <Label htmlFor="dm-interval">Interval between DMs (seconds)</Label>
          <Input
            id="dm-interval"
            type="number"
            min={3}
            max={600}
            value={intervalSec}
            onChange={(e) =>
              onIntervalChange(Math.max(3, Math.min(600, Number(e.target.value) || 12)))
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Minimum 3s. Jitter ±25% is applied automatically.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Step 4: Interactions ---------------- */

function InteractionsStep({
  value,
  onChange,
}: {
  value: InteractionsState;
  onChange: (s: InteractionsState) => void;
}) {
  function update(patch: Partial<InteractionsState>) {
    onChange({ ...value, ...patch });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Pre-DM interactions
          </span>
          <span className="normal-case font-normal">Optional — off by default</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <div className="min-w-0">
            <div className="font-medium">Warm the target before messaging</div>
            <p className="text-[11px] text-muted-foreground">
              Before each DM the account visits the target's profile, optionally follows them, and
              can like a few of their recent posts. Already-followed targets are never unfollowed.
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
                  <div className="font-medium">Follow the user</div>
                  <p className="text-[11px] text-muted-foreground">
                    Sends a follow request. Skipped when already following / requested.
                  </p>
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
                  <div className="font-medium">Like recent posts</div>
                  <p className="text-[11px] text-muted-foreground">
                    Likes this many of their most recent posts. Skipped if the profile has no posts
                    or is private.
                  </p>
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

          <p className="text-[11px] text-muted-foreground">
            Max {MAX_LIKE_COUNT} likes per target. A human-ish delay sits between the interactions
            and the DM so the funnel reads as organic to Instagram's anti-spam checks.
          </p>
        </>
      ) : null}
    </div>
  );
}

function summariseInteractions(s: InteractionsState): string {
  if (!interactionsHaveEffect(s)) return 'No interactions';
  const parts: string[] = [];
  if (s.follow) parts.push('Follow');
  if (s.likeCount > 0) parts.push(`Like ${s.likeCount} post${s.likeCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/* ---------------- Step 5: Review ---------------- */

function ReviewStep({
  account,
  source,
  variants,
  intervalSec,
  interactions,
  error,
  willEnqueue,
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
  onEditAccount: () => void;
  onEditLeads: () => void;
  onEditMessage: () => void;
  onEditInteractions: () => void;
}) {
  const sourceLabel =
    source?.kind === 'file'
      ? 'File'
      : source?.kind === 'job'
      ? 'Scrape'
      : source?.kind === 'category'
      ? 'Category'
      : '—';

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

      <SummaryCard title="Leads" onEdit={onEditLeads}>
        {source ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">
                {source.label.length > 20 ? `${source.label.slice(0, 20)}…` : source.label}
              </div>
              <div className="text-[11px] text-muted-foreground">{sourceLabel}</div>
            </div>
            <span className="tabular-nums text-sm">{source.count} usernames</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </SummaryCard>

      <SummaryCard
        title={`Message · ${variants.length} variant${variants.length === 1 ? '' : 's'}`}
        onEdit={onEditMessage}
      >
        <div className="space-y-1.5">
          {variants.length === 0 ? (
            <span className="text-sm text-muted-foreground">No variants</span>
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

      <SummaryCard title="Pace" onEdit={onEditMessage}>
        <div className="text-sm">
          1 DM every <span className="font-medium">{intervalSec}s</span>
          <span className="ml-1 text-[11px] text-muted-foreground">(±25% jitter)</span>
        </div>
      </SummaryCard>

      <SummaryCard title="Interactions" onEdit={onEditInteractions}>
        <div className="flex items-center gap-2 text-sm">
          {interactionsHaveEffect(interactions) ? (
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          ) : null}
          <span className={interactionsHaveEffect(interactions) ? 'font-medium' : 'text-muted-foreground'}>
            {summariseInteractions(interactions)}
          </span>
        </div>
      </SummaryCard>

      {willEnqueue ? (
        <p className="text-[11px] text-muted-foreground">
          This account is busy. The Cold DM will be added to its queue and start once the
          current jobs finish.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
