import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  FolderTree,
  Inbox,
  Instagram,
  Plus,
  Search,
  Tag,
  Trash2,
  UploadCloud,
  Play,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/common/Spinner';
import { AccountStep } from '@/components/common/AccountStep';
import { Stepper } from '@/components/common/Stepper';
import { SummaryCard } from '@/components/common/SummaryCard';
import { EmptyPanel } from '@/components/common/EmptyPanel';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import type {
  AccountPublic,
  LeadCategoryPublic,
  ScrapeResultPublic,
} from '@/types/domain';

const MAX_VARIANTS = 20;
const STEP_LABELS = ['Account', 'Leads', 'Message', 'Review'] as const;

type Step = 1 | 2 | 3 | 4;

type SourceKind = 'file' | 'job' | 'category';

interface Source {
  kind: SourceKind;
  path: string;
  count: number;
  label: string;
}

export function MassDMs() {
  const { accounts } = useAccounts();

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [variants, setVariants] = useState<string[]>(['']);
  const [intervalSec, setIntervalSec] = useState(12);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedJobId, setStartedJobId] = useState<string | null>(null);

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
    4: true,
  };

  function goTo(next: Step) {
    if (next < step || canContinue[step]) setStep(next);
  }
  function next() {
    if (!canContinue[step]) return;
    if (step < 4) setStep((step + 1) as Step);
  }
  function back() {
    if (step > 1) setStep((step - 1) as Step);
  }

  async function confirmAndStart() {
    if (!accountId || !source || nonEmptyVariants.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const jobId = await b2dm.jobs.startMassDm({
        accountId,
        usernamesCsvPath: source.path,
        messages: nonEmptyVariants,
        intervalMs: Math.max(3000, intervalSec * 1000),
      });
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
    setError(null);
    setStartedJobId(null);
  }

  if (startedJobId) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="flex items-center gap-2 text-sm">
            <Spinner className="h-4 w-4" />
            <span>Job started. Watch progress in the bottom status bar.</span>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" onClick={resetAll}>Queue another</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col pb-[8vh]">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <h1 className="text-2xl font-semibold tracking-tight">Cold DM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Four quick steps: pick the account, the leads, write your message, review and send.
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
          <ReviewStep
            account={selectedAccount}
            source={source}
            variants={nonEmptyVariants}
            intervalSec={intervalSec}
            error={error}
            submitting={submitting}
            onConfirm={confirmAndStart}
            onEditAccount={() => setStep(1)}
            onEditLeads={() => setStep(2)}
            onEditMessage={() => setStep(3)}
          />
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 pt-3">
        <Button variant="ghost" onClick={back} disabled={step === 1}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        {step < 4 ? (
          <Button onClick={next} disabled={!canContinue[step]}>
            Continue
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : null}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {LEADS_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors',
                tab === t.id
                  ? 'bg-background shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-border bg-background'
        )}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="mt-2 text-sm font-medium">Drop a usernames file here</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          CSV, TXT, XLSX or XLS — first column is the username.
        </div>
        <div className="mt-4">
          <Button variant="outline" onClick={pickDialog} disabled={loading}>
            {loading ? <Spinner /> : <FileUp className="h-4 w-4" />}
            Browse files
          </Button>
        </div>
        {active ? (
          <div className="mt-4 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs">
            <Check className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">{active.label}</span>
            <span className="text-muted-foreground">· {active.count} usernames</span>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ml-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear file"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {err ? <p className="mt-3 text-xs text-destructive">{err}</p> : null}
      </div>
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      [r.summary, r.kind, r.categoryName ?? ''].join(' ').toLowerCase().includes(q)
    );
  }, [rows, query]);

  async function select(row: ScrapeResultPublic) {
    setBusyId(row.jobId);
    setErr(null);
    try {
      const res = await b2dm.csv.persistFromScrape(row.jobId);
      onChange({
        kind: 'job',
        path: res.path,
        count: res.count,
        label: row.summary,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load scrape');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {rows === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<Inbox className="h-8 w-8" />}
            title="No scrapes yet"
            description="Run a scrape from Scrape Leads. Once it finishes, you can reuse its results here."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Summary</th>
                <th className="px-3 py-1.5 text-right">Usernames</th>
                <th className="px-3 py-1.5 text-left">Completed</th>
              </tr>
            </thead>
            <tbody>
              {filtered!.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No scrapes match your search.
                  </td>
                </tr>
              ) : (
                filtered!.map((row) => {
                  const selected = value?.kind === 'job' && value.label === row.summary;
                  return (
                    <tr
                      key={row.jobId}
                      onClick={() => void select(row)}
                      className={cn(
                        'cursor-pointer border-t border-border transition-colors hover:bg-accent/40',
                        selected && 'bg-primary/5 hover:bg-primary/10',
                        busyId === row.jobId && 'opacity-60'
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.summary}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.kind}
                          {row.categoryName ? (
                            <span className="ml-1 inline-flex items-center gap-1">
                              <Tag className="h-2.5 w-2.5" />
                              {row.categoryName}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.usernameCount}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(row.completedAt)}
                        {selected ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-primary">
                            <Check className="h-3 w-3" />
                            Selected
                          </span>
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
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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

  async function select(row: LeadCategoryPublic) {
    if (row.leadCount === 0) return;
    setBusyId(row.id);
    setErr(null);
    try {
      const res = await b2dm.csv.persistFromCategory(row.id);
      onChange({
        kind: 'category',
        path: res.path,
        count: res.count,
        label: row.name,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load category');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {rows === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-5 w-5 text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyPanel
            icon={<FolderTree className="h-8 w-8" />}
            title="No categories yet"
            description="Tag a scrape with a category to start pooling leads."
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Name</th>
                <th className="px-3 py-1.5 text-right">Leads</th>
                <th className="px-3 py-1.5 text-left">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {filtered!.length === 0 ? (
                <tr className="border-t border-border">
                  <td colSpan={3} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No categories match your search.
                  </td>
                </tr>
              ) : (
                filtered!.map((row) => {
                  const selected = value?.kind === 'category' && value.label === row.name;
                  const disabled = row.leadCount === 0;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => !disabled && void select(row)}
                      className={cn(
                        'border-t border-border transition-colors',
                        !disabled && 'cursor-pointer hover:bg-accent/40',
                        selected && 'bg-primary/5 hover:bg-primary/10',
                        disabled && 'cursor-not-allowed opacity-50',
                        busyId === row.id && 'opacity-60'
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.leadCount}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDateTime(row.lastActivityAt)}
                        {selected ? (
                          <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-primary">
                            <Check className="h-3 w-3" />
                            Selected
                          </span>
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <Label className="text-sm">Message variants</Label>
          <span className="text-[11px] text-muted-foreground">
            {nonEmpty}/{MAX_VARIANTS} · one picked at random per DM ·{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-[10px]">{'{{username}}'}</code>
          </span>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          {variants.map((value, i) => (
            <div key={i} className="flex items-start gap-2">
              <Textarea
                rows={3}
                placeholder={i === 0 ? 'Hey {{username}}, …' : `Variant ${i + 1}`}
                value={value}
                onChange={(e) => updateVariant(i, e.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeVariant(i)}
                disabled={variants.length <= 1}
                aria-label={`Remove variant ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVariant}
            disabled={variants.length >= MAX_VARIANTS}
          >
            <Plus className="h-4 w-4" />
            Add variant
          </Button>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border border-border bg-background p-3">
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
  );
}

/* ---------------- Step 4: Review ---------------- */

function ReviewStep({
  account,
  source,
  variants,
  intervalSec,
  error,
  submitting,
  onConfirm,
  onEditAccount,
  onEditLeads,
  onEditMessage,
}: {
  account: AccountPublic | null;
  source: Source | null;
  variants: string[];
  intervalSec: number;
  error: string | null;
  submitting: boolean;
  onConfirm: () => void;
  onEditAccount: () => void;
  onEditLeads: () => void;
  onEditMessage: () => void;
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

      <SummaryCard title="Leads" onEdit={onEditLeads}>
        {source ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{source.label}</div>
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
                className="rounded border border-border bg-muted/30 px-2 py-1.5 text-xs"
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

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div>
        <Button onClick={onConfirm} disabled={submitting}>
          {submitting ? <Spinner /> : <Play className="h-4 w-4" />}
          {submitting ? 'Starting…' : 'Start Cold DM job'}
        </Button>
      </div>
    </div>
  );
}

