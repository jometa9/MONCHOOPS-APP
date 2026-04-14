import { X } from 'lucide-react';
import { Spinner } from '@/components/common/Spinner';
import { useJobs } from '@/context/JobsContext';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';

function jobTitle(kind: string): string {
  switch (kind) {
    case 'login': return 'Linking Instagram account';
    case 'mass_dm': return 'Mass DM';
    case 'scrape_by_username': return 'Scrape by username';
    case 'scrape_by_post': return 'Scrape by post';
    case 'scrape_by_hashtag': return 'Scrape by hashtag';
    case 'scrape_by_location': return 'Scrape by location';
    default: return kind;
  }
}

export function StatusStrip() {
  const { running, progressByJob } = useJobs();
  const { accounts } = useAccounts();

  if (running.length === 0) return null;

  return (
    <div className="border-t border-border bg-muted/30 px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        {running.map((job) => {
          const progress = progressByJob[job.id];
          const account = job.accountId ? accounts.find((a) => a.id === job.accountId) : null;
          const done = progress?.done ?? job.progressDone;
          const total = progress?.total ?? job.progressTotal;
          const label = total ? `${done} / ${total}` : `${done}`;
          return (
            <div
              key={job.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            >
              <Spinner className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{jobTitle(job.kind)}</span>
              {account ? <span className="text-muted-foreground">@{account.username}</span> : null}
              <span className="rounded bg-muted px-1.5 py-0.5 tabular-nums text-[11px] text-muted-foreground">
                {label}
              </span>
              {progress?.lastItem ? (
                <span className="max-w-[140px] truncate text-muted-foreground">{progress.lastItem}</span>
              ) : null}
              <button
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                onClick={() => void b2dm.jobs.cancel(job.id)}
                title="Cancel job"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
