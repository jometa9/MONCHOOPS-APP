import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-4 px-6 pt-16 pb-40 text-center',
        className
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

interface EmptyStateLinkButtonProps {
  to: string;
  icon?: ReactNode;
  children: ReactNode;
}

export function EmptyStateLinkButton({ to, icon, children }: EmptyStateLinkButtonProps) {
  return (
    <Link
      to={to}
      className="inline-flex h-9 items-center gap-1.5 border border-border bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      {icon}
      {children}
    </Link>
  );
}
