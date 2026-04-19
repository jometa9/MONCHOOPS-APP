import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { b2dm } from '@/lib/b2dm';
import { playCompletionSound } from '@/lib/sound';
import { usePreferences } from '@/context/PreferencesContext';
import type { JobPublic } from '@/types/domain';

interface JobProgress {
  done: number;
  total: number | null;
  lastItem?: string;
}

interface JobsContextValue {
  // All running + queued jobs (FIFO). Running appear first for a given account.
  active: JobPublic[];
  // Backward-compat subset: only running jobs. Consumers showing "spinner" can
  // keep using this without seeing queued entries.
  running: JobPublic[];
  progressByJob: Record<string, JobProgress>;
  refresh: () => Promise<void>;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<JobPublic[]>([]);
  const [progressByJob, setProgressByJob] = useState<Record<string, JobProgress>>({});
  const mountedRef = useRef(true);
  const { prefs } = usePreferences();
  const soundsEnabledRef = useRef(prefs.soundsEnabled);
  soundsEnabledRef.current = prefs.soundsEnabled;

  const refresh = useCallback(async () => {
    const list = await b2dm.jobs.listActive();
    if (!mountedRef.current) return;
    setActive(list);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const offChange = b2dm.jobs.onChange(() => {
      void refresh();
    });
    const offProgress = b2dm.jobs.onProgress((evt) => {
      setProgressByJob((prev) => ({
        ...prev,
        [evt.jobId]: { done: evt.done, total: evt.total, lastItem: evt.item },
      }));
    });
    const offDone = b2dm.jobs.onDone((evt) => {
      setProgressByJob((prev) => {
        const next = { ...prev };
        delete next[evt.jobId];
        return next;
      });
    });
    // Sound plays exactly once per account — when the account's whole queue
    // drains, not on every individual job completion.
    const offDrained = b2dm.jobs.onAccountDrained((evt) => {
      if (evt.status === 'completed' && soundsEnabledRef.current) {
        playCompletionSound();
      }
    });
    return () => {
      mountedRef.current = false;
      offChange();
      offProgress();
      offDone();
      offDrained();
    };
  }, [refresh]);

  const running = useMemo(() => active.filter((j) => j.status === 'running'), [active]);
  const value = useMemo<JobsContextValue>(
    () => ({ active, running, progressByJob, refresh }),
    [active, running, progressByJob, refresh]
  );
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within <JobsProvider>');
  return ctx;
}
