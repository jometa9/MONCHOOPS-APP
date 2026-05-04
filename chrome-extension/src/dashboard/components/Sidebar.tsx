import { History as HistoryIcon, LogOut, MessageSquare, MessageSquareText, Monitor, Moon, Plus, Settings as SettingsIcon, Sun } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '@/shared/license';
import type { Session } from '@/shared/types';
import { cn } from '@/shared/cn';
import { useThemeMode, type ThemeMode } from '../theme';

interface Props {
  session: Session;
  onLogout: () => void;
  /** When true, navigation is disabled because a campaign is in progress. */
  locked?: boolean;
}

const NAV = [
  { to: '/campaigns', label: 'Campaigns', icon: MessageSquare },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/variants', label: 'Variants', icon: MessageSquareText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({ session, onLogout, locked }: Props) {
  const navigate = useNavigate();

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
        New cold DM
      </button>

      {locked ? (
        <div className="mx-3 mb-2 border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-800">
          A campaign is in progress. Pause it from its detail screen to use the rest of the app.
        </div>
      ) : null}

      <nav className="flex flex-col">
        {NAV.map(({ to, label, icon: Icon }) => (
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
                'flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors',
                locked
                  ? 'pointer-events-none text-muted-foreground/50'
                  : isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
              )
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border p-3">
        <ThemeToggle />
        <button
          type="button"
          onClick={handleLogout}
          disabled={locked}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <LogOut className="h-3 w-3" />
          Log out
        </button>
      </div>
    </aside>
  );
}

const THEME_ORDER: ThemeMode[] = ['system', 'light', 'dark'];
const THEME_META: Record<ThemeMode, { label: string; icon: typeof Sun }> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
};

function ThemeToggle() {
  const [mode, setMode] = useThemeMode();
  const { label, icon: Icon } = THEME_META[mode];
  const next = () => {
    const i = THEME_ORDER.indexOf(mode);
    setMode(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
  };
  return (
    <button
      type="button"
      onClick={next}
      title={`Theme: ${label} (click to change)`}
      className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}
