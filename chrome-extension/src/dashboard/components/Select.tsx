import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/shared/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel?: string;
  fullWidth?: boolean;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
  buttonClassName,
  menuClassName,
  ariaLabel,
  fullWidth,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div
      ref={containerRef}
      className={cn('relative inline-block', fullWidth && 'block w-full', className)}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 min-w-[7rem] items-center justify-between gap-2 border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors',
          'hover:bg-accent/50 focus:border-foreground disabled:cursor-not-allowed disabled:opacity-60',
          fullWidth && 'w-full',
          buttonClassName
        )}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown
          className={cn('h-3.5 w-3.5 flex-none text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className={cn(
            'absolute left-0 right-0 z-50 mt-1 overflow-hidden border border-border bg-background py-1 shadow-md',
            menuClassName
          )}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
                    active ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent/60'
                  )}
                >
                  <Check
                    className={cn('h-3.5 w-3.5 flex-none', active ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
