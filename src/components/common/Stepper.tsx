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
    <div className="mt-4 flex items-center gap-2">
      {labels.map((label, i) => {
        const num = i + 1;
        const active = num === current;
        const done = num < current;
        const clickable = !!onJump && (num < current || (canJump?.(num) ?? true));
        return (
          <button
            key={label}
            type="button"
            onClick={() => clickable && onJump?.(num)}
            disabled={!clickable}
            className={cn(
              'flex flex-1 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              active && 'border-primary bg-primary/10 text-foreground',
              done && 'border-border bg-muted text-foreground hover:bg-accent',
              !active && !done && 'border-border bg-background text-muted-foreground',
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
