import { useCallback, useState } from 'react';
import { Loader, RefreshCw, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useSession } from '@/context/SessionContext';
import { useTheme } from '@/context/ThemeContext';
import { usePreferences } from '@/context/PreferencesContext';
import { b2dm } from '@/lib/b2dm';

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {title}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-sm first:border-t-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{value ?? '—'}</span>
    </div>
  );
}

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
    <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-sm first:border-t-0">
      <span className="text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

export function Settings() {
  const { session, refresh } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { prefs, setHeadless, setFullWindow, setSoundsEnabled } = usePreferences();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingAccounts, setIsDeletingAccounts] = useState(false);
  const [isDeletingScrapes, setIsDeletingScrapes] = useState(false);

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

  const planLabel = session.subscription
    ? `${session.subscription.plan}${session.subscription.version ? ` · v${session.subscription.version}` : ''}`
    : '—';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account, preferences, and stored data.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {/* Account */}
          <div className="border border-border bg-background">
            <SectionHeader title="Account" />
            <InfoRow label="Name" value={session.profile?.name} />
            <InfoRow label="Email" value={session.profile?.email} />
            <InfoRow label="Plan" value={<span className="capitalize">{planLabel}</span>} />
            <div className="flex items-stretch border-t border-border">
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isRefreshing ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh subscription
              </button>
            </div>
          </div>

          {/* Preferences */}
          <div className="border border-border bg-background">
            <SectionHeader title="Preferences" />
            <SwitchRow
              label="Headless mode"
              checked={prefs.headless}
              onCheckedChange={setHeadless}
            />
            <SwitchRow
              label="Full window"
              checked={prefs.fullWindow}
              onCheckedChange={setFullWindow}
              disabled={prefs.headless}
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

          {/* Data */}
          <div className="border border-border bg-background">
            <SectionHeader title="Data" />
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => void handleDeleteAccounts()}
                disabled={isDeletingAccounts}
                className="inline-flex h-9 items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isDeletingAccounts ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete all IG accounts
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteScrapes()}
                disabled={isDeletingScrapes}
                className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isDeletingScrapes ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete all scraped data
              </button>
            </div>
          </div>
        </div>
    </div>
  );
}
