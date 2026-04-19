import { NavLink } from 'react-router-dom';
import { Database, FolderTree, Home, Instagram, ListTodo, LogOut, Send, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/context/SessionContext';

interface Item {
  to: string;
  label: string;
  icon: typeof Home;
}

const items: Item[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/accounts', label: 'Accounts', icon: Instagram },
  { to: '/cold-dm', label: 'Cold DM', icon: Send },
  { to: '/scrape', label: 'Scrape Leads', icon: Users },
  { to: '/queue', label: 'Queue', icon: ListTodo },
  { to: '/data', label: 'Data', icon: Database },
  { to: '/categories', label: 'Categories', icon: FolderTree },
];

const bottomItems: Item[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const { session, logout } = useSession();

  const navClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
      isActive
        ? 'bg-background font-medium text-foreground shadow-sm'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
    );

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
          <NavLink key={to} to={to} end={to === '/'} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="space-y-0.5 px-2 pb-2">
        {bottomItems.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={navClass}>
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => { void logout(); }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
