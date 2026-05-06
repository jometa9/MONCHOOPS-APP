import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { LicenseGate } from './components/LicenseGate';
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
import { getSession } from '@/shared/license';
import type { Session } from '@/shared/types';
import { EMPTY_SESSION } from '@/shared/types';
import { useRunningCampaign } from './useRunningCampaign';
import { startSyncPolling, stopSyncPolling } from '@/shared/sync';

export function App() {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await getSession();
      setSession(s);
      setLoaded(true);
    })();
  }, []);

  // Kick off background sync once we know the user is logged in. The poller
  // is idempotent — pushing once is enough.
  useEffect(() => {
    if (!session.hasLicense) return;
    startSyncPolling();
    return () => stopSyncPolling();
  }, [session.hasLicense]);

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (!session.hasLicense) {
    return <LicenseGate onLogin={(s) => setSession(s)} />;
  }

  return (
    <div className="flex h-screen text-foreground">
      <Routes>
        <Route
          path="*"
          element={
            <Shell session={session} onLogout={() => setSession(EMPTY_SESSION)} />
          }
        />
      </Routes>
    </div>
  );
}

function Shell({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const running = useRunningCampaign();
  const location = useLocation();

  // While a campaign is running, force the user onto its detail page —
  // they can pause from there but cannot navigate elsewhere.
  if (running) {
    const detailPath = `/campaigns/${running.id}`;
    if (location.pathname !== detailPath) {
      return <Navigate to={detailPath} replace />;
    }
  }

  return (
    <>
      <Sidebar session={session} onLogout={onLogout} locked={!!running} />
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
