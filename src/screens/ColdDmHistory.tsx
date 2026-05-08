import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Eye, History, Instagram, Search } from 'lucide-react';
import { EmptyState, EmptyStateLinkButton } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { monchoops } from '@/lib/monchoops';
import { formatDateTime } from '@/lib/format';
import type { MassDmResultPublic } from '@/types/domain';

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

export function ColdDmHistory() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MassDmResultPublic[] | null>(null);
  const [query, setQuery] = useState('');

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.accountUsername ?? '').toLowerCase().includes(q));
  }, [rows, query]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await monchoops.massDms.list();
        if (!cancelled) setRows(list);
      } catch {}
    }
    void load();
    const off = monchoops.jobs.onDone(() => void load());
    const timer = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      off();
      clearInterval(timer);
    };
  }, []);

  if (rows === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-10 w-10" />}
        title={t('screens.coldDmHistory.noRunsTitle')}
        description={t('screens.coldDmHistory.noRunsDescription')}
        action={
          <EmptyStateLinkButton to="/cold-dm" icon={<ArrowRight className="h-3.5 w-3.5" />}>
            {t('screens.coldDmHistory.startSending')}
          </EmptyStateLinkButton>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-stretch bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.coldDmHistory.searchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      {filteredRows!.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title={t('common.noResults')}
            description={t('screens.coldDmHistory.noMatchDescription')}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.coldDmHistory.tableAccount')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.coldDmHistory.tableSent')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.coldDmHistory.tableFailed')}</th>
                <th className="px-3 py-1.5 text-right">{t('screens.coldDmHistory.tableDuration')}</th>
                <th className="px-3 py-1.5 text-left">{t('screens.coldDmHistory.tableCompleted')}</th>
                <th className="px-3 py-1.5 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows!.map((row) => (
                <tr
                  key={row.jobId}
                  onClick={() => navigate(`/dm-history/${row.jobId}`)}
                  className="cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40"
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {row.accountProfilePicUrl ? (
                        <img
                          src={row.accountProfilePicUrl}
                          alt={row.accountUsername ?? ''}
                          className="h-6 w-6 flex-none rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <Instagram className="h-3 w-3" />
                        </div>
                      )}
                      <span className="font-medium">
                        {row.accountUsername ? `@${row.accountUsername}` : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.sentCount}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {row.failedCount}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {formatDuration(row.durationMs)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">
                    {formatDateTime(row.completedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <div
                      className="flex items-center justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => navigate(`/dm-history/${row.jobId}`)}
                        className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        aria-label={t('screens.coldDmHistory.viewDetail')}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
