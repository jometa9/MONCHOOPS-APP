import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Clock, MonitorSmartphone, Pause, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import {
  BridgeError,
  listCategoryLeads,
  listScrapeLeads,
} from '@/shared/desktop-bridge';
import type { Campaign, Lead } from '@/shared/types';

export function CampaignDetail() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const campaign = useLiveQuery(() => (id ? db.campaigns.get(id) : undefined), [id]);
  const leads = useLiveQuery(
    () => (id ? db.leads.where('campaignId').equals(id).toArray() : []),
    [id],
    [] as Lead[]
  );

  let activeIndex = -1;
  if (leads) {
    const sendingIdx = leads.findIndex((l) => l.status === 'sending');
    if (sendingIdx >= 0) {
      activeIndex = sendingIdx;
    } else {
      for (let i = leads.length - 1; i >= 0; i--) {
        if (leads[i].status === 'sent' || leads[i].status === 'failed') {
          activeIndex = i;
          break;
        }
      }
    }
  }
  const activeLeadId = activeIndex >= 0 ? leads?.[activeIndex]?.id : undefined;
  const activeStatus = activeIndex >= 0 ? leads?.[activeIndex]?.status : undefined;
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLeadId, activeStatus]);

  if (!id || campaign === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (campaign === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('common.notFound')}
      </div>
    );
  }

  const sent = leads?.filter((l) => l.status === 'sent').length ?? 0;
  const failed = leads?.filter((l) => l.status === 'failed').length ?? 0;
  const pending = leads?.filter((l) => l.status === 'pending').length ?? 0;
  const sending = leads?.filter((l) => l.status === 'sending').length ?? 0;

  const statusLabel =
    campaign.status === 'running'
      ? t('screens.campaigns.statusRunning')
      : campaign.status === 'paused'
      ? t('screens.campaigns.statusPaused')
      : t('screens.campaigns.statusDone');

  async function pause() {
    await chrome.runtime.sendMessage({ type: 'sw/pauseCampaign', campaignId: id });
  }
  async function resume() {
    await chrome.runtime.sendMessage({ type: 'sw/resumeCampaign', campaignId: id });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={campaign.name}
        description={t('screens.campaignDetail.statusLine', {
          status: statusLabel,
          when: formatDateTime(campaign.createdAt),
        })}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/campaigns')}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('screens.campaignDetail.back')}
            </button>
            {campaign.status === 'paused' ? (
              <button
                type="button"
                onClick={resume}
                className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                {t('screens.campaignDetail.resume')}
              </button>
            ) : null}
            {campaign.status === 'running' ? (
              <button
                type="button"
                onClick={pause}
                className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Pause className="h-3.5 w-3.5" />
                {t('screens.campaignDetail.pause')}
              </button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-3 border-b border-border bg-muted/20 p-4">
        <Stat label={t('screens.campaignDetail.statTotal')} value={campaign.totalLeads} />
        <Stat label={t('screens.campaignDetail.statSent')} value={sent} accent="emerald" />
        <Stat label={t('screens.campaignDetail.statFailed')} value={failed} accent="red" />
        <Stat label={t('screens.campaignDetail.statPending')} value={pending + sending} />
      </div>

      <NextSendTimer campaign={campaign} pending={pending + sending} />

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
        <aside className="col-span-1 overflow-auto border-r border-border bg-muted/10 p-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('screens.campaignDetail.variantsHeading')}
          </h3>
          <ul className="space-y-2">
            {campaign.variants.map((v, i) => (
              <li key={i} className="border border-border bg-background p-2 text-xs">
                {v}
              </li>
            ))}
          </ul>
          {campaign.source?.kind === 'desktop_category' ||
          campaign.source?.kind === 'desktop_scrape' ? (
            <DesktopSourcePanel campaign={campaign} />
          ) : null}
          {campaign.interactions ? (
            <>
              <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('screens.campaignDetail.interactionsHeading')}
              </h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {campaign.interactions.follow ? (
                  <li>{t('screens.campaignDetail.interactionFollow')}</li>
                ) : null}
                {campaign.interactions.watchStories ? (
                  <li>
                    {t('screens.campaignDetail.interactionWatchStories', {
                      seconds: campaign.interactions.storyDwellSec,
                    })}
                  </li>
                ) : null}
                {campaign.interactions.likeCount > 0 ? (
                  <li>
                    {t('screens.campaignDetail.interactionLikePosts', {
                      count: campaign.interactions.likeCount,
                    })}
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
          <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('screens.campaignDetail.sendRateHeading')}
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              {t('screens.campaignDetail.sendRateAvg', {
                seconds: Math.round(campaign.intervalMs / 1000),
              })}
            </li>
          </ul>
        </aside>

        <section className="col-span-2 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">{t('screens.campaignDetail.thLead')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaignDetail.thStatus')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaignDetail.thSentAt')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaignDetail.thNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {leads?.map((l, i) => (
                <tr
                  key={l.id}
                  ref={i === activeIndex ? activeRowRef : undefined}
                  className={
                    'border-b border-border last:border-b-0 ' +
                    (i === activeIndex ? 'bg-muted/40' : '')
                  }
                >
                  <td className="px-4 py-1.5 font-medium">@{l.displayName}</td>
                  <td className="px-4 py-1.5">
                    <LeadPill status={l.status} />
                  </td>
                  <td className="px-4 py-1.5 text-muted-foreground">
                    {l.sentAt ? formatDateTime(l.sentAt) : '—'}
                  </td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">
                    {l.error ?? l.sentMessage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function DesktopSourcePanel({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const src = campaign.source;
  if (src.kind === 'manual') return null;

  async function sync() {
    if (src.kind === 'manual') return;
    setBusy(true);
    setMessage(null);
    try {
      const fresh =
        src.kind === 'desktop_category'
          ? await listCategoryLeads(src.desktopId)
          : await listScrapeLeads(src.desktopJobId);
      const existing = new Set(
        (await db.leads.where('campaignId').equals(campaign.id).toArray()).map((l) => l.username)
      );
      const newOnes = fresh.filter((l) => !existing.has(l.username));
      if (newOnes.length === 0) {
        setMessage({ kind: 'info', text: t('screens.campaignDetail.desktopNoNewLeads') });
        return;
      }
      await db.transaction('rw', db.campaigns, db.leads, async () => {
        await db.leads.bulkAdd(
          newOnes.map((l) => ({
            campaignId: campaign.id,
            username: l.username,
            displayName: l.displayName,
            status: 'pending' as const,
          }))
        );
        await db.campaigns.update(campaign.id, {
          totalLeads: campaign.totalLeads + newOnes.length,

          status: campaign.status === 'done' ? 'running' : campaign.status,
          completedAt: campaign.status === 'done' ? undefined : campaign.completedAt,
          nextRunAt: Date.now(),
        });
      });

      if (campaign.status === 'done') {
        await chrome.runtime.sendMessage({
          type: 'sw/runCampaignNow',
          campaignId: campaign.id,
        });
      }
      setMessage({
        kind: 'info',
        text: t('screens.campaignDetail.desktopPulledLeads', { count: newOnes.length }),
      });
    } catch (err) {
      const text =
        err instanceof BridgeError
          ? err.code === 'no_desktop'
            ? t('screens.campaignDetail.desktopNotRunning')
            : err.message
          : err instanceof Error
          ? err.message
          : String(err);
      setMessage({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('screens.campaignDetail.desktopSourceHeading')}
      </h3>
      <div className="border border-border bg-background p-3 text-xs">
        <div className="flex items-start gap-2">
          <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{src.label}</div>
            <p className="mt-0.5 text-muted-foreground">
              {t('screens.campaignDetail.desktopSourceLinked')}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sync()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-[11px] font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={'h-3 w-3 ' + (busy ? 'animate-spin' : '')} />
            {busy
              ? t('screens.campaignDetail.desktopSyncing')
              : t('screens.campaignDetail.desktopSyncFromDesktop')}
          </button>
        </div>
        {message ? (
          <p
            className={
              'mt-2 text-[11px] ' +
              (message.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')
            }
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </>
  );
}

function NextSendTimer({ campaign, pending }: { campaign: Campaign; pending: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (campaign.status === 'done' || pending === 0) return null;

  const paused = campaign.status === 'paused';
  const nextRunAt = campaign.nextRunAt;
  const remainingMs = nextRunAt ? Math.max(0, nextRunAt - now) : null;

  let text: string;
  if (paused) {
    text = t('screens.campaignDetail.campaignPaused');
  } else if (remainingMs === null) {
    text = t('screens.campaignDetail.waitingNext');
  } else if (remainingMs === 0) {
    text = t('screens.campaignDetail.sendingNow');
  } else {
    text = t('screens.campaignDetail.nextSendIn', { time: formatDuration(remainingMs) });
  }

  return (
    <div className="flex items-center gap-2 border-b border-border bg-background px-4 py-2 text-xs text-muted-foreground">
      <Clock className="h-3.5 w-3.5" />
      <span className="tabular-nums">{text}</span>
    </div>
  );
}

function formatDuration(ms: number) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: 'emerald' | 'red' }) {
  const color =
    accent === 'emerald'
      ? 'text-emerald-600'
      : accent === 'red'
      ? 'text-destructive'
      : 'text-foreground';
  return (
    <div className="border border-border bg-background p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function LeadPill({ status }: { status: Lead['status'] }) {
  const { t } = useTranslation();
  const map: Record<Lead['status'], { label: string; className: string }> = {
    pending: { label: t('screens.campaignDetail.leadStatusPending'), className: 'bg-muted text-muted-foreground' },
    sending: { label: t('screens.campaignDetail.leadStatusSending'), className: 'bg-blue-100 text-blue-700' },
    sent: { label: t('screens.campaignDetail.leadStatusSent'), className: 'bg-emerald-100 text-emerald-700' },
    failed: { label: t('screens.campaignDetail.leadStatusFailed'), className: 'bg-red-100 text-red-700' },
    skipped: { label: t('screens.campaignDetail.leadStatusSkipped'), className: 'bg-amber-100 text-amber-700' },
  };
  const { label, className } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}
