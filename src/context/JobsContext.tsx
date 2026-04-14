import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { b2dm } from '@/lib/b2dm';
import type { JobPublic } from '@/types/domain';

interface JobProgress {
  done: number;
  total: number | null;
  lastItem?: string;
}

interface JobsContextValue {
  running: JobPublic[];
  progressByJob: Record<string, JobProgress>;
  refresh: () => Promise<void>;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState<JobPublic[]>([]);
  const [progressByJob, setProgressByJob] = useState<Record<string, JobProgress>>({});
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const list = await b2dm.jobs.listRunning();
    if (!mountedRef.current) return;
    setRunning(list);
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
    return () => {
      mountedRef.current = false;
      offChange();
      offProgress();
      offDone();
    };
  }, [refresh]);

  const value = useMemo<JobsContextValue>(() => ({ running, progressByJob, refresh }), [running, progressByJob, refresh]);
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within <JobsProvider>');
  return ctx;
}
