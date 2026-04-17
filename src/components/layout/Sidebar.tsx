import { NavLink } from 'react-router-dom';
import { Database, Home, Instagram, LogOut, Send, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/context/SessionContext';

interface Item {
  to: string;
  label: string;
  icon: typeof Home;
}

const items: Item[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/accounts', label: 'Instagram Accounts', icon: Instagram },
  { to: '/cold-dm', label: 'Cold DM', icon: Send },
  { to: '/scrape', label: 'Scrape Leads', icon: Users },
  { to: '/data', label: 'Data', icon: Database },
];

export function Sidebar() {
  const { session, logout } = useSession();

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-muted/30">
      <div className="px-4 pb-2 pt-4">
        <div className="text-sm font-semibold">B2DM</div>
        {session.profile ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{session.profile.email}</div>
        ) : null}
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-2">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <button
        onClick={() => {
          void logout();
        }}
        className="mx-2 mb-3 flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
        <span>Log out</span>
      </button>
    </aside>
  );
}
