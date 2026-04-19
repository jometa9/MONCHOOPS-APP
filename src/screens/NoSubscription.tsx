import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TitleBar } from '@/components/layout/TitleBar';
import { EmptyState } from '@/components/common/EmptyState';
import { useSession } from '@/context/SessionContext';
import { b2dm } from '@/lib/b2dm';

const BILLING_URL = 'https://b2dm.app/dashboard/billing';

export function NoSubscription() {
  const { session, logout, refresh } = useSession();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <EmptyState
        icon={<CreditCard className="h-10 w-10" />}
        title="No active subscription"
        description={
          session.profile?.email
            ? `We couldn't find an active MonchoOps subscription on ${session.profile.email}. Activate a plan to start using the app.`
            : 'Activate a MonchoOps plan to start using the app.'
        }
        action={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                void b2dm.openExternalLink(BILLING_URL);
              }}
            >
              Go to billing
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void refresh();
              }}
            >
              I just paid — refresh
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                void logout();
              }}
            >
              Log out
            </Button>
          </div>
        }
      />
    </div>
  );
}
