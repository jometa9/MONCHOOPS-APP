import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  CloudOff,
  FolderTree,
  History as HistoryIcon,
  Home as HomeIcon,
  Inbox,
  ListTodo,
  Loader2,
  LogOut,
  MessageSquare,
  MessageSquareText,
  Monitor,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '@/shared/license';
import type { Session } from '@/shared/types';
import { cn } from '@/shared/cn';
import { onSyncStatusChange, runSync, type SyncStatus } from '@/shared/sync';
import { useThemeMode, type ThemeMode } from '../theme';

interface Props {
  session: Session;
  onLogout: () => void;
  /** When true, navigation is disabled because a campaign is in progress. */
  locked?: boolean;
}

const NAV: { to: string; key: string; icon: typeof HomeIcon }[] = [
  { to: '/home', key: 'nav.home', icon: HomeIcon },
  { to: '/campaigns', key: 'nav.campaigns', icon: MessageSquare },
  { to: '/queue', key: 'nav.queue', icon: ListTodo },
  { to: '/categories', key: 'nav.categories', icon: FolderTree },
  { to: '/scrapes', key: 'nav.scrapes', icon: Inbox },
  { to: '/variants', key: 'nav.variants', icon: MessageSquareText },
  { to: '/history', key: 'nav.history', icon: HistoryIcon },
  { to: '/settings', key: 'nav.settings', icon: SettingsIcon },
];

export function Sidebar({ session, onLogout, locked }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <aside className="flex w-56 flex-none flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border bg-background px-4 py-4">
        <div className="text-base font-semibold tracking-tight">MonchoOps</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {session.profile?.email ?? '—'}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/campaigns/new')}
        disabled={locked}
        className="m-3 inline-flex h-9 items-center justify-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('nav.newColdDm')}
      </button>

      {locked ? (
        <div className="mx-3 mb-2 border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          {t('sidebar.campaignInProgress')}
        </div>
      ) : null}

      <nav className="flex flex-col">
        {NAV.map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={(e) => {
              if (locked) e.preventDefault();
            }}
            tabIndex={locked ? -1 : 0}
            aria-disabled={locked}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-4 py-2 text-sm transition-colors',
                locked
                  ? 'pointer-events-none border-y border-transparent text-muted-foreground/50'
                  : isActive
                  ? 'border-y border-border bg-background font-medium text-foreground'
                  : 'border-y border-transparent text-muted-foreground hover:bg-background hover:text-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{t(key)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-3">
        <SyncIndicator />
        <ThemeToggle />
        <button
          type="button"
          onClick={handleLogout}
          disabled={locked}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <LogOut className="h-3 w-3" />
          {t('common.logOut')}
        </button>
      </div>
    </aside>
  );
}

function SyncIndicator() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  useEffect(() => onSyncStatusChange(setStatus), []);

  let icon: React.ReactNode;
  let label: string;
  let title = '';
  switch (status.kind) {
    case 'syncing':
      icon = <Loader2 className="h-3 w-3 animate-spin" />;
      label = t('common.syncing');
      break;
    case 'connected':
      icon = <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
      label = t('common.synced');
      title = t('sidebar.lastSyncedAt', {
        time: new Date(status.lastSyncAt).toLocaleTimeString(),
      });
      break;
    case 'offline':
      icon = <CloudOff className="h-3 w-3 text-muted-foreground" />;
      label = t('common.desktopOffline');
      title = t('sidebar.desktopOfflineHint');
      break;
    case 'error':
      icon = <CloudOff className="h-3 w-3 text-amber-600" />;
      label = t('common.syncError');
      title = status.message;
      break;
    default:
      icon = <CloudOff className="h-3 w-3 text-muted-foreground" />;
      label = t('common.idle');
  }

  return (
    <button
      type="button"
      onClick={() => void runSync()}
      title={title || t('sidebar.clickToSync')}
      className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const THEME_META: Record<ThemeMode, { key: string; icon: typeof Sun }> = {
  system: { key: 'common.system', icon: Monitor },
  light: { key: 'common.light', icon: Sun },
  dark: { key: 'common.dark', icon: Moon },
};

function ThemeToggle() {
  const { t } = useTranslation();
  const [mode, setMode] = useThemeMode();
  const { key, icon: Icon } = THEME_META[mode];
  const label = t(key);
  const next = () => {
    const i = THEME_ORDER.indexOf(mode);
    setMode(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
  };
  return (
    <button
      type="button"
      onClick={next}
      title={t('sidebar.themeTooltip', { label })}
      className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
