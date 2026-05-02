import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Pause, Play, Zap } from 'lucide-react';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import type { Lead } from '@/shared/types';

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
  async function runNow() {
    await chrome.runtime.sendMessage({ type: 'sw/runCampaignNow', campaignId: id });
  }

  return (
    <div className="flex flex-1 flex-col">
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
            {campaign.status === 'scheduled' || campaign.status === 'running' ? (
              <button
                type="button"
                onClick={pause}
                className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Pause className="h-3.5 w-3.5" />
                Pause
              </button>
            ) : null}
            {campaign.status !== 'done' ? (
              <button
                type="button"
                onClick={runNow}
                className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Zap className="h-3.5 w-3.5" />
                Run now
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
          {campaign.schedule ? (
            <>
              <h3 className="mt-4 mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Schedule
              </h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>
                  Days:{' '}
                  {campaign.schedule.daysOfWeek
                    .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d])
                    .join(', ')}
                </li>
                <li>
                  Window: {campaign.schedule.startTime} – {campaign.schedule.endTime}
                </li>
                <li>Avg interval: {Math.round(campaign.schedule.intervalMs / 1000)}s</li>
              </ul>
            </>
          ) : null}
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
