import { useEffect, useState } from 'react';
import { ExternalLink, Instagram, LogOut, MonitorSmartphone } from 'lucide-react';
import { ScreenHeader } from '../components/ScreenHeader';
import { getSession, logout } from '@/shared/license';
import { db } from '@/shared/db';
import {
  clearToken,
  discoverDesktop,
  getStoredToken,
  type DesktopPing,
} from '@/shared/desktop-bridge';
import type { Session } from '@/shared/types';

export function Settings() {
  const [session, setSession] = useState<Session | null>(null);
  const [igLoggedIn, setIgLoggedIn] = useState<boolean | null>(null);
  const [desktop, setDesktop] = useState<{
    state: 'unknown' | 'offline' | 'connected' | 'paired';
    ping?: DesktopPing;
    port?: number;
  }>({ state: 'unknown' });

  useEffect(() => {
    void getSession().then(setSession);
    chrome.runtime.sendMessage({ type: 'sw/igSessionCheck' }, (resp) => {
      if (resp?.ok) setIgLoggedIn(!!resp.data?.loggedIn);
    });
    void refreshDesktop();
  }, []);

  async function refreshDesktop() {
    try {
      const { ping, port } = await discoverDesktop();
      const token = await getStoredToken();
      setDesktop({ state: token ? 'paired' : 'connected', ping, port });
    } catch {
      setDesktop({ state: 'offline' });
    }
  }

  async function unpair() {
    if (!confirm('Unpair from the desktop app? You can re-pair from the New Cold DM screen anytime.')) return;
    await clearToken();
    void refreshDesktop();
  }

  async function handleLogout() {
    await logout();
    location.reload();
  }

  async function clearAllData() {
    if (!confirm('Delete all campaigns, leads, history, and variant groups? This cannot be undone.')) return;
    await db.campaigns.clear();
    await db.leads.clear();
    await db.history.clear();
    await db.variantGroups.clear();
    alert('All data cleared.');
  }

  if (!session) return null;

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Settings" description="License, Instagram session, data." />

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <Section title="License">
            <Row label="Email" value={session.profile?.email ?? '—'} />
            <Row label="Name" value={session.profile?.name ?? '—'} />
            <Row label="Plan" value={session.subscription?.plan ?? '—'} />
            <Row
              label="Active"
              value={session.subscription?.active ? 'Yes' : 'No'}
            />
            <div className="pt-3">
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex h-9 items-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            </div>
          </Section>

          <Section title="Instagram session">
            <div className="flex items-start gap-3 text-sm">
              <Instagram className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">
                  {igLoggedIn === null
                    ? 'Checking…'
                    : igLoggedIn
                    ? 'Logged in'
                    : 'Not logged in'}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The extension uses whichever Instagram account is logged into your browser.
                  No account selector — log out of IG to switch.
                </p>
                <a
                  href="https://www.instagram.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
                >
                  Open Instagram <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </Section>

          <Section title="Desktop app">
            <div className="flex items-start gap-3 text-sm">
              <MonitorSmartphone className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">
                  {desktop.state === 'unknown' ? 'Checking…' : null}
                  {desktop.state === 'offline' ? 'Not running' : null}
                  {desktop.state === 'connected'
                    ? `Detected v${desktop.ping?.version ?? '?'} on port ${desktop.port}`
                    : null}
                  {desktop.state === 'paired'
                    ? `Paired · v${desktop.ping?.version ?? '?'} on port ${desktop.port}`
                    : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  When the desktop app is running, you can pull leads directly from your
                  saved categories and scrape results — no CSV export step.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void refreshDesktop()}
                    className="inline-flex h-8 items-center border border-border bg-background px-3 text-xs font-medium hover:bg-accent"
                  >
                    Refresh
                  </button>
                  {desktop.state === 'paired' ? (
                    <button
                      type="button"
                      onClick={unpair}
                      className="inline-flex h-8 items-center bg-destructive/10 px-3 text-xs font-medium text-destructive hover:bg-destructive/20"
                    >
                      Unpair
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Data">
            <p className="text-xs text-muted-foreground">
              Everything is stored locally in your browser (IndexedDB). Nothing leaves this device
              except the DMs you send through Instagram and the license check against b2dm.app.
            </p>
            <div className="mt-3">
              <button
                type="button"
                onClick={clearAllData}
                className="inline-flex h-9 items-center bg-destructive/10 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
              >
                Clear all data
              </button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-background">
      <header className="border-b border-border bg-muted/30 px-4 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      </header>
      <div className="space-y-2 p-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
