import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { b2dm } from '@/lib/b2dm';
import type { AccountPublic } from '@/types/domain';

interface AccountsContextValue {
  // Full list — use only in the Accounts screen table and in ID→account
  // lookups for already-existing entities (running jobs, saved schedules).
  accounts: AccountPublic[];
  // Same list minus error-status accounts — use everywhere else (pickers,
  // counts, dashboards) so broken accounts don't get offered for new work.
  usableAccounts: AccountPublic[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const AccountsContext = createContext<AccountsContextValue | null>(null);

export function AccountsProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<AccountPublic[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await b2dm.accounts.list();
      setAccounts(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = b2dm.accounts.onChange(() => {
      void refresh();
    });
    return () => off();
  }, [refresh]);

  const usableAccounts = useMemo(
    () => accounts.filter((a) => a.status !== 'error'),
    [accounts]
  );

  const value = useMemo<AccountsContextValue>(
    () => ({ accounts, usableAccounts, loading, refresh }),
    [accounts, usableAccounts, loading, refresh]
  );
  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
}

export function useAccounts(): AccountsContextValue {
  const ctx = useContext(AccountsContext);
  if (!ctx) throw new Error('useAccounts must be used within <AccountsProvider>');
  return ctx;
}
