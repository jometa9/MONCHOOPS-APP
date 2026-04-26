import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider, useSession } from '@/context/SessionContext';
import { AccountsProvider } from '@/context/AccountsContext';
import { JobsProvider } from '@/context/JobsContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { PreferencesProvider } from '@/context/PreferencesContext';
import { AppShell } from '@/components/layout/AppShell';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Login, LoadingDots } from '@/screens/Login';
import { NoSubscription } from '@/screens/NoSubscription';
import { Home } from '@/screens/Home';
import { InstagramAccounts } from '@/screens/InstagramAccounts';
import { MassDMs } from '@/screens/MassDMs';
import { ColdDmHistory } from '@/screens/ColdDmHistory';
import { ColdDmHistoryDetail } from '@/screens/ColdDmHistoryDetail';
import { Scrape } from '@/screens/Scrape';
import { Warmup } from '@/screens/Warmup';
import { Queue } from '@/screens/Queue';
import { Data } from '@/screens/Data';
import { LeadsDetail } from '@/screens/LeadsDetail';
import { Categories } from '@/screens/Categories';
import { CategoryLeadsDetail } from '@/screens/CategoryLeadsDetail';
import { MessageVariants } from '@/screens/MessageVariants';
import { Settings } from '@/screens/Settings';
import { Inbox } from '@/screens/Inbox';
import { AutoResponder } from '@/screens/AutoResponder';
import { Followups } from '@/screens/Followups';
import { StoryWatcher } from '@/screens/StoryWatcher';

function Gate() {
  const { status, session } = useSession();

  if (status === 'loading') {
    return (
      <AuthLayout>
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to MonchoOps</h1>
          <p className="mt-1 text-sm text-muted-foreground">Checking your license.</p>

          <div className="mt-8 grid grid-cols-1 border-l border-t border-border">
            <div className="border-b border-r border-border bg-muted/30 p-5">
              <button
                type="button"
                disabled
                className="inline-flex h-9 w-full items-center justify-center bg-primary px-3 text-xs font-medium text-primary-foreground opacity-50"
              >
                Logging in<LoadingDots />
              </button>
            </div>
          </div>
        </div>
      </AuthLayout>
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
            <Route path="dm-history/:jobId" element={<ColdDmHistoryDetail />} />
            <Route path="scrape" element={<Scrape />} />
            <Route path="warmup" element={<Warmup />} />
            <Route path="queue" element={<Queue />} />
            <Route path="data" element={<Data />} />
            <Route path="data/:jobId" element={<LeadsDetail />} />
            <Route path="categories" element={<Categories />} />
            <Route path="categories/:categoryId" element={<CategoryLeadsDetail />} />
            <Route path="message-variants" element={<MessageVariants />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="auto-responder" element={<AutoResponder />} />
            <Route path="followups" element={<Followups />} />
            <Route path="story-watcher" element={<StoryWatcher />} />
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
