import { useMemo, useState } from 'react';
import { ArrowRight, ListTodo, X } from 'lucide-react';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { useJobs } from '@/context/JobsContext';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import type { JobKind, JobPublic } from '@/types/domain';

const KIND_LABEL: Record<JobKind, string> = {
  login: 'Login',
  mass_dm: 'Cold DM',
  scrape_by_username: 'Scrape · username',
  scrape_by_post: 'Scrape · post',
  scrape_by_hashtag: 'Scrape · hashtag',
  scrape_by_location: 'Scrape · location',
  warmup: 'Warmup',
};

function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function Queue() {
  const { active, progressByJob } = useJobs();
  const { accounts } = useAccounts();
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const accountById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.id, a.username);
    return map;
  }, [accounts]);

  // Running first, then queued (FIFO). For login jobs (no accountId) we keep
  // them at the end — they're transient anyway.
  const orderedJobs = useMemo(() => {
    const running = active.filter((j) => j.status === 'running');
    const queued = active
      .filter((j) => j.status === 'queued')
      .sort((a, b) => a.startedAt - b.startedAt);
    return [...running, ...queued];
  }, [active]);

  async function cancel(jobId: string) {
    setCancellingIds((prev) => new Set(prev).add(jobId));
    try {
      await b2dm.jobs.cancel(jobId);
    } catch {
      setCancellingIds((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  }

  if (orderedJobs.length === 0) {
    return (
      <EmptyState
        icon={<ListTodo className="h-10 w-10" />}
        title="Nothing running"
        description="Jobs in progress or waiting show up here."
        action={
          <EmptyStateLinkButton to="/scrape" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            Start scraping leads
          </EmptyStateLinkButton>
        }
      />
    );
  }

  return (
    <div className="bg-background">
      <table className="w-full whitespace-nowrap text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Status</th>
              <th className="px-3 py-1.5 text-left">Job</th>
              <th className="px-3 py-1.5 text-left">Account</th>
              <th className="px-3 py-1.5 text-left">Progress</th>
              <th className="px-3 py-1.5 text-right">Elapsed</th>
              <th className="px-3 py-1.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orderedJobs.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                accountUsername={job.accountId ? accountById.get(job.accountId) ?? null : null}
                progress={progressByJob[job.id]}
                cancelling={cancellingIds.has(job.id)}
                onCancel={() => void cancel(job.id)}
              />
            ))}
          </tbody>
        </table>
    </div>
  );
}

interface QueueRowProps {
  job: JobPublic;
  accountUsername: string | null;
  progress?: { done: number; total: number | null; lastItem?: string };
  cancelling: boolean;
  onCancel: () => void;
}

function QueueRow({ job, accountUsername, progress, cancelling, onCancel }: QueueRowProps) {
  const isQueued = job.status === 'queued';
  const done = progress?.done ?? job.progressDone;
  const total = progress?.total ?? job.progressTotal;
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <tr className="border-t border-border even:bg-muted/30 last:border-b">
      <td className="px-3 py-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide',
            isQueued
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary/10 text-primary'
          )}
        >
          {isQueued ? null : <Spinner className="h-2.5 w-2.5" />}
          {isQueued ? 'Queued' : 'Running'}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <div className="font-medium">{KIND_LABEL[job.kind] ?? job.kind}</div>
        {progress?.lastItem ? (
          <div className="text-[11px] text-muted-foreground" title={progress.lastItem}>
            @{progress.lastItem}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {accountUsername ? `@${accountUsername}` : '—'}
      </td>
      <td className="px-3 py-1.5">
        {isQueued ? (
          <span className="text-[11px] text-muted-foreground">Waiting for account</span>
        ) : (
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground/70 transition-[width]"
                style={{ width: pct != null ? `${pct}%` : '30%' }}
              />
            </div>
            <div className="tabular-nums text-xs text-muted-foreground">
              {total != null ? `${done}/${total}` : `${done}`}
            </div>
          </div>
        )}
      </td>
      <td className="px-3 py-1.5 text-right text-muted-foreground tabular-nums">
        {isQueued || job.runningAt == null ? '—' : formatElapsed(job.runningAt)}
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            title={
              cancelling
                ? 'Cancelling…'
                : isQueued
                ? 'Remove from queue'
                : 'Cancel and keep partial results'
            }
            aria-label="Cancel job"
          >
            {cancelling ? <Spinner /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}
