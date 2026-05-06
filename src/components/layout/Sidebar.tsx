import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Database, FolderTree, History, Home, Instagram, ListTodo, LogOut, MessageSquareText, Send, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/context/SessionContext';
import { useJobs } from '@/context/JobsContext';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { JobKind } from '@/types/domain';

const SCRAPE_KINDS: JobKind[] = ['scrape_by_username', 'scrape_by_post', 'scrape_by_hashtag', 'scrape_by_location'];

interface Item {
  to: string;
  labelKey: string;
  icon: typeof Home;
}

const items: Item[] = [
  { to: '/', labelKey: 'components.sidebar.home', icon: Home },
  { to: '/accounts', labelKey: 'components.sidebar.accounts', icon: Instagram },
  { to: '/scrape', labelKey: 'components.sidebar.scrapeLeads', icon: Users },
  { to: '/cold-dm', labelKey: 'components.sidebar.coldDm', icon: Send },
  { to: '/queue', labelKey: 'components.sidebar.queue', icon: ListTodo },
  { to: '/data', labelKey: 'components.sidebar.leads', icon: Database },
  { to: '/categories', labelKey: 'components.sidebar.categories', icon: FolderTree },
  { to: '/message-variants', labelKey: 'components.sidebar.messageVariants', icon: MessageSquareText },
  { to: '/dm-history', labelKey: 'components.sidebar.dmHistory', icon: History },
];

const bottomItems: Item[] = [
  { to: '/settings', labelKey: 'components.sidebar.settings', icon: Settings },
];

export function Sidebar() {
  const { t } = useTranslation();
  const { session, logout } = useSession();
  const { running, progressByJob } = useJobs();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleConfirmLogout() {
    setLoggingOut(true);
    try {
      await logout();
      setConfirmLogout(false);
    } finally {
      setLoggingOut(false);
    }
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2.5 px-4 py-2 text-sm transition-colors',
      isActive
        ? 'border-y border-border bg-background font-medium text-foreground'
        : 'border-y border-transparent text-muted-foreground hover:bg-background hover:text-foreground'
    );

  const scrapeJobs = running.filter((j) => SCRAPE_KINDS.includes(j.kind));
  const hasRunning = running.length > 0;
  const isScraping = scrapeJobs.length > 0;
  const scrapedCount = scrapeJobs.reduce(
    (sum, j) => sum + (progressByJob[j.id]?.done ?? j.progressDone ?? 0),
    0
  );
  const statusLabel = isScraping
    ? t('components.sidebar.scraping')
    : t('components.sidebar.running');

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-muted/30">
      <div className="px-4 pb-2 pt-2">
        <div className="text-sm font-semibold">{t('components.sidebar.brand')}</div>
        {session.profile ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{session.profile.email}</div>
        ) : null}
      </div>

      <nav className="flex-1 py-1">
        {items.map(({ to, labelKey, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="pb-1">
        {hasRunning ? (
          <NavLink to="/queue" className={navClass}>
            <Spinner className="h-4 w-4 text-muted-foreground" />
            <span>{statusLabel}</span>
            {isScraping ? (
              scrapedCount > 0 ? (
                <Badge variant="success" className="ml-auto tabular-nums">
                  {scrapedCount}
                </Badge>
              ) : (
                <span className="ml-auto bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {scrapedCount}
                </span>
              )
            ) : null}
          </NavLink>
        ) : null}
        {bottomItems.map(({ to, labelKey, icon: Icon }) => (
          <NavLink key={to} to={to} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setConfirmLogout(true)}
          className="flex w-full items-center gap-2.5 border-y border-transparent px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span>{t('components.sidebar.logOut')}</span>
        </button>
      </div>

      {confirmLogout ? (
        <Dialog
          open
          onClose={() => {
            if (!loggingOut) setConfirmLogout(false);
          }}
          title={t('components.sidebar.logoutDialogTitle')}
          description={t('components.sidebar.logoutDialogDescription')}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmLogout(false)}
                disabled={loggingOut}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleConfirmLogout()} disabled={loggingOut}>
                {loggingOut ? <Spinner /> : <LogOut className="h-3.5 w-3.5" />}
                {loggingOut ? t('components.sidebar.loggingOut') : t('components.sidebar.logOut')}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      ) : null}
    </aside>
  );
}
