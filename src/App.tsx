import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { AccountsProvider } from '@/context/AccountsContext';
import { JobsProvider } from '@/context/JobsContext';
import { AppShell } from '@/components/layout/AppShell';
import { Login } from '@/screens/Login';
import { NoSubscription } from '@/screens/NoSubscription';
import { Home } from '@/screens/Home';
import { InstagramAccounts } from '@/screens/InstagramAccounts';
import { MassDMs } from '@/screens/MassDMs';
import { Scrape } from '@/screens/Scrape';
import { Data } from '@/screens/Data';
import { Spinner } from '@/components/common/Spinner';

function Gate() {
  const { status, session } = useSession();

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (!session.hasLicense) return <Login />;
  if (!session.subscription?.active) return <NoSubscription />;

  return (
    <AccountsProvider>
      <JobsProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Home />} />
            <Route path="accounts" element={<InstagramAccounts />} />
            <Route path="cold-dm" element={<MassDMs />} />
            <Route path="scrape" element={<Scrape />} />
            <Route path="data" element={<Data />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </JobsProvider>
    </AccountsProvider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </SessionProvider>
  );
}
