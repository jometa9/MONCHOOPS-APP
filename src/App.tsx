import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AccountsProvider } from '@/context/AccountsContext';
import { JobsProvider } from '@/context/JobsContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { PreferencesProvider } from '@/context/PreferencesContext';
import { AppShell } from '@/components/layout/AppShell';
import { Home } from '@/screens/Home';
import { InstagramAccounts } from '@/screens/InstagramAccounts';
import { MassDMs } from '@/screens/MassDMs';
import { ColdDmHistory } from '@/screens/ColdDmHistory';
import { ColdDmHistoryDetail } from '@/screens/ColdDmHistoryDetail';
import { Scrape } from '@/screens/Scrape';
import { Queue } from '@/screens/Queue';
import { Data } from '@/screens/Data';
import { LeadsDetail } from '@/screens/LeadsDetail';
import { Categories } from '@/screens/Categories';
import { CategoryLeadsDetail } from '@/screens/CategoryLeadsDetail';
import { MessageVariants } from '@/screens/MessageVariants';
import { Settings } from '@/screens/Settings';

export default function App() {
  return (
    <ThemeProvider>
      <PreferencesProvider>
        <HashRouter>
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
                  <Route path="queue" element={<Queue />} />
                  <Route path="data" element={<Data />} />
                  <Route path="data/:jobId" element={<LeadsDetail />} />
                  <Route path="categories" element={<Categories />} />
                  <Route path="categories/:categoryId" element={<CategoryLeadsDetail />} />
                  <Route path="message-variants" element={<MessageVariants />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </JobsProvider>
          </AccountsProvider>
        </HashRouter>
      </PreferencesProvider>
    </ThemeProvider>
  );
}
