import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { monchoops } from '@/lib/monchoops';
import type { AccountPublic } from '@/types/domain';

interface AccountsContextValue {

  accounts: AccountPublic[];

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
      const list = await monchoops.accounts.list();
      setAccounts(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const off = monchoops.accounts.onChange(() => {
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
