import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Key } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { useSession } from '@/context/SessionContext';
import { monchoops } from '@/lib/monchoops';

const GOOGLE_LOGIN_URL = 'https://monchoops.com/login/google?callback=monchoops://auth';

export function Login() {
  const { t } = useTranslation();
  const { validateLicense } = useSession();
  const [licenseKey, setLicenseKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await validateLicense(licenseKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.couldNotValidate'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-sm pb-30">
        <h1 className="text-2xl font-semibold tracking-tight">{t('login.welcome')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('login.subtitle')}</p>

        <div className="mt-8 grid grid-cols-1 border-l border-t border-border">
          <form
            onSubmit={onSubmit}
            className="space-y-3 border-b border-r border-border bg-muted/30 p-5"
          >
            <label className="text-xs uppercase text-muted-foreground" htmlFor="license-key">
              {t('login.licenseKey')}
            </label>
            <div className="relative">
              <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="license-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder={t('login.pasteLicense')}
                className="pl-9"
                autoFocus
                disabled={submitting}
              />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <SubmitButton submitting={submitting} disabled={!licenseKey.trim()} />
          </form>

          <div className="border-b border-r border-border bg-muted/30 p-5">
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                void monchoops.openExternalLink(GOOGLE_LOGIN_URL);
              }}
              className="inline-flex h-9 w-full items-center justify-center border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {t('login.googleSignIn')}
            </button>
          </div>
        </div>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => {
              void monchoops.openExternalLink('https://monchoops.com');
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t('login.noAccount')}
          </button>
        </div>
      </div>
    </AuthLayout>
  );
}

function SubmitButton({ submitting, disabled }: { submitting: boolean; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="submit"
      disabled={submitting || disabled}
      className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
    >
      {submitting ? (
        <>
          {t('login.loggingIn')}
          <LoadingDots />
        </>
      ) : (
        t('login.continue')
      )}
    </button>
  );
}

export function LoadingDots() {
  return (
    <span aria-hidden className="ml-0.5 inline-flex">
      <Dot delay="0ms" />
      <Dot delay="150ms" />
      <Dot delay="300ms" />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block animate-pulse"
      style={{ animationDelay: delay, animationDuration: '1s' }}
    >
      .
    </span>
  );
}
