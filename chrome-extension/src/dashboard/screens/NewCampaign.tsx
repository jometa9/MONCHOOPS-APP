import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  FileUp,
  Heart,
  Keyboard,
  MessageSquareText,
  MonitorSmartphone,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
} from 'lucide-react';
import { DesktopImportDialog } from '../components/DesktopImportDialog';
import { Stepper } from '../components/Stepper';
import { SummaryCard } from '../components/SummaryCard';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/shared/db';
import { parseUsernamesFile, parseUsernamesText, type CsvLead } from '@/shared/csv';
import { uuid } from '@/shared/format';
import { cn } from '@/shared/cn';
import { ScreenHeader } from '../components/ScreenHeader';
import { enqueuePush, runSync } from '@/shared/sync';
import type {
  Campaign,
  CampaignSource,
  InteractionsConfig,
  SyncedVariantGroup,
} from '@/shared/types';

const DEFAULT_INTERVAL_SEC = 90;
const MAX_VARIANTS = 20;
const STEP_LABELS = ['Leads', 'Message', 'Interactions', 'Review'] as const;

type Step = 1 | 2 | 3 | 4;

interface InteractionsState {
  enabled: boolean;
  follow: boolean;
  likeCount: number;
  watchStories: boolean;
  storyDwellSec: number;
}

const DEFAULT_INTERACTIONS: InteractionsState = {
  enabled: false,
  follow: true,
  likeCount: 2,
  watchStories: false,
  storyDwellSec: 3,
};

function interactionsHaveEffect(s: InteractionsState): boolean {
  return s.enabled && (s.follow || s.likeCount > 0 || s.watchStories);
}

function interactionsPayload(s: InteractionsState): InteractionsConfig | null {
  if (!interactionsHaveEffect(s)) return null;
  return {
    follow: s.follow,
    likeCount: s.likeCount,
    watchStories: s.watchStories,
    storyDwellSec: s.storyDwellSec,
  };
}

function summariseInteractions(s: InteractionsState): string {
  if (!interactionsHaveEffect(s)) return 'No interactions';
  const parts: string[] = [];
  if (s.follow) parts.push('Follow');
  if (s.likeCount > 0) parts.push(`Like ${s.likeCount} post${s.likeCount === 1 ? '' : 's'}`);
  if (s.watchStories) parts.push(`Watch stories ${s.storyDwellSec}s`);
  return parts.join(' · ');
}

function autoCampaignName(): string {
  const d = new Date();
  const date = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `Cold DM — ${date}, ${time}`;
}

