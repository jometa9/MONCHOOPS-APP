import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Key } from 'lucide-react';
import { validateLicense } from '@/shared/license';
import type { Session } from '@/shared/types';
import { HomeBg } from '@/shared/HomeBg';

interface Props {
  onLogin: (s: Session) => void;
}

export function LicenseGate({ onLogin }: Props) {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t('popup.couldNotValidate'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative isolate flex h-screen items-center justify-center p-4">
      <HomeBg />
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('popup.welcome')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('popup.signInHint')}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3 border border-border bg-muted/30 p-5">
          <label className="text-xs uppercase tracking-wide text-muted-foreground" htmlFor="lk">
            {t('popup.licenseKey')}
          </label>
          <div className="relative">
            <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="lk"
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('popup.pasteLicense')}
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
            {submitting ? t('popup.loggingIn') : t('popup.continue')}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t('popup.noAccountQuestion')}{' '}
          <a href="https://b2dm.app" target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
            {t('popup.visitSite')}
          </a>
        </p>
      </div>
    </div>
  );
}
