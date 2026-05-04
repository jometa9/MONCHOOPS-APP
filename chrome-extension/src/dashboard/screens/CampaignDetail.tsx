import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Clock, MonitorSmartphone, Pause, Play, RefreshCw } from 'lucide-react';
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
  const { id } = useParams<{ id: string }>();
  const campaign = useLiveQuery(() => (id ? db.campaigns.get(id) : undefined), [id]);
  const leads = useLiveQuery(
    () => (id ? db.leads.where('campaignId').equals(id).toArray() : []),
    [id],
    [] as Lead[]
  );

  if (!id || campaign === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (campaign === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Not found.
      </div>
    );
  }

  const sent = leads?.filter((l) => l.status === 'sent').length ?? 0;
  const failed = leads?.filter((l) => l.status === 'failed').length ?? 0;
  const pending = leads?.filter((l) => l.status === 'pending').length ?? 0;
  const sending = leads?.filter((l) => l.status === 'sending').length ?? 0;

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
        description={`Status: ${campaign.status} · Created ${formatDateTime(campaign.createdAt)}`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/campaigns')}
              className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            {campaign.status === 'paused' ? (
              <button
                type="button"
                onClick={resume}
                className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                Resume
              </button>
            ) : null}
            {campaign.status === 'running' ? (
              <button
                type="button"
                onClick={pause}
                className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-3 border-b border-border bg-muted/20 p-4">
        <Stat label="Total" value={campaign.totalLeads} />
        <Stat label="Sent" value={sent} accent="emerald" />
        <Stat label="Failed" value={failed} accent="red" />
        <Stat label="Pending" value={pending + sending} />
      </div>

      <NextSendTimer campaign={campaign} pending={pending + sending} />

      <div className="grid min-h-0 flex-1 grid-cols-3 gap-0">
        <aside className="col-span-1 overflow-auto border-r border-border bg-muted/10 p-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Variants
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
                Interactions
              </h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {campaign.interactions.follow ? <li>Follow user</li> : null}
                {campaign.interactions.watchStories ? (
                  <li>Watch stories ({campaign.interactions.storyDwellSec}s each)</li>
                ) : null}
                {campaign.interactions.likeCount > 0 ? (
                  <li>Like {campaign.interactions.likeCount} posts</li>
                ) : null}
              </ul>
            </>
          ) : null}
          <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Send rate
          </h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>Avg interval: {Math.round(campaign.intervalMs / 1000)}s</li>
          </ul>
        </aside>

        <section className="col-span-2 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Lead</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Sent at</th>
                <th className="px-4 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {leads?.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-b-0">
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const src = campaign.source;
  if (src.kind === 'manual') return null;

  async function sync() {
    if (src.kind === 'manual') return; // unreachable — guarded by early return
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
        setMessage({ kind: 'info', text: 'No new leads on the desktop.' });
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
          // If the campaign had finished, re-open it so the SW picks
          // up the new pending leads.
          status: campaign.status === 'done' ? 'running' : campaign.status,
          completedAt: campaign.status === 'done' ? undefined : campaign.completedAt,
          nextRunAt: Date.now(),
        });
      });
      // Re-arm the worker if we re-opened a finished campaign.
      if (campaign.status === 'done') {
        await chrome.runtime.sendMessage({
          type: 'sw/runCampaignNow',
          campaignId: campaign.id,
        });
      }
      setMessage({ kind: 'info', text: `Pulled ${newOnes.length} new leads.` });
    } catch (err) {
      const text =
        err instanceof BridgeError
          ? err.code === 'no_desktop'
            ? 'Desktop app is not running.'
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
        Desktop source
      </h3>
      <div className="border border-border bg-background p-3 text-xs">
        <div className="flex items-start gap-2">
          <MonitorSmartphone className="mt-0.5 h-3.5 w-3.5 flex-none text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate font-medium">{src.label}</div>
            <p className="mt-0.5 text-muted-foreground">
              Linked to the desktop app. Click sync to pull leads added there after this
              campaign was created.
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
            {busy ? 'Syncing…' : 'Sync from desktop'}
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
    text = 'Campaign paused';
  } else if (remainingMs === null) {
    text = 'Waiting to schedule next send…';
  } else if (remainingMs === 0) {
    text = 'Sending now…';
  } else {
    text = `Next send in ${formatDuration(remainingMs)}`;
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
  const map: Record<Lead['status'], { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
    sending: { label: 'Sending', className: 'bg-blue-100 text-blue-700' },
    sent: { label: 'Sent', className: 'bg-emerald-100 text-emerald-700' },
    failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
    skipped: { label: 'Skipped', className: 'bg-amber-100 text-amber-700' },
  };
  const { label, className } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}
