import { useState, type FormEvent } from 'react';
import { Key } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/common/Spinner';
import { TitleBar } from '@/components/layout/TitleBar';
import { useSession } from '@/context/SessionContext';
import { b2dm } from '@/lib/b2dm';

const GOOGLE_LOGIN_URL = 'https://b2dm.app/login/google?callback=b2dm://auth';

export function Login() {
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
      setError(err instanceof Error ? err.message : 'Could not validate license');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Welcome to B2DM</CardTitle>
            <CardDescription>Sign in with your license key or your Google account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form className="space-y-2" onSubmit={onSubmit}>
              <label className="text-xs font-medium text-muted-foreground" htmlFor="license-key">
                License key
              </label>
              <div className="relative">
                <Key className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="license-key"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="Paste your license key"
                  className="pl-9"
                  autoFocus
                />
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={submitting || !licenseKey.trim()}>
                {submitting ? <Spinner /> : null}
                {submitting ? 'Validating…' : 'Continue'}
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                void b2dm.openExternalLink(GOOGLE_LOGIN_URL);
              }}
            >
              Sign in with Google
            </Button>
          </CardContent>
          <CardFooter className="justify-center pt-0">
            <button
              type="button"
              onClick={() => {
                void b2dm.openExternalLink('https://b2dm.app');
              }}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Need an account? Visit b2dm.app
            </button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
