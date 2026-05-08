import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { monchoops } from '@/lib/monchoops';
import type { SessionSnapshot } from '@/types/session';
import { EMPTY_SESSION } from '@/types/session';

type Status = 'loading' | 'ready';

interface SessionContextValue {
  status: Status;
  session: SessionSnapshot;
  validateLicense: (key: string) => Promise<SessionSnapshot>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [session, setSession] = useState<SessionSnapshot>(EMPTY_SESSION);

  const refresh = useCallback(async () => {
    const next = await monchoops.getSession();
    setSession(next);
  }, []);

  const validateLicense = useCallback(async (key: string) => {
    const next = await monchoops.validateLicense(key);
    setSession(next);
    return next;
  }, []);

  const logout = useCallback(async () => {
    await monchoops.logout();
    setSession(EMPTY_SESSION);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await monchoops.getSession();
        if (!cancelled) setSession(snapshot);
      } finally {
        if (!cancelled) setStatus('ready');
      }
    })();
    const off = monchoops.onSessionChange((s) => setSession(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ status, session, validateLicense, logout, refresh }),
    [status, session, validateLicense, logout, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}
