import { cn } from '@/lib/cn';
import { Instagram } from 'lucide-react';
import type { AccountPublic } from '@/types/domain';

interface Props {
  accounts: AccountPublic[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function AccountPicker({ accounts, value, onChange, disabled }: Props) {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        You need to link an Instagram account first.
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {accounts.map((acc) => {
        const isActive = value === acc.id;
        const busy = acc.status === 'busy';
        return (
          <button
            key={acc.id}
            type="button"
            onClick={() => onChange(acc.id)}
            disabled={disabled || busy}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              isActive ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-accent/50'
            )}
          >
            {acc.profilePicUrl ? (
              <img
                src={acc.profilePicUrl}
                alt={acc.username}
                className="h-9 w-9 rounded-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Instagram className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">@{acc.username}</div>
              <div className="text-[11px] text-muted-foreground">
                {busy ? 'Busy' : acc.status === 'error' ? 'Error' : 'Idle'}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
