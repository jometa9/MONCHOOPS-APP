import { useEffect, useState, type FormEvent } from 'react';
import { ExternalLink, Instagram, Key, LogOut } from 'lucide-react';
import { getSession, logout, validateLicense } from '@/shared/license';
import type { Session } from '@/shared/types';
import { EMPTY_SESSION } from '@/shared/types';

export function Popup() {
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [loading, setLoading] = useState(true);
  const [igLoggedIn, setIgLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const s = await getSession();
      setSession(s);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!session.hasLicense) return;
    chrome.runtime.sendMessage({ type: 'sw/igSessionCheck' }, (resp) => {
      if (resp?.ok) setIgLoggedIn(!!resp.data?.loggedIn);
    });
  }, [session.hasLicense]);

  if (loading) {
    return (
      <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session.hasLicense) {
    return <LicenseGate onLogin={(s) => setSession(s)} />;
  }

  return <ConnectedPanel session={session} igLoggedIn={igLoggedIn} onLogout={async () => { await logout(); setSession(EMPTY_SESSION); }} />;
}

function LicenseGate({ onLogin }: { onLogin: (s: Session) => void }) {
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!key.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const s = await validateLicense(key);
      onLogin(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate license');
    } finally {
      setSubmitting(false);
    }
  }

  function fillTest() {
    setKey('123');
  }

  return (
    <div className="flex h-[440px] flex-col bg-background">
      <header className="border-b border-border bg-muted/30 px-4 py-3">
        <h1 className="text-sm font-semibold tracking-tight">Welcome to B2DM</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sign in with your license key to continue.
        </p>
      </header>

      <form onSubmit={submit} className="flex-1 space-y-3 p-4">
        <label className="text-[10px] uppercase tracking-wide text-muted-foreground" htmlFor="lk">
          License key
        </label>
        <div className="relative">
          <Key className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="lk"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your license key"
            autoFocus
            disabled={submitting}
            className="h-9 w-full border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-foreground disabled:opacity-50"
          />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting || !key.trim()}
          className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? 'Logging in…' : 'Continue'}
        </button>
        <button
          type="button"
          onClick={fillTest}
          disabled={submitting}
          className="inline-flex h-9 w-full items-center justify-center border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          Use test license (offline)
        </button>
      </form>

      <footer className="border-t border-border p-3 text-center">
        <a
          href="https://b2dm.app"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:underline"
        >
          No account? Visit b2dm.app <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </div>
  );
}

function ConnectedPanel({
  session,
  igLoggedIn,
  onLogout,
}: {
  session: Session;
  igLoggedIn: boolean | null;
  onLogout: () => void;
}) {
  const openDashboard = () => {
    chrome.runtime.sendMessage({ type: 'sw/openDashboard' });
    window.close();
  };

  const openIg = () => {
    chrome.tabs.create({ url: 'https://www.instagram.com/' });
    window.close();
  };

  return (
    <div className="flex h-[400px] flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{session.profile?.name || 'B2DM'}</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {session.profile?.email ?? ''} · {session.subscription?.plan ?? 'free'}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="flex-1 space-y-4 p-4">
        <section className="border border-border">
          <header className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Instagram className="h-3 w-3" />
              Instagram session
            </span>
            <span
              className={
                'text-[11px] font-medium ' +
                (igLoggedIn === null
                  ? 'text-muted-foreground'
                  : igLoggedIn
                  ? 'text-emerald-600'
                  : 'text-destructive')
              }
            >
              {igLoggedIn === null ? 'Checking…' : igLoggedIn ? 'Active' : 'Not logged in'}
            </span>
          </header>
          <div className="p-3 text-xs text-muted-foreground">
            {igLoggedIn ? (
              <>The extension will operate on the IG account you're logged into in this browser.</>
            ) : (
              <>
                Log into{' '}
                <button
                  type="button"
                  onClick={openIg}
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  instagram.com
                </button>{' '}
                first, then come back here.
              </>
            )}
          </div>
        </section>

        <button
          type="button"
          onClick={openDashboard}
          className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open dashboard
        </button>
      </div>
    </div>
  );
}
