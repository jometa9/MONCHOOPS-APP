import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Users } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { useAccounts } from '@/context/AccountsContext';
import { useJobs } from '@/context/JobsContext';
import { b2dm } from '@/lib/b2dm';

interface Stats {
  totalJobs: number;
  totalLeads: number;
  totalMessages: number;
  timeSavedMs: number;
}

function formatCount(n: number): string {
  if (!n || n < 1000) return String(n ?? 0);
  if (n < 1_000_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
}

function formatTimeSaved(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function Home() {
  const { session } = useSession();
  const { accounts } = useAccounts();
  const { running } = useJobs();
  const [stats, setStats] = useState<Stats>({
    totalJobs: 0,
    totalLeads: 0,
    totalMessages: 0,
    timeSavedMs: 0,
  });

  const name = session.profile?.name?.trim() || session.profile?.email?.split('@')[0] || 'there';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await b2dm.stats.get();
        if (!cancelled) setStats(next);
      } catch {}
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="mx-auto w-full max-w-3xl pb-40 p-16">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Instagram accounts, run mass DM campaigns, and scrape username lists.
        </p>

        <div className="mt-8 grid gap-4 grid-cols-4">
          <StatCard label="Plan" value={<span className="capitalize">{session.subscription?.plan ?? 'free'}</span>} />
          <StatCard label="Accounts" value={formatCount(accounts.length)} />
          <StatCard label="Running" value={formatCount(running.length)} />
          <StatCard label="Jobs" value={formatCount(stats.totalJobs)} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <StatCard label="Leads" value={formatCount(stats.totalLeads)} />
          <StatCard label="Messages" value={formatCount(stats.totalMessages)} />
          <StatCard label="Time saved" value={formatTimeSaved(stats.timeSavedMs)} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <ActionCard
            to="/scrape"
            icon={<Users className="h-5 w-5" />}
            title="Scrape Leads"
            description="Extract usernames from followers, following, or engagement lists."
            cta="Start scrape"
          />
          <ActionCard
            to="/cold-dm"
            icon={<Send className="h-5 w-5" />}
            title="Cold DM"
            description="Send mass DMs to a list of usernames from your linked accounts."
            cta="Start campaign"
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5">
      <div className="text-xs uppercase  text-muted-foreground">{label}</div>
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
      className="group flex cursor-pointer flex-col justify-between rounded-xl border border-border bg-muted/30 p-5 transition-colors hover:bg-muted/60"
    >
      <div>
        <div className="flex items-center gap-2 text-foreground">
          {icon}
          <div className="text-sm font-semibold">{title}</div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <span className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
        {cta}
      </span>
    </Link>
  );
}
