import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, Instagram, MessageCircle, Search, Send } from 'lucide-react';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { b2dm } from '@/lib/b2dm';
import { formatDateTime } from '@/lib/format';
import type { MassDmResultPublic, MassDmSendPublic } from '@/types/domain';

export function ColdDmHistoryDetail() {
  const { t } = useTranslation();
  const { jobId = '' } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<MassDmResultPublic | null>(null);
  const [rows, setRows] = useState<MassDmSendPublic[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [meta, list] = await Promise.all([
        b2dm.massDms.get(jobId),
        b2dm.massDms.listSends(jobId),
      ]);
      if (cancelled) return;
      setResult(meta);
      setRows(list);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.username.toLowerCase().includes(q) ||
        (row.message ?? '').toLowerCase().includes(q)
    );
  }, [rows, query]);

  function goBack() {
    navigate('/dm-history');
  }

  if (rows === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-stretch border-b border-border bg-background">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-9 items-center gap-1.5 border-r border-border bg-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t('screens.coldDmHistoryDetail.backAria')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('screens.coldDmHistoryDetail.back')}
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('screens.coldDmHistoryDetail.searchPlaceholder')}
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {result ? (
          <div className="flex items-center gap-2 border-l border-border px-3 text-xs text-muted-foreground">
            {result.accountUsername ? (
              <span className="inline-flex items-center gap-1.5 truncate">
                <Instagram className="h-3 w-3" />@{result.accountUsername}
              </span>
            ) : null}
            <span className="tabular-nums">
              {`· ${result.sentCount} ${t('screens.coldDmHistoryDetail.sentSuffix')}`}
              {result.failedCount > 0
                ? ` · ${result.failedCount} ${t('screens.coldDmHistoryDetail.failedSuffix')}`
                : ''}
            </span>
            <span className="tabular-nums">· {formatDateTime(result.completedAt)}</span>
          </div>
        ) : null}
      </div>

      {filteredRows!.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-border">
          <EmptyState
            icon={rows.length === 0 ? <Send className="h-10 w-10" /> : <Search className="h-10 w-10" />}
            title={t('screens.coldDmHistoryDetail.noLogTitle')}
            description={
              rows.length === 0
                ? t('screens.coldDmHistoryDetail.noLogDescription')
                : t('screens.coldDmHistoryDetail.noMatchDescription')
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-t border-border bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">{t('screens.coldDmHistoryDetail.tableMessage')}</th>
                <th className="px-3 py-1.5 text-left whitespace-nowrap">{t('screens.coldDmHistoryDetail.tableUsername')}</th>
                <th className="px-3 py-1.5 text-right whitespace-nowrap">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows!.map((row, idx) => {
                const openProfile = () =>
                  void b2dm.openExternalLink(
                    `https://www.instagram.com/${encodeURIComponent(row.username)}/`
                  );
                const openChat = () =>
                  void b2dm.openExternalLink(
                    `https://ig.me/m/${encodeURIComponent(row.username)}`
                  );
                const isFailed = row.status === 'failed';
                return (
                  <tr
                    key={`${row.username}-${row.sentAt}-${idx}`}
                    className="border-t border-border transition-colors even:bg-muted/30 last:border-b"
                  >
                    <td className="px-3 py-1.5 align-top">
                      {row.message ? (
                        <span
                          className={
                            isFailed
                              ? 'whitespace-pre-wrap text-muted-foreground line-through'
                              : 'whitespace-pre-wrap'
                          }
                        >
                          {row.message}
                        </span>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">
                          {isFailed
                            ? (row.error ?? t('screens.coldDmHistoryDetail.notSent'))
                            : t('screens.coldDmHistoryDetail.noMessage')}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 align-top font-medium whitespace-nowrap">
                      @{row.username}
                    </td>
                    <td className="px-2 py-1.5 align-top whitespace-nowrap">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={openProfile}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t('screens.coldDmHistoryDetail.openProfile', { username: row.username })}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={openChat}
                          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t('screens.coldDmHistoryDetail.openChat', { username: row.username })}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
