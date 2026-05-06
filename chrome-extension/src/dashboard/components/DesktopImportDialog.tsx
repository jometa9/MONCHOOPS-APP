import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Folder, Loader2, MonitorSmartphone } from 'lucide-react';
import {
  BridgeError,
  discoverDesktop,
  listCategoryLeads,
  listDesktopCategories,
  listDesktopScrapes,
  listScrapeLeads,
  type DesktopCategory,
  type DesktopLead,
  type DesktopScrape,
} from '@/shared/desktop-bridge';
import { formatDateTime } from '@/shared/format';
import type { CampaignSource } from '@/shared/types';

type Step =
  | { kind: 'connecting' }
  | { kind: 'no_desktop' }
  | { kind: 'picker'; tab: 'categories' | 'scrapes'; categories?: DesktopCategory[]; scrapes?: DesktopScrape[]; loading: boolean; error?: string }
  | { kind: 'loading_leads' }
  | { kind: 'fatal'; message: string };

interface Props {
  onImport: (leads: DesktopLead[], source: CampaignSource) => void;
  onClose: () => void;
}

export function DesktopImportDialog({ onImport, onClose }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'connecting' });

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function boot() {
    setStep({ kind: 'connecting' });
    try {
      await discoverDesktop();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'no_desktop') {
        setStep({ kind: 'no_desktop' });
        return;
      }
      setStep({
        kind: 'fatal',
        message: err instanceof Error ? err.message : 'Could not connect to the desktop app',
      });
      return;
    }
    await loadCategories();
  }

  async function loadCategories() {
    setStep({ kind: 'picker', tab: 'categories', loading: true });
    try {
      const categories = await listDesktopCategories();
      setStep({ kind: 'picker', tab: 'categories', categories, loading: false });
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'no_desktop') {
        setStep({ kind: 'no_desktop' });
        return;
      }
      setStep({
        kind: 'picker',
        tab: 'categories',
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function loadScrapes() {
    setStep((prev) => {
      if (prev.kind !== 'picker') return prev;
      return { ...prev, tab: 'scrapes', loading: true, error: undefined };
    });
    try {
      const scrapes = await listDesktopScrapes();
      setStep((prev) =>
        prev.kind === 'picker' ? { ...prev, tab: 'scrapes', scrapes, loading: false } : prev
      );
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'no_desktop') {
        setStep({ kind: 'no_desktop' });
        return;
      }
      setStep((prev) =>
        prev.kind === 'picker'
          ? { ...prev, loading: false, error: err instanceof Error ? err.message : String(err) }
          : prev
      );
    }
  }

  async function pickCategory(c: DesktopCategory) {
    setStep({ kind: 'loading_leads' });
    try {
      const leads = await listCategoryLeads(c.id);
      onImport(leads, {
        kind: 'desktop_category',
        desktopId: c.id,
        label: `Category — ${c.name}`,
      });
      onClose();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'no_desktop') {
        setStep({ kind: 'no_desktop' });
        return;
      }
      setStep({
        kind: 'fatal',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function pickScrape(s: DesktopScrape) {
    setStep({ kind: 'loading_leads' });
    try {
      const leads = await listScrapeLeads(s.jobId);
      const label = s.targetName ? `Scrape — ${s.targetName}` : `Scrape — ${s.summary}`;
      onImport(leads, { kind: 'desktop_scrape', desktopJobId: s.jobId, label });
      onClose();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'no_desktop') {
        setStep({ kind: 'no_desktop' });
        return;
      }
      setStep({
        kind: 'fatal',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Import from desktop app</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {step.kind === 'connecting' ? <Centered icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Connecting to the desktop app…" /> : null}

          {step.kind === 'no_desktop' ? (
            <Centered
              icon={<MonitorSmartphone className="h-6 w-6 text-muted-foreground" />}
              title="Could not connect"
              body="Start the MonchoOps desktop app on this computer and try again."
              action={
                <button
                  type="button"
                  onClick={() => void boot()}
                  className="inline-flex h-9 items-center bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Retry
                </button>
              }
            />
          ) : null}

          {step.kind === 'loading_leads' ? <Centered icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Loading leads…" /> : null}

          {step.kind === 'picker' ? (
            <PickerView step={step} onSwitchTab={(t) => (t === 'scrapes' ? void loadScrapes() : void loadCategories())} onPickCategory={(c) => void pickCategory(c)} onPickScrape={(s) => void pickScrape(s)} />
          ) : null}

          {step.kind === 'fatal' ? (
            <Centered
              icon={<MonitorSmartphone className="h-6 w-6 text-destructive" />}
              title="Something went wrong"
              body={step.message}
              action={
                <button
                  type="button"
                  onClick={() => void boot()}
                  className="inline-flex h-9 items-center border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                  Retry
                </button>
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Centered({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      {body ? <p className="max-w-sm text-xs text-muted-foreground">{body}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function PickerView({
  step,
  onSwitchTab,
  onPickCategory,
  onPickScrape,
}: {
  step: Extract<Step, { kind: 'picker' }>;
  onSwitchTab: (t: 'categories' | 'scrapes') => void;
  onPickCategory: (c: DesktopCategory) => void;
  onPickScrape: (s: DesktopScrape) => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex">
          <TabButton
            active={step.tab === 'categories'}
            onClick={() => onSwitchTab('categories')}
            label="Categories"
            icon={<Folder className="h-3.5 w-3.5" />}
          />
          <TabButton
            active={step.tab === 'scrapes'}
            onClick={() => onSwitchTab('scrapes')}
            label="Scrapes"
            icon={<FileText className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {step.loading ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : null}

      {step.error ? (
        <div className="border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {step.error}
        </div>
      ) : null}

      {!step.loading && step.tab === 'categories' ? (
        step.categories && step.categories.length > 0 ? (
          <div className="border border-border">
            {step.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPickCategory(c)}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/40"
              >
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.leadCount} leads · updated {formatDateTime(c.updatedAt)}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Import →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            No categories on the desktop yet.
          </div>
        )
      ) : null}

      {!step.loading && step.tab === 'scrapes' ? (
        step.scrapes && step.scrapes.length > 0 ? (
          <div className="border border-border">
            {step.scrapes.map((s) => (
              <button
                key={s.jobId}
                type="button"
                onClick={() => onPickScrape(s)}
                className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-accent/40"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.targetName ?? s.summary}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.usernameCount} leads · {s.kind} · {formatDateTime(s.completedAt)}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Import →</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            No scrape results on the desktop yet.
          </div>
        )
      ) : null}
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors ' +
        (active
          ? 'border-b-2 border-foreground text-foreground'
          : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground')
      }
    >
      {icon}
      {label}
    </button>
  );
}
