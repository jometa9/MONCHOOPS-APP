import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { LicenseGate } from './components/LicenseGate';
import { NewCampaign } from './screens/NewCampaign';
import { Campaigns } from './screens/Campaigns';
import { CampaignDetail } from './screens/CampaignDetail';
import { History } from './screens/History';
import { Variants } from './screens/Variants';
import { Settings } from './screens/Settings';
import { getSession } from '@/shared/license';
import type { Session } from '@/shared/types';
import { EMPTY_SESSION } from '@/shared/types';

export function App() {
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const s = await getSession();
      setSession(s);
      setLoaded(true);
    })();
  }, []);

  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session.hasLicense) {
    return <LicenseGate onLogin={(s) => setSession(s)} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar session={session} onLogout={() => setSession(EMPTY_SESSION)} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Routes>
          <Route index element={<Navigate to="/campaigns" replace />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<NewCampaign />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/variants" element={<Variants />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/campaigns" replace />} />
        </Routes>
      </main>
    </div>
  );
}
