import { History as HistoryIcon, LogOut, MessageSquare, MessageSquareText, Plus, Settings as SettingsIcon } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '@/shared/license';
import type { Session } from '@/shared/types';
import { cn } from '@/shared/cn';

interface Props {
  session: Session;
  onLogout: () => void;
}

const NAV = [
  { to: '/campaigns', label: 'Campaigns', icon: MessageSquare },
  { to: '/history', label: 'History', icon: HistoryIcon },
  { to: '/variants', label: 'Variants', icon: MessageSquareText },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({ session, onLogout }: Props) {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    onLogout();
  }

  return (
    <aside className="flex w-56 flex-none flex-col border-r border-border bg-muted/30">
      <div className="border-b border-border px-4 py-4">
        <div className="text-sm font-semibold tracking-tight">B2DM</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {session.profile?.email ?? '—'}
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/campaigns/new')}
        className="m-3 inline-flex h-9 items-center justify-center gap-1.5 bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-3.5 w-3.5" />
        New cold DM
      </button>

      <nav className="flex flex-col">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors',
                isActive
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

      <div className="mt-auto border-t border-border p-3">
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-accent"
        >
          <LogOut className="h-3 w-3" />
          Log out
        </button>
      </div>
    </aside>
  );
}
