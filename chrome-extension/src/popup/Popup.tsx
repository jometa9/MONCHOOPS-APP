import { useEffect, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, ExternalLink, Instagram, Key, LogOut, Pause, Play } from 'lucide-react';
import { db } from '@/shared/db';
import { getSession, logout, validateLicense } from '@/shared/license';
import type { Campaign, Session } from '@/shared/types';
import { EMPTY_SESSION } from '@/shared/types';
import { HomeBg } from '@/shared/HomeBg';

export function Popup() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);
  const [igLoggedIn, setIgLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      setSession(s);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!session.hasLicense) return;
    chrome.runtime.sendMessage({ type: 'sw/igSessionCheck' }, (resp) => {
      if (resp?.ok) setIgLoggedIn(!!resp.data?.loggedIn);
    });
  }, [session.hasLicense]);

  if (loading) {
    return (
      <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (!session.hasLicense) {
    return <LicenseGate onLogin={(s) => setSession(s)} />;
  }

  return <ConnectedPanel session={session} igLoggedIn={igLoggedIn} onLogout={async () => { await logout(); setSession(EMPTY_SESSION); }} />;
}

function LicenseGate({ onLogin }: { onLogin: (s: Session) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const s = await validateLicense(key);
      onLogin(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('popup.couldNotValidate'));
    } finally {
      setSubmitting(false);
    }
  }

  function fillTest() {
    setKey('123');
  }

  return (
    <div className="relative isolate flex h-[440px] flex-col">
      <HomeBg />
      <header className="border-b border-border bg-muted/30 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">{t('popup.welcome')}</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('popup.signInHint')}
        </p>
      </header>

      <form onSubmit={submit} className="flex-1 space-y-3 p-4">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground" htmlFor="lk">
          {t('popup.licenseKey')}
        </label>
        <div className="relative">
          <Key className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="lk"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t('popup.pasteLicense')}
            autoFocus
            disabled={submitting}
            className="h-9 w-full border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground disabled:opacity-50"
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting || !key.trim()}
          className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? t('popup.loggingIn') : t('popup.continue')}
        </button>
        <button
          type="button"
          onClick={fillTest}
          disabled={submitting}
          className="inline-flex h-9 w-full items-center justify-center border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          {t('popup.useTestLicense')}
        </button>
      </form>

      <footer className="border-t border-border p-3 text-center">
        <a
          href="https://b2dm.app"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
        >
          {t('popup.noAccount')} <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </div>
  );
}

function ConnectedPanel({
  session,
  igLoggedIn,
  onLogout,
}: {
  session: Session;
  igLoggedIn: boolean | null;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const activeCampaigns = useLiveQuery(
    () =>
      db.campaigns
        .where('status')
        .anyOf('running', 'paused')
        .toArray()
        .then((rows) => rows.sort((a, b) => b.createdAt - a.createdAt)),
    [],
    [] as Campaign[]
  );

  const openDashboard = (path?: string) => {
    chrome.runtime.sendMessage({ type: 'sw/openDashboard', path });
    window.close();
  };

  const openIg = () => {
    chrome.tabs.create({ url: 'https://www.instagram.com/' });
    window.close();
  };

  return (
    <div className="relative isolate flex min-h-[440px] flex-col">
      <HomeBg />
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{session.profile?.name || 'MonchoOps'}</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {session.profile?.email ?? ''} · {session.subscription?.plan ?? 'free'}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label={t('popup.logOut')}
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 space-y-4 p-4">
        <section className="border border-border bg-background">
          <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Instagram className="h-3 w-3" />
              {t('popup.instagramSession')}
            </span>
            <span
              className={
                'text-[11px] font-medium ' +
                (igLoggedIn === null
                  ? 'text-muted-foreground'
                  : igLoggedIn
                  ? 'text-emerald-600'
                  : 'text-destructive')
              }
            >
              {igLoggedIn === null
                ? t('popup.checking')
                : igLoggedIn
                ? t('popup.active')
                : t('popup.notLoggedIn')}
            </span>
          </header>
          <div className="p-3 text-xs text-muted-foreground">
            {igLoggedIn ? (
              <>{t('popup.operatesOnAccount')}</>
            ) : (
              <Trans
                i18nKey="popup.logIntoIgFirst"
                components={[
                  <button
                    type="button"
                    onClick={openIg}
                    className="text-foreground underline-offset-2 hover:underline"
                  />,
                ]}
              />
            )}
          </div>
        </section>

        <ActiveProcessesSection
          campaigns={activeCampaigns ?? []}
          onOpen={(id) => openDashboard(`/campaigns/${id}`)}
          onOpenAll={() => openDashboard('/campaigns')}
        />
      </div>

      <footer className="border-t border-border bg-muted/30 p-3">
        <button
          type="button"
          onClick={() => openDashboard()}
          className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {t('popup.openDashboard')}
        </button>
      </footer>
    </div>
  );
}

const ACTIVE_LIMIT = 4;

function ActiveProcessesSection({
  campaigns,
  onOpen,
  onOpenAll,
}: {
  campaigns: Campaign[];
  onOpen: (campaignId: string) => void;
  onOpenAll: () => void;
}) {
  const { t } = useTranslation();
  const visible = campaigns.slice(0, ACTIVE_LIMIT);
  const hidden = campaigns.length - visible.length;

  return (
    <section className="border border-border bg-background">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3 w-3" />
          {t('popup.activeProcesses')}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {campaigns.length}
        </span>
      </header>
      {campaigns.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">
          {t('popup.noCampaignsRunning')}
        </div>
      ) : (
        <>
          <ul>
            {visible.map((c) => (
              <ActiveCampaignRow key={c.id} campaign={c} onOpen={() => onOpen(c.id)} />
            ))}
          </ul>
          {hidden > 0 ? (
            <button
              type="button"
              onClick={onOpenAll}
              className="flex w-full items-center justify-center border-t border-border px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
            >
              {t('popup.moreViewAll', { count: hidden })}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}

function ActiveCampaignRow({
  campaign,
  onOpen,
}: {
  campaign: Campaign;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const processed = campaign.sentCount + campaign.failedCount;
  const total = campaign.totalLeads || 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const isRunning = campaign.status === 'running';

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1.5 px-3 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {isRunning ? (
              <Play className="h-3 w-3 shrink-0 text-emerald-600" />
            ) : (
              <Pause className="h-3 w-3 shrink-0 text-amber-600" />
            )}
            <span className="truncate text-xs font-medium">{campaign.name}</span>
          </span>
          <span
            className={
              'shrink-0 text-[10px] font-medium uppercase tracking-wide ' +
              (isRunning ? 'text-emerald-600' : 'text-amber-600')
            }
          >
            {isRunning ? t('popup.running') : t('popup.paused')}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden bg-muted">
          <div
            className={'h-full ' + (isRunning ? 'bg-emerald-500' : 'bg-amber-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{t('popup.processed', { processed, total })}</span>
          {campaign.failedCount > 0 ? (
            <span className="text-destructive">
              {t('popup.failed', { count: campaign.failedCount })}
            </span>
          ) : null}
        </div>
      </button>
    </li>
  );
}
