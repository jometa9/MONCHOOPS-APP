export function formatDateTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${rm}m`;
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function jitter(baseMs: number, range = 0.4): number {

  const min = baseMs * (1 - range);
  const max = baseMs * (1 + range);
  return Math.floor(min + Math.random() * (max - min));
}

export function pickVariant<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
