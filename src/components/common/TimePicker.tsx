import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {

  value: string;
  onChange: (hm: string) => void;
  disabled?: boolean;
  id?: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function TimePicker({ value, onChange, disabled, id }: Props) {
  const { t } = useTranslation();
  const [rawH, rawM] = value.split(':');
  const hours = clamp(parseInt(rawH ?? '', 10), 0, 23);
  const minutes = clamp(parseInt(rawM ?? '', 10), 0, 59);

  function emit(h: number, m: number) {
    onChange(`${pad(clamp(h, 0, 23))}:${pad(clamp(m, 0, 59))}`);
  }

  function handleHours(raw: string) {
    const n = parseInt(raw, 10);
    emit(Number.isFinite(n) ? n : 0, minutes);
  }
  function handleMinutes(raw: string) {
    const n = parseInt(raw, 10);
    emit(hours, Number.isFinite(n) ? n : 0);
  }

  return (
    <div
      className={cn(
        'flex h-10 items-stretch border border-border bg-background',
        disabled && 'opacity-50'
      )}
    >
      <div className="flex w-10 flex-none items-center justify-center border-r border-border text-muted-foreground">
        <Clock className="h-4 w-4" />
      </div>
      <input
        id={id}
        type="number"
        min={0}
        max={23}
        step={1}
        value={pad(hours)}
        onChange={(e) => handleHours(e.target.value)}
        disabled={disabled}
        aria-label={t('components.timePicker.hours')}
        className="w-12 bg-transparent px-2 text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span className="flex items-center text-sm text-muted-foreground">:</span>
      <input
        type="number"
        min={0}
        max={59}
        step={1}
        value={pad(minutes)}
        onChange={(e) => handleMinutes(e.target.value)}
        disabled={disabled}
        aria-label={t('components.timePicker.minutes')}
        className="w-12 bg-transparent px-2 text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
