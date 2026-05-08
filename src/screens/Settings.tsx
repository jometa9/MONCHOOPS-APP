import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader, RefreshCw, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Select } from '@/components/ui/select';
import { useSession } from '@/context/SessionContext';
import { useTheme } from '@/context/ThemeContext';
import { usePreferences } from '@/context/PreferencesContext';
import { b2dm } from '@/lib/b2dm';
import {
  getLocalePreference,
  setLocalePreference,
  type LocalePreference,
} from '@/lib/i18n';

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
  const { t } = useTranslation();
  const { session, refresh } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { prefs, setHeadless, setFullWindow, setSoundsEnabled } = usePreferences();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingAccounts, setIsDeletingAccounts] = useState(false);
  const [isDeletingScrapes, setIsDeletingScrapes] = useState(false);
  const [isWipingAll, setIsWipingAll] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [locale, setLocale] = useState<LocalePreference>(() => getLocalePreference());

  useEffect(() => {
    let cancelled = false;
    void b2dm.settings.getAppVersion().then((v) => {
      if (!cancelled) setAppVersion(v);
    });
    return () => {
      cancelled = true;
    };
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
    if (!confirm(t('settings.confirmDeleteAccounts'))) return;
    setIsDeletingAccounts(true);
    try {
      await b2dm.settings.deleteAllAccounts();
    } finally {
      setIsDeletingAccounts(false);
    }
  }, [t]);

  const handleDeleteScrapes = useCallback(async () => {
    if (!confirm(t('settings.confirmDeleteScrapes'))) return;
    setIsDeletingScrapes(true);
    try {
      await b2dm.settings.deleteAllScrapes();
    } finally {
      setIsDeletingScrapes(false);
    }
  }, [t]);

  const handleWipeAllData = useCallback(async () => {
    if (!confirm(t('settings.confirmWipeAll'))) {
      return;
    }
    setIsWipingAll(true);
    try {
      await b2dm.settings.wipeAllData();

      try {
        localStorage.clear();
      } catch {}
      window.location.reload();
    } finally {
      setIsWipingAll(false);
    }
  }, [t]);

  const handleLocaleChange = useCallback((next: LocalePreference) => {
    setLocale(next);
    setLocalePreference(next);
  }, []);

  const planLabel = session.subscription?.plan ?? '—';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 py-4 pb-30">
        <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('settings.description')}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {}
          <div className="border border-border bg-background">
            <SectionHeader title={t('settings.account')} />
            <InfoRow label={t('settings.name')} value={session.profile?.name} />
            <InfoRow label={t('settings.email')} value={session.profile?.email} />
            <InfoRow label={t('settings.plan')} value={<span className="capitalize">{planLabel}</span>} />
            <InfoRow label={t('settings.appVersion')} value={appVersion ? `V${appVersion}` : '—'} />
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
                {t('settings.refreshSubscription')}
              </button>
            </div>
          </div>

          {}
          <div className="border border-border bg-background">
            <SectionHeader title={t('settings.languageSection')} />
            <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-foreground">{t('settings.language')}</span>
              <Select<LocalePreference>
                value={locale}
                onChange={handleLocaleChange}
                ariaLabel={t('settings.language')}
                options={[
                  { value: 'system', label: t('settings.languageSystem') },
                  { value: 'en', label: t('settings.languageEnglish') },
                  { value: 'es', label: t('settings.languageSpanish') },
                ]}
              />
            </div>
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {t('settings.languageHint')}
            </p>
          </div>

          {}
          <div className="border border-border bg-background">
            <SectionHeader title={t('settings.preferences')} />
            <SwitchRow
              label={t('settings.headless')}
              checked={prefs.headless}
              onCheckedChange={setHeadless}
            />
            {!prefs.headless && (
              <SwitchRow
                label={t('settings.fullWindow')}
                checked={prefs.fullWindow}
                onCheckedChange={setFullWindow}
              />
            )}
            <SwitchRow
              label={t('settings.darkTheme')}
              checked={resolvedTheme === 'dark'}
              onCheckedChange={(v) => setTheme(v ? 'dark' : 'light')}
            />
            <SwitchRow
              label={t('settings.soundsOnCompletion')}
              checked={prefs.soundsEnabled}
              onCheckedChange={setSoundsEnabled}
            />
          </div>

          {}
          <div className="border border-border bg-background">
            <SectionHeader title={t('settings.data')} />
            <div className="flex items-stretch border-t border-border">
              <button
                type="button"
                onClick={() => void handleDeleteAccounts()}
                disabled={isDeletingAccounts || isWipingAll}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 border-r border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isDeletingAccounts ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('settings.deleteIgAccounts')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteScrapes()}
                disabled={isDeletingScrapes || isWipingAll}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 border-r border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isDeletingScrapes ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('settings.deleteAllScrapes')}
              </button>
              <button
                type="button"
                onClick={() => void handleWipeAllData()}
                disabled={isDeletingAccounts || isDeletingScrapes || isWipingAll}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isWipingAll ? (
                  <Loader className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {t('settings.deleteAllData')}
              </button>
            </div>
          </div>
        </div>
    </div>
  );
}
