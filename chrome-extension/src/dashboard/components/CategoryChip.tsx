import { Tag } from 'lucide-react';
import { cn } from '@/shared/cn';

interface Props {
  name: string;
  className?: string;
}

export function CategoryChip({ name, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground',
        className
      )}
    >
      <Tag className="h-3 w-3" />
      {name}
    </span>
  );
}
