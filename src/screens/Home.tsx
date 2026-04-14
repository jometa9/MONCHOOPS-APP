import { useSession } from '@/context/SessionContext';
import { useAccounts } from '@/context/AccountsContext';
import { useJobs } from '@/context/JobsContext';

export function Home() {
  const { session } = useSession();
  const { accounts } = useAccounts();
  const { running } = useJobs();
  const name = session.profile?.name?.trim() || session.profile?.email?.split('@')[0] || 'there';

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect your Instagram accounts, run mass DM campaigns, and scrape username lists.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Plan</div>
          <div className="mt-1 text-base font-medium capitalize">{session.subscription?.plan ?? 'free'}</div>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Instagram accounts</div>
          <div className="mt-1 text-base font-medium tabular-nums">{accounts.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-background p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Running jobs</div>
          <div className="mt-1 text-base font-medium tabular-nums">{running.length}</div>
        </div>
      </div>
    </div>
  );
}
