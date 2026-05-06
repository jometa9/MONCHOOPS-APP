import { useTranslation } from 'react-i18next';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { useSession } from '@/context/SessionContext';
import { b2dm } from '@/lib/b2dm';

const BILLING_URL = 'https://b2dm.app/dashboard/billing';

export function NoSubscription() {
  const { t } = useTranslation();
  const { session, logout, refresh } = useSession();

  return (
    <AuthLayout>
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">{t('screens.noSubscription.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.profile?.email
            ? t('screens.noSubscription.descriptionWithEmail', { email: session.profile.email })
            : t('screens.noSubscription.descriptionNoEmail')}
        </p>

        <div className="mt-8 grid grid-cols-1 border-l border-t border-border">
          <div className="space-y-2 border-b border-r border-border bg-muted/30 p-5">
            <button
              type="button"
              onClick={() => {
                void b2dm.openExternalLink(BILLING_URL);
              }}
              className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('screens.noSubscription.goToBilling')}
            </button>
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              className="inline-flex h-9 w-full items-center justify-center border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t('screens.noSubscription.justPaid')}
            </button>
            <button
              type="button"
              onClick={() => {
                void logout();
              }}
              className="inline-flex h-9 w-full items-center justify-center px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {t('common.logOut')}
            </button>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
