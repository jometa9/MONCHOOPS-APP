import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ListTodo, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CategoryChip } from '@/components/common/CategoryChip';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { ScrapeSummary } from '@/components/common/ScrapeSummary';
import { Spinner } from '@/components/common/Spinner';
import { useJobs } from '@/context/JobsContext';
import { useAccounts } from '@/context/AccountsContext';
import { b2dm } from '@/lib/b2dm';
import type { JobKind, JobPublic, LeadCategoryPublic, ScrapeKind } from '@/types/domain';

const SCRAPE_KINDS: ReadonlyArray<ScrapeKind> = [
  'scrape_by_username',
  'scrape_by_post',
  'scrape_by_hashtag',
  'scrape_by_location',
];

function isScrapeKind(kind: JobKind): kind is ScrapeKind {
  return (SCRAPE_KINDS as readonly JobKind[]).includes(kind);
}

function formatKind(kind: string): string {
  const spaced = kind.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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
  const { t } = useTranslation();
  const { active, progressByJob } = useJobs();
  const { accounts } = useAccounts();
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<LeadCategoryPublic[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const list = await b2dm.categories.list();
      if (!cancelled) setCategories(list);
    }
    void load();
    const off = b2dm.categories.onChange(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const accountById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) map.set(a.id, a.username);
    return map;
  }, [accounts]);

  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.name);
    return map;
  }, [categories]);

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
        title={t('screens.queue.nothingRunning')}
        description={t('screens.queue.nothingDescription')}
        action={
          <EmptyStateLinkButton to="/scrape" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            {t('screens.queue.startScraping')}
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
              <th className="px-3 py-1.5 text-left">{t('screens.queue.tableStatus')}</th>
              <th className="px-3 py-1.5 text-left">{t('screens.queue.tableJob')}</th>
              <th className="px-3 py-1.5 text-left">{t('screens.queue.tableCategory')}</th>
              <th className="px-3 py-1.5 text-left">{t('screens.queue.tableProgress')}</th>
              <th className="px-3 py-1.5 text-right">{t('screens.queue.tableElapsed')}</th>
              <th className="px-3 py-1.5 text-right">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {orderedJobs.map((job) => (
              <QueueRow
                key={job.id}
                job={job}
                accountUsername={job.accountId ? accountById.get(job.accountId) ?? null : null}
                categoryName={resolveCategoryName(job, categoryNameById)}
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
  categoryName: string | null;
  progress?: { done: number; total: number | null; lastItem?: string };
  cancelling: boolean;
  onCancel: () => void;
}

function QueueRow({
  job,
  accountUsername,
  categoryName,
  progress,
  cancelling,
  onCancel,
}: QueueRowProps) {
  const { t } = useTranslation();
  const isQueued = job.status === 'queued';
  const done = progress?.done ?? job.progressDone;
  const total = progress?.total ?? job.progressTotal;
  const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <tr className="border-t border-border even:bg-muted/30 last:border-b">
      <td className="px-3 py-1.5">
        {isQueued ? (
          <Badge variant="muted">{t('screens.queue.queued')}</Badge>
        ) : (
          <Badge variant="warning">
            <Spinner className="h-2.5 w-2.5" />
            {t('screens.queue.running')}
          </Badge>
        )}
      </td>
      <td className="px-3 py-1.5">
        <JobTitle job={job} />
        <div className="text-[11px] text-muted-foreground">
          {formatKind(job.kind)}
          {accountUsername ? (
            <>
              {' '}
              {t('screens.queue.withAccount')}{' '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void b2dm.openExternalLink(
                    `https://www.instagram.com/${encodeURIComponent(accountUsername)}/`
                  );
                }}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                @{accountUsername}
              </button>
            </>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-1.5">
        {categoryName ? (
          <CategoryChip name={categoryName} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {isQueued ? (
          <span className="text-[11px] text-muted-foreground">{t('screens.queue.waitingForAccount')}</span>
        ) : (
          <div className="flex flex-col gap-1">
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
            {progress?.lastItem ? (
              <div className="truncate text-[11px] text-muted-foreground">
                {t('screens.queue.extracting', { username: progress.lastItem })}
              </div>
            ) : null}
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
            aria-label={t('screens.queue.cancelJob')}
          >
            {cancelling ? <Spinner /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function JobTitle({ job }: { job: JobPublic }) {
  const { t } = useTranslation();
  if (isScrapeKind(job.kind)) {
    return (
      <ScrapeSummary
        kind={job.kind}
        params={job.params}
        targetName={null}
        className="text-sm font-medium"
      />
    );
  }
  const label = job.kind === 'login' ? t('screens.queue.loginJob') : t('screens.queue.massDmJob');
  return <div className="text-sm font-medium">{label}</div>;
}

function resolveCategoryName(
  job: JobPublic,
  categoryNameById: Map<string, string>
): string | null {
  if (!job.params || typeof job.params !== 'object') return null;
  const raw = (job.params as Record<string, unknown>).categoryId;
  if (typeof raw !== 'string' || raw === '') return null;
  return categoryNameById.get(raw) ?? null;
}
