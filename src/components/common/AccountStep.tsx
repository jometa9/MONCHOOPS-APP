import { useMemo, useState } from 'react';
import { Check, Instagram, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { EmptyPanel } from '@/components/common/EmptyPanel';
import type { AccountPublic } from '@/types/domain';

interface Props {
  accounts: AccountPublic[];
  value: string | null;
  onChange: (id: string) => void;
}

export function AccountStep({ accounts, value, onChange }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.username, a.displayName ?? ''].some((s) => s.toLowerCase().includes(q))
    );
  }, [accounts, query]);

  if (accounts.length === 0) {
    return (
      <EmptyPanel
        icon={<Instagram className="h-8 w-8" />}
        title="No accounts yet"
        description="Link an Instagram account from the Accounts screen first."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="sticky top-0 z-10 flex items-stretch border-b border-border bg-background">
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
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left">Account</th>
              <th className="px-3 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className="border-t border-border">
                <td colSpan={2} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No accounts match your search.
                </td>
              </tr>
            ) : (
              filtered.map((acc) => {
                const selected = value === acc.id;
                const busy = acc.status === 'busy';
                return (
                  <tr
                    key={acc.id}
                    onClick={() => !busy && onChange(acc.id)}
                    className={cn(
                      'cursor-pointer border-t border-border transition-colors hover:bg-accent/40',
                      selected && 'bg-primary/5 hover:bg-primary/10',
                      busy && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        {acc.profilePicUrl ? (
                          <img
                            src={acc.profilePicUrl}
                            alt={acc.username}
                            referrerPolicy="no-referrer"
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Instagram className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">@{acc.username}</div>
                          {acc.displayName ? (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {acc.displayName}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                          busy && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                          acc.status === 'error' && 'bg-destructive/10 text-destructive',
                          acc.status === 'idle' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {busy ? 'Busy' : acc.status === 'error' ? 'Error' : 'Idle'}
                      </span>
                      {selected ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-primary">
                          <Check className="h-3 w-3" />
                          Selected
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