export function NewCampaign() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);
  const [leads, setLeads] = useState<CsvLead[]>([]);
  const [source, setSource] = useState<CampaignSource>({ kind: 'manual' });
  const [variants, setVariants] = useState<string[]>(['']);
  const [intervalSec, setIntervalSec] = useState(DEFAULT_INTERVAL_SEC);
  const [interactions, setInteractions] = useState<InteractionsState>(DEFAULT_INTERACTIONS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saveAsGroup, setSaveAsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [variantsLoading, setVariantsLoading] = useState(false);

  const cleanedVariants = useMemo(
    () => variants.map((v) => v.trim()).filter(Boolean),
    [variants]
  );

  // Variant groups come from the local mirror — populated by the sync
  // engine. Always available, even with the desktop offline.
  const variantGroups = useLiveQuery(
    async () => {
      const all = await db.variantGroups.toArray();
      return all
        .filter((g) => !g.deletedAt)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
    [],
    [] as SyncedVariantGroup[]
  );

  const refreshVariantGroups = useCallback(async () => {
    setVariantsLoading(true);
    try {
      await runSync();
    } finally {
      setVariantsLoading(false);
    }
  }, []);

  const canContinue: Record<Step, boolean> = {
    1: leads.length > 0,
    2: cleanedVariants.length > 0 && intervalSec >= 30,
    3: true,
    4: true,
  };

  function goTo(target: Step) {
    if (target < step || canContinue[step]) setStep(target);
  }
  function next() {
    if (!canContinue[step]) return;
    if (step === 3 && interactions.enabled && !interactionsHaveEffect(interactions)) {
      setInteractions((prev) => ({ ...prev, enabled: false }));
    }
    if (step < 4) setStep((step + 1) as Step);
  }
  function back() {
    if (step > 1) setStep((step - 1) as Step);
  }

  async function startNow() {
    if (leads.length === 0 || cleanedVariants.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      if (saveAsGroup && groupName.trim().length > 0 && cleanedVariants.length > 0) {
        const id = uuid();
        const now = Date.now();
        await db.variantGroups.put({
          id,
          name: groupName.trim(),
          variants: cleanedVariants,
          createdAt: now,
          updatedAt: now,
          pendingPush: true,
        });
        await enqueuePush('variants', 'create', id, {
          name: groupName.trim(),
          variants: cleanedVariants,
        });
      }

      const id = uuid();
      const campaign: Campaign = {
        id,
        name: autoCampaignName(),
        createdAt: Date.now(),
        source,
        variants: cleanedVariants,
        interactions: interactionsPayload(interactions),
        intervalMs: Math.max(30, intervalSec) * 1000,
        status: 'running',
        totalLeads: leads.length,
        sentCount: 0,
        failedCount: 0,
        nextRunAt: Date.now(),
      };
      await db.transaction('rw', db.campaigns, db.leads, async () => {
        await db.campaigns.put(campaign);
        await db.leads.bulkAdd(
          leads.map((l) => ({
            campaignId: id,
            username: l.username,
            displayName: l.displayName,
            status: 'pending' as const,
          }))
        );
      });
      await chrome.runtime.sendMessage({ type: 'sw/runCampaignNow', campaignId: id });
      navigate(`/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create campaign');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title="New cold DM"
        description="Pick your audience, write your message, hit Start. The browser handles the rest."
        actions={
          <button
            type="button"
            onClick={() => navigate('/campaigns')}
            className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-4">
          <Stepper
            labels={STEP_LABELS}
            current={step}
            onJump={(s) => goTo(s as Step)}
            canJump={(s) => s < step || canContinue[step]}
          />

          <div className="py-4">
            {step === 1 ? (
              <LeadsStep
                leads={leads}
                source={source}
                onApplyDesktop={(list, src) => {
                  setLeads(list);
                  setSource(src);
                }}
                onClearDesktop={() => {
                  setSource({ kind: 'manual' });
                  setLeads([]);
                }}
                onMergeManual={(list) => {
                  setLeads((prev) => {
                    const seen = new Set(prev.map((l) => l.username));
                    const merged = [...prev];
                    for (const l of list) {
                      if (!seen.has(l.username)) {
                        merged.push(l);
                        seen.add(l.username);
                      }
                    }
                    return merged;
                  });
                  if (source.kind !== 'manual') setSource({ kind: 'manual' });
                }}
                onRemoveLead={(username) =>
                  setLeads((prev) => prev.filter((l) => l.username !== username))
                }
              />
            ) : null}

            {step === 2 ? (
              <MessageStep
                variants={variants}
                onVariantsChange={setVariants}
                intervalSec={intervalSec}
                onIntervalChange={setIntervalSec}
                variantGroups={variantGroups ?? []}
                variantsLoading={variantsLoading}
                onRefreshGroups={refreshVariantGroups}
                saveAsGroup={saveAsGroup}
                onToggleSaveAsGroup={setSaveAsGroup}
                groupName={groupName}
                onGroupNameChange={setGroupName}
              />
            ) : null}

            {step === 3 ? (
              <InteractionsStep value={interactions} onChange={setInteractions} />
            ) : null}

            {step === 4 ? (
              <ReviewStep
                leads={leads}
                source={source}
                variants={cleanedVariants}
                intervalSec={intervalSec}
                interactions={interactions}
                error={error}
                onEditLeads={() => setStep(1)}
                onEditMessage={() => setStep(2)}
                onEditInteractions={() => setStep(3)}
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
            {step < 4 ? (
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
                onClick={startNow}
                disabled={
                  submitting || leads.length === 0 || cleanedVariants.length === 0
                }
                className="inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                {submitting ? 'Starting…' : 'Start Cold DM'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Step 1: Leads ---------------- */

type LeadsTab = 'manual' | 'file' | 'desktop';

const LEADS_TABS: { id: LeadsTab; label: string; icon: typeof FileUp }[] = [
  { id: 'manual', label: 'Manual', icon: Keyboard },
  { id: 'file', label: 'Upload file', icon: UploadCloud },
  { id: 'desktop', label: 'Desktop source', icon: MonitorSmartphone },
];

function LeadsStep({
  leads,
  source,
  onApplyDesktop,
  onClearDesktop,
  onMergeManual,
  onRemoveLead,
}: {
  leads: CsvLead[];
  source: CampaignSource;
  onApplyDesktop: (leads: CsvLead[], source: CampaignSource) => void;
  onClearDesktop: () => void;
  onMergeManual: (list: CsvLead[]) => void;
  onRemoveLead: (username: string) => void;
}) {
  const [tab, setTab] = useState<LeadsTab>(() =>
    source.kind !== 'manual' ? 'desktop' : 'manual'
  );

  return (
    <div className="flex flex-col gap-3">
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

        {tab === 'manual' ? (
          <ManualPanel onAdd={onMergeManual} />
        ) : null}
        {tab === 'file' ? (
          <FilePanel onAdd={onMergeManual} />
        ) : null}
        {tab === 'desktop' ? (
          <DesktopPanel
            source={source}
            leadsCount={leads.length}
            onApply={onApplyDesktop}
            onClear={onClearDesktop}
          />
        ) : null}
      </div>

      <LeadsPreview leads={leads} source={source} onRemove={onRemoveLead} />
    </div>
  );
}

function ManualPanel({ onAdd }: { onAdd: (list: CsvLead[]) => void }) {
  const [text, setText] = useState('');

  function commit() {
    const list = parseUsernamesText(text);
    if (list.length === 0) return;
    onAdd(list);
    setText('');
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Type or paste usernames
      </div>
      <div className="space-y-2 p-3">
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="One per line, or comma/space separated. @ prefix is optional."
          className="w-full resize-y border border-border bg-background p-2 text-sm outline-none focus:border-foreground"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to add</p>
          <button
            type="button"
            onClick={commit}
            disabled={!text.trim()}
            className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function FilePanel({ onAdd }: { onAdd: (list: CsvLead[]) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const list = await parseUsernamesFile(file);
      if (list.length === 0) {
        setErr('No usernames found in this file.');
      } else {
        onAdd(list);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not parse file');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-3">
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        onClick={() => !busy && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
        className={cn(
          'flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-accent',
          dragOver && 'border-primary bg-primary/5',
          busy && 'cursor-wait opacity-60'
        )}
      >
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium">
          Drop a usernames file or click to browse
        </div>
        <div className="text-xs text-muted-foreground">
          CSV or TXT — first column is the username.
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.currentTarget.value = '';
          }}
        />
      </div>
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </div>
  );
}

function DesktopPanel({
  source,
  leadsCount,
  onApply,
  onClear,
}: {
  source: CampaignSource;
  leadsCount: number;
  onApply: (leads: CsvLead[], source: CampaignSource) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const linked = source.kind !== 'manual';

  return (
    <div className="p-3">
      {linked ? (
        <div className="flex items-center justify-between border border-border bg-muted/30 p-3 text-xs">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{source.label}</span>
            </div>
            <p className="mt-0.5 text-muted-foreground">
              {leadsCount} leads — pulled live from MonchoOps. Use Re-fetch to pick up
              new leads added on the desktop after this campaign was started.
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-8 items-center border border-border bg-background px-3 text-[11px] font-medium hover:bg-accent"
            >
              Re-fetch
            </button>
            <button
              type="button"
              onClick={onClear}
              className="inline-flex h-8 items-center px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(true);
            }
          }}
          className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-accent"
        >
          <MonitorSmartphone className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm font-medium">Pick a desktop category or scrape</div>
          <div className="text-xs text-muted-foreground">
            Pulls leads live from the MonchoOps desktop app.
          </div>
        </div>
      )}
      {open ? (
        <DesktopImportDialog
          onClose={() => setOpen(false)}
          onImport={(list, src) => onApply(list, src)}
        />
      ) : null}
    </div>
  );
}

function LeadsPreview({
  leads,
  source,
  onRemove,
}: {
  leads: CsvLead[];
  source: CampaignSource;
  onRemove: (username: string) => void;
}) {
  if (leads.length === 0) {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        No leads yet — pick a tab above to add some.
      </p>
    );
  }
  return (
    <div className="overflow-hidden border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Loaded leads</span>
        <span className="normal-case font-normal">{leads.length} loaded</span>
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-sm">
          <tbody>
            {leads.map((l) => (
              <tr key={l.username} className="border-b border-border last:border-b-0">
                <td className="px-3 py-1.5">@{l.displayName}</td>
                <td className="px-2 py-1.5 text-right">
                  {source.kind === 'manual' ? (
                    <button
                      type="button"
                      onClick={() => onRemove(l.username)}
                      className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${l.displayName}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------- Step 2: Message ---------------- */

type MessageTab = 'write' | 'saved';

const MESSAGE_TABS: { id: MessageTab; label: string; icon: typeof Pencil }[] = [
  { id: 'write', label: 'Write', icon: Pencil },
  { id: 'saved', label: 'Saved', icon: MessageSquareText },
];

function MessageStep({
  variants,
  onVariantsChange,
  intervalSec,
  onIntervalChange,
  variantGroups,
  variantsLoading,
  onRefreshGroups,
  saveAsGroup,
  onToggleSaveAsGroup,
  groupName,
  onGroupNameChange,
}: {
  variants: string[];
  onVariantsChange: (v: string[]) => void;
  intervalSec: number;
  onIntervalChange: (n: number) => void;
  variantGroups: SyncedVariantGroup[];
  variantsLoading: boolean;
  onRefreshGroups: () => void | Promise<void>;
  saveAsGroup: boolean;
  onToggleSaveAsGroup: (v: boolean) => void;
  groupName: string;
  onGroupNameChange: (v: string) => void;
}) {
  const [tab, setTab] = useState<MessageTab>('write');

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden border border-border bg-background">
        <div className="flex items-stretch border-b border-border">
          {MESSAGE_TABS.map((t, idx) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors',
                  idx !== MESSAGE_TABS.length - 1 && 'border-r border-border',
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

        {tab === 'write' ? (
          <WriteVariantsPanel variants={variants} onChange={onVariantsChange} />
        ) : (
          <SavedVariantsPanel
            groups={variantGroups}
            loading={variantsLoading}
            onRefresh={onRefreshGroups}
            onPick={(loaded) => {
              onVariantsChange(loaded.length > 0 ? loaded : ['']);
              setTab('write');
            }}
          />
        )}
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Pace
        </div>
        <div className="space-y-1 p-3">
          <label htmlFor="dm-interval" className="text-xs font-medium">
            Interval between DMs (seconds)
          </label>
          <input
            id="dm-interval"
            type="number"
            min={30}
            max={3600}
            value={intervalSec}
            onChange={(e) =>
              onIntervalChange(
                Math.max(30, Math.min(3600, Number(e.target.value) || DEFAULT_INTERVAL_SEC))
              )
            }
            className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
          />
          <p className="text-[11px] text-muted-foreground">
            Minimum 30s — lower paces trip Instagram's anti-spam. A small jitter is
            applied per send so the cadence is not robotic.
          </p>
        </div>
      </div>

      <div className="border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Save these variants
        </div>
        <div className="space-y-2 p-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={saveAsGroup}
              onChange={(e) => onToggleSaveAsGroup(e.target.checked)}
            />
            <span className="inline-flex items-center gap-1">
              <Save className="h-3 w-3" />
              Save as a new group on the desktop
            </span>
          </label>
          {saveAsGroup ? (
            <input
              value={groupName}
              onChange={(e) => onGroupNameChange(e.target.value)}
              placeholder="Group name"
              className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          ) : null}
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
  const nonEmpty = variants.filter((v) => v.trim().length > 0).length;

  function update(i: number, value: string) {
    onChange(variants.map((v, idx) => (idx === i ? value : v)));
  }
  function add() {
    if (variants.length >= MAX_VARIANTS) return;
    onChange([...variants, '']);
  }
  function remove(i: number) {
    if (variants.length <= 1) return;
    onChange(variants.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Message variants</span>
        <span className="normal-case font-normal">
          {nonEmpty}/{MAX_VARIANTS} · one picked at random per DM ·{' '}
          <code className="rounded bg-background px-1 py-0.5 text-[10px]">
            {'{{username}}'}
          </code>
        </span>
      </div>
      <div className="max-h-[45vh] space-y-2 overflow-auto p-3">
        {variants.map((value, i) => (
          <div key={i} className="flex items-start gap-2">
            <textarea
              rows={3}
              placeholder={i === 0 ? 'Hey {{username}}, …' : `Variant ${i + 1}`}
              value={value}
              onChange={(e) => update(i, e.target.value)}
              className="w-full resize-y border border-border bg-background p-2 text-sm outline-none focus:border-foreground"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={variants.length <= 1}
              aria-label={`Remove variant ${i + 1}`}
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
          onClick={add}
          disabled={variants.length >= MAX_VARIANTS}
          className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          <Plus className="h-3.5 w-3.5" />
          Add variant
        </button>
      </div>
    </div>
  );
}

function SavedVariantsPanel({
  groups,
  loading,
  onRefresh,
  onPick,
}: {
  groups: SyncedVariantGroup[];
  loading: boolean;
  onRefresh: () => void | Promise<void>;
  onPick: (variants: string[]) => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Saved variant groups</span>
        <button
          type="button"
          onClick={() => void onRefresh()}
          disabled={loading}
          className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium normal-case text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>
      <div className="max-h-[45vh] overflow-auto">
        {groups.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            No saved groups yet — create one from the Variants screen.
          </div>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {groups.map((g) => (
                <tr
                  key={g.id}
                  onClick={() => onPick(g.variants)}
                  className="cursor-pointer border-t border-border transition-colors first:border-t-0 even:bg-muted/30 hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5 font-medium">{g.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {g.variants.length} variant{g.variants.length === 1 ? '' : 's'}
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

/* ---------------- Step 3: Interactions ---------------- */

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
              Before each DM, visit the target's profile, optionally follow them, and
              like a few of their recent posts. Already-followed targets are never
              unfollowed.
            </p>
          </div>
          <Switch
            checked={value.enabled}
            onChange={(enabled) => update({ enabled })}
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
                onChange={(follow) => update({ follow })}
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
                    Likes this many of their most recent posts. Skipped when the
                    profile has no posts or is private.
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

          <div className="border border-border bg-background">
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
                <div>
                  <div className="font-medium">Watch their stories first</div>
                  <p className="text-[11px] text-muted-foreground">
                    Silently views any active stories before the DM. Skipped when no
                    story is available.
                  </p>
                </div>
              </div>
              <Switch
                checked={value.watchStories}
                onChange={(watchStories) => update({ watchStories })}
              />
            </div>
            {value.watchStories ? (
              <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs">
                <span className="text-muted-foreground">Dwell per story (s)</span>
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={value.storyDwellSec}
                  onChange={(e) =>
                    update({ storyDwellSec: Math.max(1, Math.min(15, Number(e.target.value) || 3)) })
                  }
                  className="h-7 w-16 rounded border border-border bg-transparent px-2 text-right outline-none focus:border-primary"
                />
              </div>
            ) : null}
          </div>

          <p className="text-[11px] text-muted-foreground">
            A human-ish delay sits between the interactions and the DM so the funnel
            reads as organic to Instagram's anti-spam checks.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className={cn(
        'relative inline-flex h-5 w-9 flex-none cursor-pointer items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-border'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-background transition',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </span>
  );
}

/* ---------------- Step 4: Review ---------------- */

function ReviewStep({
  leads,
  source,
  variants,
  intervalSec,
  interactions,
  error,
  onEditLeads,
  onEditMessage,
  onEditInteractions,
}: {
  leads: CsvLead[];
  source: CampaignSource;
  variants: string[];
  intervalSec: number;
  interactions: InteractionsState;
  error: string | null;
  onEditLeads: () => void;
  onEditMessage: () => void;
  onEditInteractions: () => void;
}) {
  const sourceLabel =
    source.kind === 'manual'
      ? 'Manual'
      : source.kind === 'desktop_category'
      ? 'Desktop category'
      : 'Desktop scrape';

  return (
    <div className="flex flex-col gap-2">
      <SummaryCard title="Leads" onEdit={onEditLeads}>
        {leads.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">
                {source.kind === 'manual' ? `${leads.length} usernames` : source.label}
              </div>
              <div className="text-[11px] text-muted-foreground">{sourceLabel}</div>
            </div>
            <span className="tabular-nums text-sm">{leads.length} usernames</span>
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
          <span className="ml-1 text-[11px] text-muted-foreground">(small jitter)</span>
        </div>
      </SummaryCard>

      <SummaryCard title="Interactions" onEdit={onEditInteractions}>
        <div className="flex items-center gap-2 text-sm">
          {interactionsHaveEffect(interactions) ? (
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          ) : null}
          <span
            className={
              interactionsHaveEffect(interactions)
                ? 'font-medium'
                : 'text-muted-foreground'
            }
          >
            {summariseInteractions(interactions)}
          </span>
        </div>
      </SummaryCard>

      {error ? (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}

