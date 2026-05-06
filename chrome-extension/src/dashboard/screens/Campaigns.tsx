import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowRight, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { db } from '@/shared/db';
import { ScreenHeader } from '../components/ScreenHeader';
import { formatDateTime } from '@/shared/format';
import type { Campaign } from '@/shared/types';

export function Campaigns() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const campaigns = useLiveQuery(
    () => db.campaigns.orderBy('createdAt').reverse().toArray(),
    [],
    [] as Campaign[]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScreenHeader
        title={t('screens.campaigns.title')}
        description={t('screens.campaigns.description')}
        actions={
          <button
            type="button"
            onClick={() => navigate('/campaigns/new')}
            className="inline-flex h-8 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('nav.newColdDm')}
          </button>
        }
      />

      {campaigns && campaigns.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium">{t('screens.campaigns.noneYet')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('screens.campaigns.noneHint')}
            </p>
            <button
              type="button"
              onClick={() => navigate('/campaigns/new')}
              className="mt-4 inline-flex h-9 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('nav.newColdDm')}
            </button>
          </div>
        </div>
      ) : null}

      {campaigns && campaigns.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">{t('screens.campaigns.thName')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaigns.thStatus')}</th>
                <th className="px-4 py-2 text-right">{t('screens.campaigns.thSent')}</th>
                <th className="px-4 py-2 text-right">{t('screens.campaigns.thFailed')}</th>
                <th className="px-4 py-2 text-right">{t('screens.campaigns.thTotal')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaigns.thCreated')}</th>
                <th className="px-4 py-2 text-left">{t('screens.campaigns.thNextRun')}</th>
                <th className="px-2 py-2 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <CampaignRow key={c.id} campaign={c} onOpen={() => navigate(`/campaigns/${c.id}`)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function CampaignRow({ campaign, onOpen }: { campaign: Campaign; onOpen: () => void }) {
  const { t } = useTranslation();
  async function pause(e: React.MouseEvent) {
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: 'sw/pauseCampaign', campaignId: campaign.id });
  }
  async function resume(e: React.MouseEvent) {
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: 'sw/resumeCampaign', campaignId: campaign.id });
  }
  async function remove(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(t('screens.campaigns.deleteConfirm', { name: campaign.name }))) return;
    await db.campaigns.delete(campaign.id);
  }

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-border transition-colors hover:bg-accent/40"
    >
      <td className="px-4 py-2 font-medium">{campaign.name}</td>
      <td className="px-4 py-2">
        <StatusPill status={campaign.status} />
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{campaign.sentCount}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
        {campaign.failedCount}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
        {campaign.totalLeads}
      </td>
      <td className="px-4 py-2 text-muted-foreground">{formatDateTime(campaign.createdAt)}</td>
      <td className="px-4 py-2 text-muted-foreground">
        {campaign.status === 'done'
          ? formatDateTime(campaign.completedAt)
          : campaign.nextRunAt
          ? formatDateTime(campaign.nextRunAt)
          : '—'}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-0.5">
          {campaign.status === 'paused' ? (
            <button
              type="button"
              onClick={resume}
              aria-label={t('screens.campaigns.actionResume')}
              className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          ) : campaign.status === 'running' ? (
            <button
              type="button"
              onClick={pause}
              aria-label={t('screens.campaigns.actionPause')}
              className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            aria-label={t('screens.campaigns.actionOpen')}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label={t('screens.campaigns.actionDelete')}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: Campaign['status'] }) {
  const { t } = useTranslation();
  const map: Record<Campaign['status'], { label: string; className: string }> = {
    running: { label: t('screens.campaigns.statusRunning'), className: 'bg-emerald-100 text-emerald-700' },
    paused: { label: t('screens.campaigns.statusPaused'), className: 'bg-amber-100 text-amber-700' },
    done: { label: t('screens.campaigns.statusDone'), className: 'bg-muted text-muted-foreground' },
  };
  const { label, className } = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}>
      {label}
    </span>
  );
}
