// Schedule window math. The service worker fires a periodic alarm to
// progress every campaign. For each one we ask: is now inside the user's
// configured window? If yes, send and reschedule for now+intervalMs. If no,
// figure out the next moment we'll be back inside the window and wait.

import type { ScheduleWindow } from './types';

export function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((p) => parseInt(p, 10));
  return { h: isFinite(h) ? h : 0, m: isFinite(m) ? m : 0 };
}

export function isInsideWindow(window: ScheduleWindow, now: Date = new Date()): boolean {
  const dow = now.getDay(); // 0=Sun … 6=Sat
  if (!window.daysOfWeek.includes(dow)) return false;
  const start = parseHHMM(window.startTime);
  const end = parseHHMM(window.endTime);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= startMin && nowMin <= endMin;
}

/** Returns the epoch ms of the next moment the window opens. Looks up to
 *  7 days ahead — the schedule must repeat at least weekly so something is
 *  always findable. */
export function nextWindowOpen(window: ScheduleWindow, from: Date = new Date()): number {
  if (window.daysOfWeek.length === 0) return Number.MAX_SAFE_INTEGER;
  const start = parseHHMM(window.startTime);

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from.getTime());
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(start.h, start.m, 0, 0);
    const dow = candidate.getDay();
    if (!window.daysOfWeek.includes(dow)) continue;
    if (offset === 0 && candidate.getTime() <= from.getTime()) {
      // window already started today and we're inside it — return now,
      // outside it but past start — try tomorrow.
      if (isInsideWindow(window, from)) return from.getTime();
      continue;
    }
    return candidate.getTime();
  }
  return Number.MAX_SAFE_INTEGER;
}
