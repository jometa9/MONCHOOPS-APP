import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Chrome, Database, FolderTree, History, Home, Instagram, ListTodo, MessageSquareText, Send, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { monchoops } from '@/lib/monchoops';
import { useJobs } from '@/context/JobsContext';
import { Spinner } from '@/components/common/Spinner';
import { Badge } from '@/components/ui/badge';
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
  const { running, progressByJob } = useJobs();
  const [extensionUrl, setExtensionUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void monchoops.updater
      .getExtensionUrl()
      .then((url) => {
        if (!cancelled) setExtensionUrl(url ?? '');
      })
      .catch(() => {});
    const off = monchoops.updater.onExtensionUrlChange((url) => {
      setExtensionUrl(url ?? '');
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

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
        {extensionUrl ? (
          <button
            type="button"
            onClick={() => void monchoops.openExternalLink(extensionUrl)}
            className="flex w-full items-center gap-2.5 border-y border-transparent px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          >
            <Chrome className="h-4 w-4" />
            <span>{t('components.sidebar.chromeExtension')}</span>
          </button>
        ) : null}
        {bottomItems.map(({ to, labelKey, icon: Icon }) => (
          <NavLink key={to} to={to} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
