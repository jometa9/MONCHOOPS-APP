import { NavLink } from 'react-router-dom';
import { Database, FolderTree, History, Home, Instagram, ListTodo, LogOut, Send, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/context/SessionContext';
import { useJobs } from '@/context/JobsContext';
import { Spinner } from '@/components/common/Spinner';
import type { JobKind } from '@/types/domain';

const SCRAPE_KINDS: JobKind[] = ['scrape_by_username', 'scrape_by_post', 'scrape_by_hashtag', 'scrape_by_location'];

interface Item {
  to: string;
  label: string;
  icon: typeof Home;
}

const items: Item[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/accounts', label: 'Accounts', icon: Instagram },
  { to: '/scrape', label: 'Scrape Leads', icon: Users },
  { to: '/cold-dm', label: 'Cold DM', icon: Send },
  { to: '/queue', label: 'Queue', icon: ListTodo },
  { to: '/data', label: 'Leads', icon: Database },
  { to: '/categories', label: 'Categories', icon: FolderTree },
  { to: '/dm-history', label: 'DM History', icon: History },
];

const bottomItems: Item[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { session, logout } = useSession();
  const { running, progressByJob } = useJobs();

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
  const statusLabel = isScraping ? 'Scraping' : 'Running';

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-muted/30">
      <div className="px-4 pb-2 pt-4">
        <div className="text-sm font-semibold">MonchoOps</div>
        {session.profile ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{session.profile.email}</div>
        ) : null}
      </div>

      <nav className="flex-1 py-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="pb-1">
        {hasRunning ? (
          <NavLink to="/queue" className={navClass}>
            <Spinner className="h-4 w-4 text-muted-foreground" />
            <span>{statusLabel}</span>
            {isScraping ? (
              <span className="ml-auto bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {scrapedCount}
              </span>
            ) : null}
          </NavLink>
        ) : null}
        {bottomItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => { void logout(); }}
          className="flex w-full items-center gap-2.5 border-y border-transparent px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
