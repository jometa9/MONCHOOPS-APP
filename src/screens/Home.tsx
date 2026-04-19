import { useEffect, useState } from 'react';
import { useSession } from '@/context/SessionContext';
import { useAccounts } from '@/context/AccountsContext';
import { useJobs } from '@/context/JobsContext';
import { b2dm } from '@/lib/b2dm';

interface Stats {
  totalJobs: number;
  totalLeads: number;
}

export function Home() {
  const { session } = useSession();
  const { accounts } = useAccounts();
  const { running } = useJobs();
  const [stats, setStats] = useState<Stats>({ totalJobs: 0, totalLeads: 0 });

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

        <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Plan" value={<span className="capitalize">{session.subscription?.plan ?? 'free'}</span>} />
          <StatCard label="Accounts" value={accounts.length} />
          <StatCard label="Running" value={running.length} />
          <StatCard label="Jobs" value={stats.totalJobs} />
          <StatCard label="Leads" value={stats.totalLeads} />
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-medium tabular-nums">{value}</div>
    </div>
  );
}
