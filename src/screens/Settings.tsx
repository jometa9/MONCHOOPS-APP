import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Folder, Loader, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/context/SessionContext';
import { useTheme } from '@/context/ThemeContext';
import { usePreferences } from '@/context/PreferencesContext';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';

function SwitchRow({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex h-9 items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 text-sm">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const { session, refresh } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { prefs, setHeadless, setSoundsEnabled, setScrapeExportDir } = usePreferences();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingAccounts, setIsDeletingAccounts] = useState(false);
  const [isDeletingScrapes, setIsDeletingScrapes] = useState(false);
  const [scrapeDir, setScrapeDir] = useState('');
  const [isDirLoading, setIsDirLoading] = useState(false);

  useEffect(() => {
    void b2dm.settings.getScrapeExportDir().then(setScrapeDir);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await b2dm.settings.refreshSession();
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  const handleDeleteAccounts = useCallback(async () => {
    if (!confirm('This will delete ALL Instagram accounts. Are you sure?')) return;
    setIsDeletingAccounts(true);
    try {
      await b2dm.settings.deleteAllAccounts();
    } finally {
      setIsDeletingAccounts(false);
    }
  }, []);

  const handleDeleteScrapes = useCallback(async () => {
    if (!confirm('This will delete ALL scraped data. Are you sure?')) return;
    setIsDeletingScrapes(true);
    try {
      await b2dm.settings.deleteAllScrapes();
    } finally {
      setIsDeletingScrapes(false);
    }
  }, []);

  const handleBrowseDir = useCallback(async () => {
    setIsDirLoading(true);
    try {
      const dir = await b2dm.settings.selectDirectory();
      if (dir) {
        setScrapeDir(dir);
        setScrapeExportDir(dir);
        await b2dm.settings.setScrapeExportDir(dir);
      }
    } finally {
      setIsDirLoading(false);
    }
  }, [setScrapeExportDir]);

  const handleClearDir = useCallback(async () => {
    setScrapeDir('');
    setScrapeExportDir('');
    await b2dm.settings.setScrapeExportDir('');
  }, [setScrapeExportDir]);

  return (
    <div className="h-full overflow-auto bg-muted/20">
      <div className="flex flex-col">

        {/* Account */}
        <Section title="Account">
          <div className="flex flex-col gap-1.5">
            {session.profile && (
              <>
                <div className="text-sm font-medium text-foreground">{session.profile.name || session.profile.email}</div>
                {session.profile.name && (
                  <div className="text-xs text-muted-foreground">{session.profile.email}</div>
                )}
              </>
            )}
            {session.subscription && (
              <div className="text-xs text-muted-foreground capitalize">
                Plan: <span className="text-foreground font-medium">{session.subscription.plan}</span>
                {session.subscription.version && (
                  <span className="ml-2 text-muted-foreground">v{session.subscription.version}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border bg-background self-start">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-60"
            >
              {isRefreshing ? (
                <Loader className="h-4 w-4 animate-spin shrink-0" />
              ) : (
                <RefreshCw className="h-4 w-4 shrink-0" />
              )}
              Refresh subscription
            </button>
          </div>
        </Section>

        {/* App config */}
        <Section title="App config">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <SwitchRow
              label="Headless mode"
              checked={prefs.headless}
              onCheckedChange={setHeadless}
            />
            <SwitchRow
              label="Dark theme"
              checked={resolvedTheme === 'dark'}
              onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
            />
            <SwitchRow
              label="Sounds on completion"
              checked={prefs.soundsEnabled}
              onCheckedChange={setSoundsEnabled}
            />
          </div>
        </Section>

        {/* Data */}
        <Section title="Data management">
          <div className="flex flex-col gap-3">
            {/* Scrape export dir */}
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">
                Auto-export scraped CSVs to folder
              </p>
              <div className="flex overflow-hidden rounded-lg border border-border bg-background">
                <input
                  type="text"
                  readOnly
                  value={scrapeDir || 'Not configured — files stay in app data'}
                  className={cn(
                    'h-9 flex-1 bg-transparent px-3 text-sm outline-none truncate',
                    scrapeDir ? 'text-foreground' : 'text-muted-foreground'
                  )}
                />
                {scrapeDir && (
                  <button
                    type="button"
                    onClick={() => void handleClearDir()}
                    className="inline-flex h-9 w-9 items-center justify-center border-l border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    title="Clear"
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleBrowseDir()}
                  disabled={isDirLoading}
                  className="inline-flex h-9 items-center gap-2 border-l border-border px-3 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-60"
                >
                  {isDirLoading ? (
                    <Loader className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0" />
                  )}
                  Browse
                </button>
              </div>
            </div>

            {/* Danger zone */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleDeleteAccounts()}
                disabled={isDeletingAccounts}
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
              >
                {isDeletingAccounts ? (
                  <Loader className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <Trash2 className="h-4 w-4 shrink-0" />
                )}
                Delete all IG accounts
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteScrapes()}
                disabled={isDeletingScrapes}
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-60"
              >
                {isDeletingScrapes ? (
                  <Loader className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <Trash2 className="h-4 w-4 shrink-0" />
                )}
                Delete all scraped data
              </button>
            </div>
          </div>
        </Section>

        {/* Logs shortcut */}
        <Section title="Logs">
          <div className="flex overflow-hidden rounded-lg border border-border bg-background self-start">
            <Link
              to="/logs"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
            >
              <ScrollText className="h-4 w-4 shrink-0" />
              View live logs
            </Link>
          </div>
        </Section>

      </div>
    </div>
  );
}
