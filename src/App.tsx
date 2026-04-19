import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { AccountsProvider } from '@/context/AccountsContext';
import { JobsProvider } from '@/context/JobsContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { PreferencesProvider } from '@/context/PreferencesContext';
import { AppShell } from '@/components/layout/AppShell';
import { Login } from '@/screens/Login';
import { NoSubscription } from '@/screens/NoSubscription';
import { Home } from '@/screens/Home';
import { InstagramAccounts } from '@/screens/InstagramAccounts';
import { MassDMs } from '@/screens/MassDMs';
import { ColdDmHistory } from '@/screens/ColdDmHistory';
import { Scrape } from '@/screens/Scrape';
import { Queue } from '@/screens/Queue';
import { Data } from '@/screens/Data';
import { LeadsDetail } from '@/screens/LeadsDetail';
import { Categories } from '@/screens/Categories';
import { Settings } from '@/screens/Settings';
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
            <Route path="dm-history" element={<ColdDmHistory />} />
            <Route path="scrape" element={<Scrape />} />
            <Route path="queue" element={<Queue />} />
            <Route path="data" element={<Data />} />
            <Route path="data/:jobId" element={<LeadsDetail />} />
            <Route path="categories" element={<Categories />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </JobsProvider>
    </AccountsProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <SessionProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </SessionProvider>
      </PreferencesProvider>
    </ThemeProvider>
  );
}
