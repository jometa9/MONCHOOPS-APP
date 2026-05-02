import { useState, type FormEvent } from 'react';
import { Key } from 'lucide-react';
import { validateLicense } from '@/shared/license';
import type { Session } from '@/shared/types';

interface Props {
  onLogin: (s: Session) => void;
}

export function LicenseGate({ onLogin }: Props) {
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting || !key.trim()) return;
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

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to B2DM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in with your license key to continue.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3 border border-border bg-muted/30 p-5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground" htmlFor="lk">
            License key
          </label>
          <div className="relative">
            <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="lk"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your license key"
              disabled={submitting}
              className="h-9 w-full border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground disabled:opacity-50"
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
            onClick={() => setKey('123')}
            disabled={submitting}
            className="inline-flex h-9 w-full items-center justify-center border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
          >
            Use test license
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          No account?{' '}
          <a href="https://b2dm.app" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            Visit b2dm.app
          </a>
        </p>
      </div>
    </div>
  );
}
