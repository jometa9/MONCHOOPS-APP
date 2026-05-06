import { Pencil } from 'lucide-react';
import { cn } from '@/shared/cn';

interface Props {
  title: string;
  onEdit?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function SummaryCard({ title, onEdit, children, className }: Props) {
  return (
    <div className={cn('border border-border bg-background', className)}>
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>{title}</span>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium normal-case text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </button>
        ) : null}
      </div>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}
