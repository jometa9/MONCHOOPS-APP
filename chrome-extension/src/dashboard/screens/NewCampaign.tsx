import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, FileUp, MonitorSmartphone, Plus, Trash2, Users } from 'lucide-react';
import { DesktopImportDialog } from '../components/DesktopImportDialog';
import { db } from '@/shared/db';
import { parseUsernamesFile, parseUsernamesText, type CsvLead } from '@/shared/csv';
import { uuid } from '@/shared/format';
import { ScreenHeader } from '../components/ScreenHeader';
import type {
  Campaign,
  CampaignSource,
  InteractionsConfig,
  ScheduleWindow,
  VariantGroup,
} from '@/shared/types';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function NewCampaign() {
  const navigate = useNavigate();
  const variantGroups = useLiveQuery(
    () => db.variantGroups.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as VariantGroup[]
  );

  const [name, setName] = useState('');
  const [leads, setLeads] = useState<CsvLead[]>([]);
  const [variants, setVariants] = useState<string[]>(['']);
  const [interactionsEnabled, setInteractionsEnabled] = useState(false);
  const [interactions, setInteractions] = useState<InteractionsConfig>({
    follow: true,
    likeCount: 2,
    watchStories: false,
    storyDwellSec: 3,
  });
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleWindow>({
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '10:00',
    endTime: '18:00',
    intervalMs: 90_000,
  });
  const [manualUsername, setManualUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDesktopImport, setShowDesktopImport] = useState(false);
  const [source, setSource] = useState<CampaignSource>({ kind: 'manual' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanedVariants = useMemo(
    () => variants.map((v) => v.trim()).filter(Boolean),
    [variants]
  );

  const canSubmit =
    name.trim().length > 0 &&
    leads.length > 0 &&
    cleanedVariants.length > 0 &&
    !submitting;

  async function onUpload(file: File) {
    const list = await parseUsernamesFile(file);
    mergeLeads(list);
  }

  function mergeLeads(list: CsvLead[]) {
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
  }

  function applyDesktopSource(list: CsvLead[], src: CampaignSource) {
    // When the user picks a live desktop source, replace any existing list
    // (we don't merge with manually-typed leads — the source IS the list).
    setLeads(list);
    setSource(src);
  }

  function clearDesktopSource() {
    setSource({ kind: 'manual' });
    setLeads([]);
  }

  function addManual() {
    const list = parseUsernamesText(manualUsername);
    if (list.length === 0) return;
    mergeLeads(list);
    setManualUsername('');
  }

  function removeLead(username: string) {
    setLeads((prev) => prev.filter((l) => l.username !== username));
  }

  function applyVariantGroup(groupId: string) {
    const g = variantGroups?.find((v) => v.id === groupId);
    if (!g) return;
    setVariants(g.variants.length > 0 ? [...g.variants] : ['']);
  }

  function addVariant() {
    setVariants((prev) => [...prev, '']);
  }
  function updateVariant(i: number, value: string) {
    setVariants((prev) => prev.map((v, idx) => (idx === i ? value : v)));
  }
  function removeVariant(i: number) {
    setVariants((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function toggleDay(d: number) {
    setSchedule((prev) => ({
      ...prev,
      daysOfWeek: prev.daysOfWeek.includes(d)
        ? prev.daysOfWeek.filter((x) => x !== d)
        : [...prev.daysOfWeek, d].sort((a, b) => a - b),
    }));
  }

  async function startNow() {
    await create('running', null);
  }
  async function scheduleIt() {
    await create('scheduled', scheduleEnabled ? schedule : null);
  }

  async function create(status: 'running' | 'scheduled', scheduleToUse: ScheduleWindow | null) {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = uuid();
      const campaign: Campaign = {
        id,
        name: name.trim(),
        createdAt: Date.now(),
        source,
        variants: cleanedVariants,
        interactions: interactionsEnabled ? { ...interactions } : null,
        schedule: scheduleToUse,
        status,
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
      const msgType = status === 'running' ? 'sw/runCampaignNow' : 'sw/scheduleCampaign';
      await chrome.runtime.sendMessage({ type: msgType, campaignId: id });
      navigate(`/campaigns/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create campaign');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader
        title="New cold DM"
        description="Pick your audience, write your message, choose when to send."
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
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {/* Name */}
          <Section title="Campaign name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SaaS founders — December outreach"
              className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </Section>

          {/* Leads */}
          <Section
            title="Leads"
            right={
              <span className="text-xs text-muted-foreground">{leads.length} loaded</span>
            }
          >
            {source.kind !== 'manual' ? (
              <DesktopSourcePanel
                source={source}
                leadsCount={leads.length}
                onResync={() => setShowDesktopImport(true)}
                onClear={clearDesktopSource}
              />
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                    Import CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDesktopImport(true)}
                    className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
                  >
                    <MonitorSmartphone className="h-3.5 w-3.5" />
                    Use desktop source
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onUpload(f);
                      e.currentTarget.value = '';
                    }}
                  />
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      value={manualUsername}
                      onChange={(e) => setManualUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addManual();
                        }
                      }}
                      placeholder="Add usernames manually (comma or new-line separated)"
                      className="h-9 flex-1 border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
                    />
                    <button
                      type="button"
                      onClick={addManual}
                      disabled={!manualUsername.trim()}
                      className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </div>
                </div>
              </>
            )}

            {leads.length > 0 ? (
              <div className="mt-3 max-h-56 overflow-auto border border-border">
                <table className="w-full text-sm">
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.username} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5">@{l.displayName}</td>
                        <td className="px-2 py-1.5 text-right">
                          {source.kind === 'manual' ? (
                            <button
                              type="button"
                              onClick={() => removeLead(l.username)}
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
            ) : source.kind === 'manual' ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                No leads yet — pick a desktop source, import a CSV, or type usernames above.
              </p>
            ) : null}
          </Section>

          {/* Variants */}
          <Section
            title="Message variants"
            right={
              variantGroups && variantGroups.length > 0 ? (
                <select
                  onChange={(e) => {
                    if (e.target.value) applyVariantGroup(e.target.value);
                    e.target.value = '';
                  }}
                  className="h-8 border border-border bg-background px-2 text-xs"
                >
                  <option value="">Apply variant group…</option>
                  {variantGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              ) : null
            }
          >
            <p className="text-xs text-muted-foreground">
              One variant is picked at random per DM. Use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{username}}'}</code> to
              inject the target's handle.
            </p>
            <div className="mt-3 space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea
                    rows={3}
                    value={v}
                    onChange={(e) => updateVariant(i, e.target.value)}
                    placeholder={i === 0 ? 'Hey {{username}}, …' : `Variant ${i + 1}`}
                    className="w-full resize-y border border-border bg-background p-2 text-sm outline-none focus:border-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    disabled={variants.length <= 1}
                    aria-label={`Remove variant ${i + 1}`}
                    className="inline-flex h-9 w-9 flex-none items-center justify-center bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addVariant}
              className="mt-3 inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <Plus className="h-3.5 w-3.5" />
              Add variant
            </button>
          </Section>

          {/* Interactions */}
          <Section
            title="Pre-DM interactions"
            right={
              <Toggle
                checked={interactionsEnabled}
                onChange={setInteractionsEnabled}
                label="Enabled"
              />
            }
          >
            <p className="text-xs text-muted-foreground">
              Optional — visit each target's profile and engage before opening the DM.
            </p>
            <div className={interactionsEnabled ? 'mt-3 space-y-3' : 'mt-3 space-y-3 opacity-50 pointer-events-none'}>
              <Toggle
                checked={interactions.follow}
                onChange={(v) => setInteractions((p) => ({ ...p, follow: v }))}
                label="Follow user"
              />
              <Toggle
                checked={interactions.watchStories}
                onChange={(v) => setInteractions((p) => ({ ...p, watchStories: v }))}
                label="Watch stories"
              />
              <NumberField
                label="Likes per user"
                min={0}
                max={5}
                value={interactions.likeCount}
                onChange={(n) => setInteractions((p) => ({ ...p, likeCount: n }))}
              />
              <NumberField
                label="Story dwell (seconds)"
                min={1}
                max={15}
                value={interactions.storyDwellSec}
                onChange={(n) => setInteractions((p) => ({ ...p, storyDwellSec: n }))}
                disabled={!interactions.watchStories}
              />
            </div>
          </Section>

          {/* Schedule */}
          <Section
            title="Schedule"
            right={
              <Toggle
                checked={scheduleEnabled}
                onChange={setScheduleEnabled}
                label="Use schedule"
              />
            }
          >
            <p className="text-xs text-muted-foreground">
              When the schedule is on, sends only happen during the selected days and time
              range. The browser does the rest in the background — you can close this tab.
            </p>
            <div className={scheduleEnabled ? 'mt-3 space-y-4' : 'mt-3 space-y-4 opacity-50 pointer-events-none'}>
              <div>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Days</div>
                <div className="flex gap-1">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={
                        'inline-flex h-8 flex-1 items-center justify-center text-xs font-medium transition-colors ' +
                        (schedule.daysOfWeek.includes(i)
                          ? 'bg-primary text-primary-foreground'
                          : 'border border-border bg-background hover:bg-accent')
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TimeField
                  label="Start time"
                  value={schedule.startTime}
                  onChange={(v) => setSchedule((p) => ({ ...p, startTime: v }))}
                />
                <TimeField
                  label="End time"
                  value={schedule.endTime}
                  onChange={(v) => setSchedule((p) => ({ ...p, endTime: v }))}
                />
              </div>
              <NumberField
                label="Avg seconds between DMs"
                min={30}
                max={3600}
                value={Math.floor(schedule.intervalMs / 1000)}
                onChange={(s) => setSchedule((p) => ({ ...p, intervalMs: s * 1000 }))}
              />
            </div>
          </Section>

          {error ? (
            <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 pb-10">
            <button
              type="button"
              onClick={startNow}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-4 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              Start now
            </button>
            <button
              type="button"
              onClick={scheduleIt}
              disabled={!canSubmit}
              className="inline-flex h-9 items-center gap-1.5 bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {scheduleEnabled ? 'Schedule' : 'Queue (no schedule)'}
            </button>
          </div>
        </div>
      </div>

      {showDesktopImport ? (
        <DesktopImportDialog
          onClose={() => setShowDesktopImport(false)}
          onImport={(list, src) => applyDesktopSource(list, src)}
        />
      ) : null}
    </div>
  );
}

function DesktopSourcePanel({
  source,
  leadsCount,
  onResync,
  onClear,
}: {
  source: CampaignSource;
  leadsCount: number;
  onResync: () => void;
  onClear: () => void;
}) {
  if (source.kind === 'manual') return null;
  return (
    <div className="flex items-center justify-between border border-border bg-muted/30 p-3 text-xs">
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-medium">
          <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{source.label}</span>
        </div>
        <p className="mt-0.5 text-muted-foreground">
          {leadsCount} leads — pulled live from the desktop app. Click re-fetch to pick up new
          leads added on the desktop after this campaign was started.
        </p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <button
          type="button"
          onClick={onResync}
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
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-background">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onChange(!checked);
        }}
        className={
          'relative inline-flex h-4 w-7 flex-none items-center rounded-full transition-colors ' +
          (checked ? 'bg-primary' : 'bg-border')
        }
      >
        <span
          className={
            'inline-block h-3 w-3 transform rounded-full bg-background transition ' +
            (checked ? 'translate-x-3.5' : 'translate-x-0.5')
          }
        />
      </span>
      <span>{label}</span>
    </label>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
  disabled,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={'flex items-center justify-between text-xs ' + (disabled ? 'opacity-50' : '')}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
        className="h-8 w-24 border border-border bg-background px-2 text-xs outline-none focus:border-foreground"
      />
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 border border-border bg-background px-2 text-xs outline-none focus:border-foreground"
      />
    </label>
  );
}
