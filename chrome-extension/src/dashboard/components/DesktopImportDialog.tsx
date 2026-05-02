import { useEffect, useState } from 'react';
import { ArrowLeft, Database, FileText, Folder, Loader2, MonitorSmartphone } from 'lucide-react';
import {
  BridgeError,
  clearToken,
  discoverDesktop,
  getStoredToken,
  listCategoryLeads,
  listDesktopCategories,
  listDesktopScrapes,
  listScrapeLeads,
  pairWithDesktop,
  type DesktopCategory,
  type DesktopLead,
  type DesktopScrape,
} from '@/shared/desktop-bridge';
import { formatDateTime } from '@/shared/format';

type Step =
  | { kind: 'connecting' }
  | { kind: 'no_desktop' }
  | { kind: 'needs_pair' }
  | { kind: 'pairing'; code: string | null }
  | { kind: 'pair_error'; message: string }
  | { kind: 'picker'; tab: 'categories' | 'scrapes'; categories?: DesktopCategory[]; scrapes?: DesktopScrape[]; loading: boolean; error?: string }
  | { kind: 'loading_leads' }
  | { kind: 'fatal'; message: string };

interface Props {
  onImport: (leads: DesktopLead[], sourceLabel: string) => void;
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
    const token = await getStoredToken();
    if (!token) {
      setStep({ kind: 'needs_pair' });
      return;
    }
    await loadCategories();
  }

  async function startPairing() {
    setStep({ kind: 'pairing', code: null });
    try {
      await pairWithDesktop({
        name: 'B2DM Chrome extension',
        onCode: (code) => setStep({ kind: 'pairing', code }),
      });
      await loadCategories();
    } catch (err) {
      const msg =
        err instanceof BridgeError ? err.message : err instanceof Error ? err.message : String(err);
      setStep({ kind: 'pair_error', message: msg });
    }
  }

  async function loadCategories() {
    setStep({ kind: 'picker', tab: 'categories', loading: true });
    try {
      const categories = await listDesktopCategories();
      setStep({ kind: 'picker', tab: 'categories', categories, loading: false });
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'unauthorized') {
        setStep({ kind: 'needs_pair' });
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
      if (err instanceof BridgeError && err.code === 'unauthorized') {
        setStep({ kind: 'needs_pair' });
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
      onImport(leads, `Category — ${c.name}`);
      onClose();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'unauthorized') {
        setStep({ kind: 'needs_pair' });
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
      onImport(leads, label);
      onClose();
    } catch (err) {
      if (err instanceof BridgeError && err.code === 'unauthorized') {
        setStep({ kind: 'needs_pair' });
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
          {step.kind === 'connecting' ? <Centered icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Looking for the desktop app…" /> : null}

          {step.kind === 'no_desktop' ? (
            <Centered
              icon={<MonitorSmartphone className="h-6 w-6 text-muted-foreground" />}
              title="Desktop app not running"
              body="Open the B2DM desktop app on this computer and try again."
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

          {step.kind === 'needs_pair' ? (
            <Centered
              icon={<Database className="h-6 w-6 text-muted-foreground" />}
              title="Connect to the desktop app"
              body="The desktop app will show a confirmation dialog with a 4-digit code. Click Allow there once you confirm the codes match."
              action={
                <button
                  type="button"
                  onClick={() => void startPairing()}
                  className="inline-flex h-9 items-center bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Connect
                </button>
              }
            />
          ) : null}

          {step.kind === 'pairing' ? (
            <Centered
              icon={<Loader2 className="h-5 w-5 animate-spin" />}
              title="Waiting for the desktop app…"
              body="Approve the connection in the modal that just opened on the desktop app."
              codeLine={step.code}
            />
          ) : null}

          {step.kind === 'pair_error' ? (
            <Centered
              icon={<MonitorSmartphone className="h-6 w-6 text-destructive" />}
              title="Could not pair"
              body={step.message}
              action={
                <button
                  type="button"
                  onClick={() => void startPairing()}
                  className="inline-flex h-9 items-center bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Try again
                </button>
              }
            />
          ) : null}

          {step.kind === 'loading_leads' ? <Centered icon={<Loader2 className="h-5 w-5 animate-spin" />} title="Loading leads…" /> : null}

          {step.kind === 'picker' ? (
            <PickerView step={step} onSwitchTab={(t) => (t === 'scrapes' ? void loadScrapes() : void loadCategories())} onPickCategory={(c) => void pickCategory(c)} onPickScrape={(s) => void pickScrape(s)} onUnpair={async () => { await clearToken(); setStep({ kind: 'needs_pair' }); }} />
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
  codeLine,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
  codeLine?: string | null;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="text-sm font-medium">{title}</div>
      {body ? <p className="max-w-sm text-xs text-muted-foreground">{body}</p> : null}
      {codeLine ? (
        <div className="mt-3 border border-border bg-muted/30 px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Verification code
          </div>
          <div className="mt-1 font-mono text-3xl font-bold tracking-[0.5em]">{codeLine}</div>
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function PickerView({
  step,
  onSwitchTab,
  onPickCategory,
  onPickScrape,
  onUnpair,
}: {
  step: Extract<Step, { kind: 'picker' }>;
  onSwitchTab: (t: 'categories' | 'scrapes') => void;
  onPickCategory: (c: DesktopCategory) => void;
  onPickScrape: (s: DesktopScrape) => void;
  onUnpair: () => void;
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
        <button
          type="button"
          onClick={onUnpair}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Unpair
        </button>
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
