import { useMemo, useState } from 'react';
import { Check, Flame, Instagram, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/badge';
import { EmptyPanel } from '@/components/common/EmptyPanel';
import { EmptyState } from '@/components/common/EmptyState';
import { useJobs } from '@/context/JobsContext';
import type { AccountPublic } from '@/types/domain';

function StatusBadge({ status }: { status: AccountPublic['status'] }) {
  if (status === 'busy') return <Badge variant="warning">Running</Badge>;
  if (status === 'error') return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="success">Idle</Badge>;
}

function WarmedBadge() {
  return (
    <Badge variant="default">
      <Flame className="h-2.5 w-2.5" />
      Warmed
    </Badge>
  );
}

interface Props {
  accounts: AccountPublic[];
  value: string | null;
  onChange: (id: string) => void;
}

export function AccountStep({ accounts, value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const { active } = useJobs();

  const queueDepthById = useMemo(() => {
    const map = new Map<string, number>();
    for (const j of active) {
      if (!j.accountId || j.status !== 'queued') continue;
      map.set(j.accountId, (map.get(j.accountId) ?? 0) + 1);
    }
    return map;
  }, [active]);

  // Error-status accounts have no valid session — omit them from the picker
  // so the user can't start a job that will fail at the first Playwright step.
  const usable = useMemo(
    () => accounts.filter((a) => a.status !== 'error'),
    [accounts]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return usable;
    return usable.filter((a) =>
      [a.username, a.displayName ?? ''].some((s) => s.toLowerCase().includes(q))
    );
  }, [usable, query]);

  if (usable.length === 0) {
    const hasErrorAccounts = accounts.length > 0;
    return (
      <EmptyPanel
        icon={<Instagram className="h-8 w-8" />}
        title={hasErrorAccounts ? 'No working accounts' : 'No accounts yet'}
        description={
          hasErrorAccounts
            ? 'All your linked accounts are in an error state. Retry or remove them from the Accounts screen.'
            : 'Link an Instagram account from the Accounts screen first.'
        }
      />
    );
  }

  return (
    <div className="overflow-hidden border border-border bg-background">
      <div className="flex items-stretch border-b border-border bg-background">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search accounts by username…"
            className="h-9 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex h-[50vh] flex-col overflow-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="No results"
            description="No accounts match your search."
            className="py-0"
          />
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left">Account</th>
                <th className="px-3 py-1.5 text-left">Status</th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((acc) => {
                const selected = value === acc.id;
                const queued = queueDepthById.get(acc.id) ?? 0;
                return (
                  <tr
                    key={acc.id}
                    onClick={() => onChange(acc.id)}
                    className={cn(
                      'cursor-pointer border-t border-border transition-colors even:bg-muted/30 last:border-b hover:bg-accent/40',
                      selected && 'bg-primary/5 hover:bg-primary/10'
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2.5">
                        {acc.profilePicUrl ? (
                          <img
                            src={acc.profilePicUrl}
                            alt={acc.username}
                            referrerPolicy="no-referrer"
                            className="h-6 w-6 flex-none rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Instagram className="h-3 w-3" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium leading-tight">@{acc.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={acc.status} />
                        {acc.isWarmed ? <WarmedBadge /> : null}
                        {queued > 0 ? (
                          <Badge variant="muted">+{queued} queued</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="w-8 px-2 py-1.5 text-right">
                      {selected ? (
                        <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
