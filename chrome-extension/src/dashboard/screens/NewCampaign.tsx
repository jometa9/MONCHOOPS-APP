import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  FileUp,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
} from 'lucide-react';
import { DesktopImportDialog } from '../components/DesktopImportDialog';
import { db } from '@/shared/db';
import { parseUsernamesFile, parseUsernamesText, type CsvLead } from '@/shared/csv';
import { uuid } from '@/shared/format';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  BridgeError,
  createVariantGroup,
  listVariantGroups,
  type DesktopVariantGroup,
} from '@/shared/desktop-bridge';
import type {
  Campaign,
  CampaignSource,
  InteractionsConfig,
} from '@/shared/types';

const DEFAULT_INTERVAL_MS = 90_000;

export function NewCampaign() {
  const navigate = useNavigate();
  const [variantGroups, setVariantGroups] = useState<DesktopVariantGroup[] | null>(null);
  const [variantsError, setVariantsError] = useState<string | null>(null);
  const [variantsLoading, setVariantsLoading] = useState(false);

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
  const [intervalSec, setIntervalSec] = useState(Math.floor(DEFAULT_INTERVAL_MS / 1000));
  const [manualUsername, setManualUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDesktopImport, setShowDesktopImport] = useState(false);
  const [source, setSource] = useState<CampaignSource>({ kind: 'manual' });

  const [saveAsGroup, setSaveAsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshVariantGroups = useCallback(async () => {
    setVariantsLoading(true);
    setVariantsError(null);
    try {
      const groups = await listVariantGroups();
      setVariantGroups(groups);
    } catch (err) {
      setVariantGroups([]);
      setVariantsError(
        err instanceof BridgeError
          ? err.code === 'no_desktop'
            ? 'Desktop app not running — variant groups will not load.'
            : err.message
          : err instanceof Error
          ? err.message
          : String(err)
      );
    } finally {
      setVariantsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshVariantGroups();
  }, [refreshVariantGroups]);

  const cleanedVariants = useMemo(
    () => variants.map((v) => v.trim()).filter(Boolean),
    [variants]
  );

  const canSubmit =
    name.trim().length > 0 &&
    leads.length > 0 &&
    cleanedVariants.length > 0 &&
    intervalSec >= 30 &&
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

  async function startNow() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // If the user opted in, persist these variants as a named group on
      // the desktop app first. We keep going even if the save fails — the
      // campaign itself doesn't depend on the group existing.
      if (saveAsGroup && groupName.trim().length > 0 && cleanedVariants.length > 0) {
        try {
          await createVariantGroup({
            name: groupName.trim(),
            variants: cleanedVariants,
          });
        } catch (err) {
          setError(
            'Could not save the variant group on the desktop app: ' +
              (err instanceof Error ? err.message : String(err))
          );
          setSubmitting(false);
          return;
        }
      }

      const id = uuid();
      const campaign: Campaign = {
        id,
        name: name.trim(),
        createdAt: Date.now(),
        source,
        variants: cleanedVariants,
        interactions: interactionsEnabled ? { ...interactions } : null,
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
    <div className="flex flex-1 flex-col">
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
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          <Section title="Campaign name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SaaS founders — December outreach"
              className="h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </Section>

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

          <Section
            title="Message variants"
            right={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refreshVariantGroups()}
                  disabled={variantsLoading}
                  className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-2 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className={'h-3 w-3 ' + (variantsLoading ? 'animate-spin' : '')} />
                  Refresh
                </button>
                {variantGroups && variantGroups.length > 0 ? (
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
                ) : null}
              </div>
            }
          >
            <p className="text-xs text-muted-foreground">
              One variant is picked at random per DM. Use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{'{{username}}'}</code> to
              inject the target's handle. Variant groups are pulled from the desktop app — saving a
              new one here pushes it back so the desktop sees it too.
            </p>
            {variantsError ? (
              <p className="mt-2 text-[11px] text-amber-600">{variantsError}</p>
            ) : null}
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

            <div className="mt-4 border-t border-border pt-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={saveAsGroup}
                  onChange={(e) => setSaveAsGroup(e.target.checked)}
                />
                <span className="inline-flex items-center gap-1">
                  <Save className="h-3 w-3" />
                  Save these variants as a new group on the desktop
                </span>
              </label>
              {saveAsGroup ? (
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name"
                  className="mt-2 h-9 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              ) : null}
            </div>
          </Section>

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

          <Section title="Send rate">
            <p className="text-xs text-muted-foreground">
              Average wait between sends. A small jitter is applied so the cadence is not robotic.
            </p>
            <div className="mt-3">
              <NumberField
                label="Avg seconds between DMs"
                min={30}
                max={3600}
                value={intervalSec}
                onChange={setIntervalSec}
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
              className="inline-flex h-9 items-center gap-1.5 bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            >
              {submitting ? 'Starting…' : 'Start'}
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
