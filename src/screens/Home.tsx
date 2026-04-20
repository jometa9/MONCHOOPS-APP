import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Users } from 'lucide-react';
import { useSession } from '@/context/SessionContext';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import { UpdateBanner } from '@/components/common/UpdateBanner';

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
  if (h < 24) {
    const rm = m - h * 60;
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  if (d < 30) {
    const rh = h - d * 24;
    return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
  }
  const mo = Math.floor(d / 30);
  if (mo < 12) {
    const rd = d - mo * 30;
    return rd > 0 ? `${mo}mo ${rd}d` : `${mo}mo`;
  }
  const y = Math.floor(d / 365);
  const rd = d - y * 365;
  return rd > 0 ? `${y}y ${rd}d` : `${y}y`;
}

export function Home() {
  const { session } = useSession();
  const { usableAccounts } = useAccounts();
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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden">
      <div className="relative z-10 mx-auto w-full max-w-4xl pb-40 p-16">
        <UpdateBanner />
        <h1 className="text-2xl font-semibold tracking-tight pt-2">Welcome back, {name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">What do you want to do today?</p>

        <div className="mt-8 grid grid-cols-2 border-l border-t border-border">
          <ActionCard
            to="/scrape"
            icon={<Users className="h-5 w-5" />}
            title="Scrape Leads"
            description="Build a list of usernames from followers, hashtags, or posts."
            cta="New scrape"
          />
          <ActionCard
            to="/cold-dm"
            icon={<Send className="h-5 w-5" />}
            title="Cold DM"
            description="Launch a DM campaign to your lead list."
            cta="New campaign"
          />
        </div>

        <div className="grid grid-cols-4 border-l border-border">
          <StatCard label="Accounts" value={formatCount(usableAccounts.length)} />
          <StatCard label="Leads" value={formatCount(stats.totalLeads)} />
          <StatCard label="Messages" value={formatCount(stats.totalMessages)} />
          <StatCard label="Time saved" value={formatTimeSaved(stats.timeSavedMs * 5)} />
        </div>
      </div>
    </div>
  );
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
      <span className="mt-4 inline-flex h-9 items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
        {cta}
      </span>
    </Link>
  );
}
