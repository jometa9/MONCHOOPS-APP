import { Link } from 'react-router-dom';
import { FolderTree, MessageSquare, MessageSquareText, Send } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '@/shared/db';

export function Home() {
  const { t } = useTranslation();

  const totalCampaigns = useLiveQuery(() => db.campaigns.count(), [], 0);
  const totalSent = useLiveQuery(
    () => db.history.where('status').equals('sent').count(),
    [],
    0
  );
  const totalCategories = useLiveQuery(
    async () => {
      const rows = await db.categories.toArray();
      return rows.filter((r) => !r.deletedAt).length;
    },
    [],
    0
  );
  const totalLeadsInCategories = useLiveQuery(
    async () => {
      const rows = await db.categories.toArray();
      return rows
        .filter((r) => !r.deletedAt)
        .reduce((acc, r) => acc + (r.leadCount || 0), 0);
    },
    [],
    0
  );

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden">
      <div className="relative z-10 mx-auto w-full max-w-4xl pb-40 p-16">
        <h1 className="text-2xl font-semibold tracking-tight pt-2">
          {t('screens.home.welcome')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('screens.home.prompt')}
        </p>

        <div className="mt-8 grid grid-cols-2 border-l border-t border-border">
          <ActionCard
            to="/campaigns/new"
            icon={<Send className="h-5 w-5" />}
            title={t('screens.home.coldDmTitle')}
            description={t('screens.home.coldDmDescription')}
            cta={t('screens.home.coldDmCta')}
          />
          <ActionCard
            to="/categories"
            icon={<FolderTree className="h-5 w-5" />}
            title={t('screens.home.categoriesTitle')}
            description={t('screens.home.categoriesDescription')}
            cta={t('screens.home.categoriesCta')}
          />
        </div>

        <div className="grid grid-cols-4 border-l border-border">
          <StatCard label={t('screens.home.statCategories')} value={formatCount(totalCategories ?? 0)} />
          <StatCard label={t('screens.home.statLeads')} value={formatCount(totalLeadsInCategories ?? 0)} />
          <StatCard label={t('screens.home.statCampaigns')} value={formatCount(totalCampaigns ?? 0)} />
          <StatCard label={t('screens.home.statMessagesSent')} value={formatCount(totalSent ?? 0)} />
        </div>

        <div className="mt-8 grid grid-cols-2 border-l border-t border-border">
          <Link
            to="/campaigns"
            className="group flex items-center gap-3 border-b border-r border-border bg-background/40 p-4 transition-colors hover:bg-accent/40"
          >
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('screens.home.linkActiveCampaigns')}</span>
          </Link>
          <Link
            to="/variants"
            className="group flex items-center gap-3 border-b border-r border-border bg-background/40 p-4 transition-colors hover:bg-accent/40"
          >
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('screens.home.linkMessageVariants')}</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (!n || n < 1000) return String(n ?? 0);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-r border-border bg-muted/30 p-5">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-medium tabular-nums">{value}</div>
    </div>
  );
}

function ActionCard({
  to,
  icon,
  title,
  description,
  cta,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="group flex cursor-pointer flex-col justify-between border-b border-r border-border bg-muted/30 p-5 transition-colors hover:bg-muted/60"
    >
      <div>
        <div className="flex items-center gap-2 text-foreground">
          {icon}
          <div className="text-sm font-semibold">{title}</div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <span className="mt-4 inline-flex h-9 cursor-pointer items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
        {cta}
      </span>
    </Link>
  );
}
