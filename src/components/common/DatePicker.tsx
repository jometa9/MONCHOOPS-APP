import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  /** Selected date as a YYYY-MM-DD string, or '' when unset. */
  value: string;
  onChange: (ymd: string) => void;
  disabled?: boolean;
  /** Optional lower bound as YYYY-MM-DD (inclusive). */
  min?: string;
  /** Optional upper bound as YYYY-MM-DD (inclusive). */
  max?: string;
  placeholder?: string;
  id?: string;
}

const MONTH_KEYS = [
  'components.datePicker.monthJanuary',
  'components.datePicker.monthFebruary',
  'components.datePicker.monthMarch',
  'components.datePicker.monthApril',
  'components.datePicker.monthMay',
  'components.datePicker.monthJune',
  'components.datePicker.monthJuly',
  'components.datePicker.monthAugust',
  'components.datePicker.monthSeptember',
  'components.datePicker.monthOctober',
  'components.datePicker.monthNovember',
  'components.datePicker.monthDecember',
];

// Week starts Monday — matches most non-US locales and is consistent
// across the app's target audience.
const DAY_LABEL_KEYS = [
  'components.datePicker.dayMo',
  'components.datePicker.dayTu',
  'components.datePicker.dayWe',
  'components.datePicker.dayTh',
  'components.datePicker.dayFr',
  'components.datePicker.daySa',
  'components.datePicker.daySu',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month0: number, day: number): string {
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

function formatDisplay(s: string, monthName: (idx: number) => string): string {
  const p = parseYmd(s);
  if (!p) return s;
  return `${monthName(p.month).slice(0, 3)} ${p.day}, ${p.year}`;
}

export function DatePicker({ value, onChange, disabled, min, max, placeholder, id }: Props) {
  const { t } = useTranslation();
  const monthName = (idx: number) => t(MONTH_KEYS[idx]!);
  const placeholderLabel = placeholder ?? t('components.datePicker.placeholder');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Calendar cursor: which month is currently shown in the popover.
  // Defaults to the month of `value`, or today's month if `value` is empty.
  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const parsed = parseYmd(value);
    if (parsed) return { year: parsed.year, month: parsed.month };
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  // When the value changes externally, snap the visible month to it so the
  // user doesn't have to re-navigate after the form writes back.
  useEffect(() => {
    const parsed = parseYmd(value);
    if (parsed) setCursor({ year: parsed.year, month: parsed.month });
  }, [value]);

  // Click-outside closes the popover. Attached only while open so we don't
  // pay the listener cost when the picker is idle.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const cells = useMemo(() => buildGrid(cursor.year, cursor.month), [cursor.year, cursor.month]);

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      const total = prev.month + delta;
      const year = prev.year + Math.floor(total / 12);
      const month = ((total % 12) + 12) % 12;
      return { year, month };
    });
  }

  function pick(day: (typeof cells)[number]) {
    if (day.disabled) return;
    onChange(day.ymd);
    setOpen(false);
  }

  // Apply min/max to each cell so out-of-range days render as disabled
  // (still visible, just not clickable).
  for (const c of cells) {
    if (min && c.ymd < min) c.disabled = true;
    if (max && c.ymd > max) c.disabled = true;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'flex h-10 w-full items-center gap-2 border border-border bg-background px-3 text-sm transition-colors',
          !disabled && 'hover:bg-accent',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <Calendar className="h-4 w-4 flex-none text-muted-foreground" />
        <span className={cn('truncate text-left', !value && 'text-muted-foreground')}>
          {value ? formatDisplay(value, monthName) : placeholderLabel}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-[280px] border border-border bg-background p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="inline-flex h-7 w-7 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('components.datePicker.previousMonth')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="text-xs font-medium">
              {monthName(cursor.month)} {cursor.year}
            </div>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="inline-flex h-7 w-7 items-center justify-center border border-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t('components.datePicker.nextMonth')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
            {DAY_LABEL_KEYS.map((key) => (
              <div key={key}>{t(key)}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-xs">
            {cells.map((cell, i) => {
              const selected = cell.ymd === value;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={cell.disabled}
                  onClick={() => pick(cell)}
                  className={cn(
                    'inline-flex h-7 items-center justify-center border border-transparent text-xs tabular-nums transition-colors',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : cell.inMonth
                      ? 'text-foreground hover:bg-accent'
                      : 'text-muted-foreground/40 hover:bg-accent',
                    cell.disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent'
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface GridCell {
  day: number;
  inMonth: boolean;
  ymd: string;
  disabled: boolean;
}

function buildGrid(year: number, month0: number): GridCell[] {
  const firstOfMonth = new Date(year, month0, 1);
  // Convert Sun=0..Sat=6 into Mon=0..Sun=6 so columns align with
  // DAY_LABELS above.
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const daysInPrev = new Date(year, month0, 0).getDate();
  const prevMonth0 = month0 === 0 ? 11 : month0 - 1;
  const prevYear = month0 === 0 ? year - 1 : year;
  const nextMonth0 = month0 === 11 ? 0 : month0 + 1;
  const nextYear = month0 === 11 ? year + 1 : year;

  const cells: GridCell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({ day: d, inMonth: false, ymd: ymd(prevYear, prevMonth0, d), disabled: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, inMonth: true, ymd: ymd(year, month0, d), disabled: false });
  }
  // Pad out to six full weeks (42 cells) so the popover height is stable.
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, inMonth: false, ymd: ymd(nextYear, nextMonth0, d), disabled: false });
  }
  return cells;
}
