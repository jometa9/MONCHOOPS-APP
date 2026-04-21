import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/common/Spinner';
import { useJobs } from '@/context/JobsContext';
import { b2dm } from '@/lib/b2dm';
import { cn } from '@/lib/cn';
import type { JobStatus } from '@/types/domain';

export type JobStartedKind = 'scrape' | 'dm';

interface JobStartedPanelProps {
  jobId: string;
  kind: JobStartedKind;
  wasEnqueued: boolean;
  onReset: () => void;
}

export function JobStartedPanel({ jobId, kind, wasEnqueued, onReset }: JobStartedPanelProps) {
  const { active, progressByJob } = useJobs();
  const [finalStatus, setFinalStatus] = useState<JobStatus | null>(null);
  const completed = finalStatus != null;

  useEffect(() => {
    const off = b2dm.jobs.onDone((evt) => {
      if (evt.jobId !== jobId) return;
      setFinalStatus(evt.status as JobStatus);
    });
    return () => {
      off();
    };
  }, [jobId]);

  const job = active.find((j) => j.id === jobId) ?? null;
  const progress = progressByJob[jobId];
  const isQueued = !completed && job?.status === 'queued';
  const isRunning = !completed && job?.status === 'running';

  const done = progress?.done ?? job?.progressDone ?? 0;
  const total = progress?.total ?? job?.progressTotal ?? null;
  const pct =
    completed && finalStatus === 'completed'
      ? 100
      : total && total > 0
      ? Math.min(100, Math.round((done / total) * 100))
      : null;

  const noun = kind === 'scrape' ? 'Scrape' : 'Cold DM';
  const title = completed
    ? finalStatus === 'completed'
      ? `${noun} completed`
      : finalStatus === 'cancelled'
      ? `${noun} cancelled`
      : `${noun} failed`
    : isQueued || (wasEnqueued && !isRunning)
    ? `${noun} queued`
    : `${noun} started`;

  const subtitle = completed
    ? finalStatus === 'completed'
      ? kind === 'scrape'
        ? 'Leads are ready. Open View data to review and export.'
        : 'All DMs have been sent. Check DM History for delivery details.'
      : finalStatus === 'cancelled'
      ? 'The job was cancelled before finishing.'
      : 'The job stopped due to an error. Check the Queue for details.'
    : isQueued || (wasEnqueued && !isRunning)
    ? 'The account is busy — this job will start once earlier jobs finish. Track it in the Queue.'
    : kind === 'scrape'
    ? 'Collecting leads. Progress updates in real time.'
    : 'Sending DMs. Progress updates in real time.';

  const showDataButton = kind === 'scrape';
  const dataEnabled = showDataButton && completed && finalStatus === 'completed';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-4 pt-4 pb-20">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

      <div className="mt-4 border border-border bg-background">
        <div className="border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Progress
        </div>
        <div className="p-3">
          {isQueued ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" />
              <span>Waiting for the account to free up…</span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full transition-[width]',
                      completed && finalStatus !== 'completed'
                        ? 'bg-muted-foreground/40'
                        : 'bg-foreground/70'
                    )}
                    style={{ width: pct != null ? `${pct}%` : isRunning ? '30%' : '0%' }}
                  />
                </div>
                <div className="tabular-nums text-xs text-muted-foreground">
                  {total != null ? `${done}/${total}` : `${done}`}
                </div>
              </div>
              {progress?.lastItem ? (
                <div className="truncate text-[11px] text-muted-foreground">
                  @{progress.lastItem}
                </div>
              ) : null}
            </div>
          )}
        </div>
        <div className="flex items-stretch border-t border-border">
          {showDataButton ? (
            dataEnabled ? (
              <Link
                to="/data"
                className="inline-flex h-9 items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                View data
              </Link>
            ) : (
              <span
                aria-disabled="true"
                className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-muted-foreground opacity-50"
              >
                View data
              </span>
            )
          ) : null}
          {kind === 'scrape' ? (
            <Link
              to="/categories"
              className="inline-flex h-9 items-center gap-1.5 border-r border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              View categories
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-9 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Queue another
          </button>
        </div>
      </div>
    </div>
  );
}
