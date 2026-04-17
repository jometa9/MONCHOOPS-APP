import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Minus,
  Pause,
  Play,
  Trash2,
  WrapText,
  X,
} from 'lucide-react';
import { b2dm } from '@/lib/b2dm';

const POLL_MS = 2000;
const MAX_LINES = 500;
const BOTTOM_THRESHOLD = 80;

function tailLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.length > n ? lines.slice(-n).join('\n') : text;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function utcNow() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function Logs() {
  const [content, setContent] = useState('');
  const [paused, setPaused] = useState(false);
  const [clock, setClock] = useState(utcNow);
  const [wrapping, setWrapping] = useState(true);
  const [isClearing, setIsClearing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [search, setSearch] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const preRef = useRef<HTMLPreElement>(null);
  const autoScrollRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchLogs = useCallback(async () => {
    const el = preRef.current;
    if (el) {
      autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    }
    try {
      const text = await b2dm.settings.getLogs();
      setContent(tailLines(text ?? '', MAX_LINES));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logs');
    }
  }, []);

  // Auto-scroll after content update
  useEffect(() => {
    if (autoScrollRef.current && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [content]);

  // Polling
  useEffect(() => {
    if (paused) return;
    void fetchLogs();
    const id = setInterval(() => void fetchLogs(), POLL_MS);
    return () => clearInterval(id);
  }, [paused, fetchLogs]);

  // Clock
  useEffect(() => {
    const id = setInterval(() => setClock(utcNow()), 1000);
    return () => clearInterval(id);
  }, []);

  const displayText = content.trim() ? content : 'Waiting for logs...';

  // Search segments
  const { segments, matchCount } = useMemo(() => {
    const q = search.trim();
    if (!q) return { segments: [] as { text: string; isMatch: boolean; idx?: number }[], matchCount: 0 };
    const re = new RegExp(escapeRegex(q), 'gi');
    const segs: { text: string; isMatch: boolean; idx?: number }[] = [];
    let last = 0;
    let mi = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(displayText)) !== null) {
      if (m.index > last) segs.push({ text: displayText.slice(last, m.index), isMatch: false });
      segs.push({ text: m[0], isMatch: true, idx: mi++ });
      last = m.index + m[0].length;
    }
    if (last < displayText.length) segs.push({ text: displayText.slice(last), isMatch: false });
    return { segments: segs, matchCount: mi };
  }, [displayText, search]);

  useEffect(() => { setMatchIdx(0); }, [search]);
  useEffect(() => {
    if (matchCount > 0 && matchIdx >= matchCount) setMatchIdx(matchCount - 1);
  }, [matchCount, matchIdx]);
  useEffect(() => {
    if (!matchCount) return;
    preRef.current?.querySelector(`[data-mi="${matchIdx}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [matchIdx, matchCount]);

  const prevMatch = useCallback(() => setMatchIdx(i => (matchCount > 0 ? (i - 1 + matchCount) % matchCount : 0)), [matchCount]);
  const nextMatch = useCallback(() => setMatchIdx(i => (matchCount > 0 ? (i + 1) % matchCount : 0)), [matchCount]);

  const handleClear = useCallback(async () => {
    setIsClearing(true);
    try {
      await b2dm.settings.clearLogs();
      setContent('');
    } finally {
      setIsClearing(false);
    }
  }, []);

  const handleDownload = useCallback(() => {
    const blob = new Blob([displayText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `b2dm-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayText]);

  const handleCopy = useCallback(async () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(displayText);
      setIsCopied(true);
      copyTimerRef.current = setTimeout(() => { setIsCopied(false); }, 2000);
    } catch {}
  }, [displayText]);

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  const iconBtn = 'p-2.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 border-r border-border last:border-r-0';

  return (
    <div className="flex h-full flex-col gap-3 border-t border-border bg-muted/20 p-5">
      {/* Header row */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Live logs{' '}
          <span className="font-normal text-sm text-muted-foreground">{clock}</span>
        </h2>
        <div className="inline-flex overflow-hidden rounded-lg border border-border bg-background">
          <button type="button" className={iconBtn} onClick={handleDownload} title="Download">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => void handleCopy()} title={isCopied ? 'Copied' : 'Copy'}>
            {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
          <button type="button" className={iconBtn} onClick={() => setWrapping(w => !w)} title="Toggle wrap">
            {wrapping ? <WrapText className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={() => preRef.current && (preRef.current.scrollTop = preRef.current.scrollHeight)}
            title="Scroll to bottom"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => setPaused(p => !p)} title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" className={iconBtn} onClick={() => void handleClear()} disabled={isClearing} title="Clear">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <p className="flex-shrink-0 text-sm text-destructive">{error}</p>}

      {/* Search row */}
      <div className="flex flex-shrink-0 overflow-hidden rounded-lg border border-border bg-background">
        <input
          type="text"
          placeholder="Search in logs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && matchCount > 0) { e.preventDefault(); nextMatch(); } }}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
        />
        <button type="button" className={iconBtn} onClick={prevMatch} disabled={!search.trim() || matchCount === 0} title="Previous">
          <ChevronUp className="h-4 w-4" />
        </button>
        <button type="button" className={iconBtn} onClick={nextMatch} disabled={!search.trim() || matchCount === 0} title="Next">
          <ChevronDown className="h-4 w-4" />
        </button>
        <div className="min-w-[4rem] border-l border-border px-3 py-2 text-center text-sm tabular-nums text-muted-foreground">
          {search.trim() ? `${matchCount > 0 ? matchIdx + 1 : 0}/${matchCount}` : '0/0'}
        </div>
        <button type="button" className={iconBtn} onClick={() => setSearch('')} disabled={!search.trim()} title="Clear search">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Log content */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
        <pre
          ref={preRef}
          className={`flex-1 min-h-0 min-w-0 select-text p-3 text-xs font-mono text-foreground ${
            wrapping
              ? 'overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all'
              : 'overflow-auto whitespace-pre'
          }`}
        >
          {!search.trim() ? (
            displayText
          ) : (
            segments.map((seg, i) =>
              !seg.isMatch ? (
                <span key={i}>{seg.text}</span>
              ) : (
                <span
                  key={i}
                  data-mi={seg.idx}
                  className={
                    seg.idx === matchIdx
                      ? 'bg-yellow-300 text-black ring-1 ring-yellow-500 dark:bg-yellow-500 dark:text-black'
                      : 'bg-yellow-200 text-black dark:bg-yellow-400/70 dark:text-black'
                  }
                >
                  {seg.text}
                </span>
              )
            )
          )}
        </pre>
      </div>
    </div>
  );
}
