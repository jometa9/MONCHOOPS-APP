import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, ExternalLink, Instagram, Languages, LogOut, MonitorSmartphone } from 'lucide-react';
import { ScreenHeader } from '../components/ScreenHeader';
import { Select } from '../components/Select';
import { fetchUsage, getCachedUsage, getSession, logout } from '@/shared/license';
import { db } from '@/shared/db';
import { discoverDesktop, type DesktopPing } from '@/shared/desktop-bridge';
import type { Session, UsageSnapshot } from '@/shared/types';
import {
  getLocalePreference,
  setLocalePreference,
  type LocalePreference,
} from '@/shared/i18n';

export function Settings() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [igLoggedIn, setIgLoggedIn] = useState<boolean | null>(null);
  const [desktop, setDesktop] = useState<{
    state: 'unknown' | 'offline' | 'connected';
    ping?: DesktopPing;
  }>({ state: 'unknown' });
  const [locale, setLocale] = useState<LocalePreference>('system');
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);

  useEffect(() => {
    void getSession().then(setSession);
    chrome.runtime.sendMessage({ type: 'sw/igSessionCheck' }, (resp) => {
      if (resp?.ok) setIgLoggedIn(!!resp.data?.loggedIn);
    });
    void refreshDesktop();
    void getLocalePreference().then(setLocale);
    void getCachedUsage().then((u) => {
      if (u) setUsage(u);
    });
    void fetchUsage().then((u) => {
      if (u) setUsage(u);
    });
  }, []);

  async function refreshDesktop() {
    try {
      const { ping } = await discoverDesktop();
      setDesktop({ state: 'connected', ping });
    } catch {
      setDesktop({ state: 'offline' });
    }
  }

  async function handleLogout() {
    await logout();
    location.reload();
  }

  async function clearAllData() {
    if (!confirm(t('settings.clearAllDataConfirm'))) return;
    await db.campaigns.clear();
    await db.leads.clear();
    await db.history.clear();
    alert(t('settings.allDataCleared'));
  }

  async function handleLocaleChange(next: LocalePreference) {
    setLocale(next);
    await setLocalePreference(next);
  }

  if (!session) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader title={t('settings.title')} description={t('settings.description')} />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="grid gap-6 p-6 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <Section title={t('settings.license')}>
            <Row label={t('settings.email')} value={session.profile?.email ?? '—'} />
            <Row label={t('settings.name')} value={session.profile?.name ?? '—'} />
            <Row label={t('settings.plan')} value={session.subscription?.plan ?? '—'} />
            <Row
              label={t('settings.active')}
              value={session.subscription?.active ? t('common.yes') : t('common.no')}
            />
            <div className="pt-3">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t('common.logOut')}
              </button>
            </div>
          </Section>

          <Section title={t('settings.planUsage')}>
            <div className="flex items-start gap-3 text-sm">
              <BarChart3 className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1 space-y-2">
                <UsageBar
                  label={t('settings.accountsUsage')}
                  used={usage?.accounts.used ?? null}
                  limit={usage?.accounts.limit ?? null}
                  unlimitedLabel={t('settings.unlimited')}
                />
                <UsageBar
                  label={t('settings.dmsUsage')}
                  used={usage?.dms.used ?? null}
                  limit={usage?.dms.limit ?? null}
                  unlimitedLabel={t('settings.unlimited')}
                />
              </div>
            </div>
          </Section>

          <Section title={t('settings.language')}>
            <div className="flex items-start gap-3 text-sm">
              <Languages className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  {t('settings.languageHint')}
                </p>
                <div className="mt-3">
                  <Select<LocalePreference>
                    value={locale}
                    onChange={(v) => void handleLocaleChange(v)}
                    ariaLabel={t('settings.language')}
                    fullWidth
                    options={[
                      { value: 'system', label: t('settings.languageSystem') },
                      { value: 'en', label: t('settings.languageEnglish') },
                      { value: 'es', label: t('settings.languageSpanish') },
                    ]}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section title={t('settings.instagramSession')}>
            <div className="flex items-start gap-3 text-sm">
              <Instagram className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">
                  {igLoggedIn === null
                    ? t('common.checking')
                    : igLoggedIn
                    ? t('common.loggedIn')
                    : t('common.notLoggedIn')}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.instagramHint')}
                </p>
                <a
                  href="https://www.instagram.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                >
                  {t('settings.openInstagram')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </Section>

          <Section title={t('settings.desktopApp')}>
            <div className="flex items-start gap-3 text-sm">
              <MonitorSmartphone className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">
                  {desktop.state === 'unknown' ? t('common.checking') : null}
                  {desktop.state === 'offline' ? t('settings.desktopNotConnected') : null}
                  {desktop.state === 'connected'
                    ? t('settings.desktopConnected', { version: desktop.ping?.version ?? '?' })
                    : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t('settings.desktopHint')}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshDesktop()}
                    className="inline-flex h-8 items-center border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
                  >
                    {t('common.refresh')}
                  </button>
                </div>
              </div>
            </div>
          </Section>

          <Section title={t('settings.data')}>
            <p className="text-xs text-muted-foreground">
              {t('settings.dataHint')}
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={clearAllData}
                className="inline-flex h-9 items-center bg-destructive/10 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                {t('settings.clearAllData')}
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-background">
      <header className="border-b border-border bg-muted/30 px-4 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function UsageBar({
  label,
  used,
  limit,
  unlimitedLabel,
}: {
  label: string;
  used: number | null;
  limit: number | null;
  unlimitedLabel: string;
}) {
  const isUnlimited = limit == null;
  const ratio =
    !isUnlimited && used != null && limit != null && limit > 0
      ? Math.min(1, used / limit)
      : 0;
  const pct = Math.round(ratio * 100);
  const barColour =
    ratio >= 1
      ? 'bg-destructive'
      : ratio >= 0.9
      ? 'bg-amber-500'
      : 'bg-emerald-500';
  const textColour =
    ratio >= 1
      ? 'text-destructive'
      : ratio >= 0.9
      ? 'text-amber-600'
      : 'text-foreground';

  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${textColour}`}>
          {used == null
            ? '—'
            : isUnlimited
            ? `${used} / ${unlimitedLabel}`
            : `${used} / ${limit}`}
        </span>
      </div>
      {!isUnlimited && used != null ? (
        <div className="mt-1 h-1 w-full overflow-hidden bg-muted">
          <div className={`h-full ${barColour}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
