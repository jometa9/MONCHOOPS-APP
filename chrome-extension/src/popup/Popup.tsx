import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, Instagram, Pause, Play } from 'lucide-react';
import { db } from '@/shared/db';
import type { Campaign } from '@/shared/types';
import { HomeBg } from '@/shared/HomeBg';

export function Popup() {
  const { t } = useTranslation();
  const [igLoggedIn, setIgLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'sw/igSessionCheck' }, (resp) => {
      if (resp?.ok) setIgLoggedIn(!!resp.data?.loggedIn);
    });
  }, []);

  return <ConnectedPanel igLoggedIn={igLoggedIn} />;
}

function ConnectedPanel({ igLoggedIn }: { igLoggedIn: boolean | null }) {
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
          <h1 className="truncate text-sm font-semibold">MonchoOps</h1>
        </div>
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
