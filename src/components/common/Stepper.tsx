import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

interface StepperProps {
  labels: readonly string[];
  current: number;
  onJump?: (step: number) => void;
  canJump?: (step: number) => boolean;
}

export function Stepper({ labels, current, onJump, canJump }: StepperProps) {
  return (
    <div className="mt-4 flex items-stretch border border-border">
      {labels.map((label, i) => {
        const num = i + 1;
        const active = num === current;
        const done = num < current;
        const isLast = i === labels.length - 1;
        const clickable = !!onJump && (num < current || (canJump?.(num) ?? true));
        return (
          <button
            key={label}
            type="button"
            onClick={() => clickable && onJump?.(num)}
            disabled={!clickable}
            className={cn(
              'inline-flex h-9 flex-1 items-center gap-2 px-3 text-xs font-medium transition-colors',
              !isLast && 'border-r border-border',
              active && 'bg-accent text-accent-foreground',
              done && 'bg-background text-foreground hover:bg-accent/50',
              !active && !done && 'bg-background text-muted-foreground',
              !clickable && 'cursor-not-allowed opacity-70'
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px]',
                active && 'bg-primary text-primary-foreground',
                done && 'bg-foreground text-background',
                !active && !done && 'bg-muted text-muted-foreground'
              )}
            >
              {done ? <Check className="h-3 w-3" /> : num}
            </span>
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
