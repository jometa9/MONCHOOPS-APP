import { useEffect, useState } from 'react';
import { ArrowDownCircle, Loader, RotateCw } from 'lucide-react';
import { b2dm, type UpdateStatus } from '@/lib/b2dm';

// Preview mode: set to any UpdateStatus to see how the banner renders
// without waiting for a real update. Keep null in production.
// Examples:
//   { kind: 'available', version: '0.2.0' }
//   { kind: 'downloading', version: '0.2.0', percent: 42, bytesPerSecond: 0, transferred: 0, total: 0 }
//   { kind: 'downloaded', version: '0.2.0' }
const PREVIEW: UpdateStatus | null = null;

export function UpdateBanner() {
  const [state, setState] = useState<UpdateStatus>(PREVIEW ?? { kind: 'idle' });
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (PREVIEW) return;
    let cancelled = false;
    void b2dm.updater.getState().then((s) => {
      if (!cancelled) setState(s);
    });
    const off = b2dm.updater.onStateChange((s) => setState(s));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleInstall = async () => {
    setIsInstalling(true);
    try {
      await b2dm.updater.installAndRestart();
    } catch {
      setIsInstalling(false);
    }
  };

  if (state.kind === 'idle' || state.kind === 'checking' || state.kind === 'not-available') {
    return null;
  }

  if (state.kind === 'error') {
    // Silent by design: we only surface errors if the user manually triggered
    // a check from Settings. Home stays clean.
    return null;
  }

  return (
    <div className="mb-6 flex items-center justify-between gap-3 border border-border bg-muted/40 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <UpdaterIcon state={state} />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{titleFor(state)}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitleFor(state)}</div>
        </div>
      </div>

      {state.kind === 'downloaded' ? (
        <button
          type="button"
          onClick={() => void handleInstall()}
          disabled={isInstalling}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {isInstalling ? (
            <Loader className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCw className="h-3.5 w-3.5" />
          )}
          Restart & install
        </button>
      ) : state.kind === 'downloading' ? (
        <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <ProgressBar percent={state.percent} />
          <span className="w-10 text-right">{state.percent}%</span>
        </div>
      ) : null}
    </div>
  );
}

function UpdaterIcon({ state }: { state: UpdateStatus }) {
  if (state.kind === 'downloaded') {
    return <RotateCw className="h-4 w-4 text-foreground" />;
  }
  if (state.kind === 'downloading' || state.kind === 'available') {
    return <ArrowDownCircle className="h-4 w-4 text-foreground" />;
  }
  return <Loader className="h-4 w-4 animate-spin text-muted-foreground" />;
}

function titleFor(state: UpdateStatus): string {
  switch (state.kind) {
    case 'available':
      return `Update available — v${state.version}`;
    case 'downloading':
      return state.version
        ? `Downloading update v${state.version}`
        : 'Downloading update';
    case 'downloaded':
      return `Update ready — v${state.version}`;
    default:
      return '';
  }
}

function subtitleFor(state: UpdateStatus): string {
  switch (state.kind) {
    case 'available':
      return 'Download will start automatically.';
    case 'downloading':
      return 'Keep the app open — this only takes a moment.';
    case 'downloaded':
      return 'Restart to finish installing, or it will install next time you close B2DM.';
    default:
      return '';
  }
}

function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1 w-24 overflow-hidden rounded-full bg-border">
      <div
        className="h-full bg-primary transition-[width] duration-200 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
