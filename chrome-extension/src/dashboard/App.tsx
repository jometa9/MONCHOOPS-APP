import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { HomeBg } from '@/shared/HomeBg';
import { Home } from './screens/Home';
import { NewCampaign } from './screens/NewCampaign';
import { Campaigns } from './screens/Campaigns';
import { CampaignDetail } from './screens/CampaignDetail';
import { Categories } from './screens/Categories';
import { CategoryDetail } from './screens/CategoryDetail';
import { History } from './screens/History';
import { HistoryDetail } from './screens/HistoryDetail';
import { Queue } from './screens/Queue';
import { Scrapes } from './screens/Scrapes';
import { ScrapeDetail } from './screens/ScrapeDetail';
import { Variants } from './screens/Variants';
import { Settings } from './screens/Settings';
import { useRunningCampaign } from './useRunningCampaign';
import { startSyncPolling, stopSyncPolling } from '@/shared/sync';

export function App() {
  useEffect(() => {
    startSyncPolling();
    return () => stopSyncPolling();
  }, []);

  return (
    <div className="flex h-screen text-foreground">
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </div>
  );
}

function Shell() {
  const running = useRunningCampaign();
  const location = useLocation();

  if (running) {
    const detailPath = `/campaigns/${running.id}`;
    if (location.pathname !== detailPath) {
      return <Navigate to={detailPath} replace />;
    }
  }

  return (
    <>
      <Sidebar locked={!!running} />
      <main className="relative isolate flex min-w-0 flex-1 flex-col overflow-hidden">
        <HomeBg offset="sidebar" />
        <Routes>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<NewCampaign />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/categories/:id" element={<CategoryDetail />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/scrapes" element={<Scrapes />} />
          <Route path="/scrapes/:jobId" element={<ScrapeDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:source/:id" element={<HistoryDetail />} />
          <Route path="/variants" element={<Variants />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </>
  );
}
