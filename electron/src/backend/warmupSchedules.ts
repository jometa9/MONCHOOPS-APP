// Recurring warmup schedules. A schedule is "run this list of actions
// every day, at this time, between these two dates, for this account".
//
// Firing rules:
//   1. A schedule is eligible when today (local-midnight) is inside
//      [startDate, endDate] (inclusive).
//   2. A schedule has "already fired today" when lastFiredAt, bucketed
//      to local-midnight, equals today's local-midnight.
//   3. Otherwise, it fires once current-time-seconds-since-midnight
//      crosses timeOfDaySec.
//
// The "app was closed during the scheduled minute" case is handled
// naturally: on boot the scheduler runs a catch-up tick immediately, and
// any eligible-not-yet-fired schedule whose local time has passed fires
// right away. If the whole day is missed, the next boot inside the
// window fires that day's run the moment it happens.
//
// Actions are fanned out through startWarmup(), which already queues per
// account. A schedule with three actions creates three queued warmup
// jobs; they drain sequentially.

import crypto from 'crypto';
import { getDb } from './db';
import { getAccount, type AccountPublic } from './accounts';
import { startWarmup, type WarmupAction } from './jobs';
import { WARMUP_SCHEDULE_TICK_INTERVAL_MS, WARMUP_STARTUP_CATCH_UP_DELAY_MS } from './warmupConfig';

export interface WarmupSchedulePublic {
  id: string;
  accountId: string;
  /** Local-midnight ms of the first day on which the schedule can fire. */
  startDate: number;
  /** Local-midnight ms of the last day on which the schedule can fire
   *  (inclusive). */
  endDate: number;
  /** Trigger time expressed as seconds since local midnight. */
  timeOfDaySec: number;
  actions: WarmupAction[];
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface WarmupScheduleRow {
  id: string;
  account_id: string;
  start_date: number;
  end_date: number;
  time_of_day_sec: number;
  actions_json: string;
  last_fired_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToPublic(row: WarmupScheduleRow): WarmupSchedulePublic {
  let actions: WarmupAction[] = [];
  try { actions = JSON.parse(row.actions_json) as WarmupAction[]; } catch {}
  return {
    id: row.id,
    accountId: row.account_id,
    startDate: row.start_date,
    endDate: row.end_date,
    timeOfDaySec: row.time_of_day_sec,
    actions,
    lastFiredAt: row.last_fired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWarmupSchedules(accountId?: string): WarmupSchedulePublic[] {
  const sql = accountId
    ? `SELECT * FROM warmup_schedules WHERE account_id = ? ORDER BY created_at DESC`
    : `SELECT * FROM warmup_schedules ORDER BY created_at DESC`;
  const stmt = getDb().prepare<string[], WarmupScheduleRow>(sql);
  const rows = accountId ? stmt.all(accountId) : stmt.all();
  return rows.map(rowToPublic);
}

export interface CreateWarmupScheduleInput {
  accountId: string;
  startDate: number;
  endDate: number;
  timeOfDaySec: number;
  actions: WarmupAction[];
}

export function createWarmupSchedule(input: CreateWarmupScheduleInput): WarmupSchedulePublic {
  if (!input.accountId) throw new Error('accountId is required');
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    throw new Error('At least one warmup action is required');
  }
  if (!Number.isFinite(input.startDate) || !Number.isFinite(input.endDate)) {
    throw new Error('Date range is required');
  }
  if (input.endDate < input.startDate) {
    throw new Error('End date must be on or after the start date');
  }
  const timeOfDaySec = Math.max(0, Math.min(86_399, Math.floor(input.timeOfDaySec)));
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO warmup_schedules(
         id, account_id, start_date, end_date, time_of_day_sec,
         actions_json, last_fired_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    )
    .run(
      id,
      input.accountId,
      input.startDate,
      input.endDate,
      timeOfDaySec,
      JSON.stringify(input.actions),
      now,
      now
    );
  const row = getDb()
    .prepare<[string], WarmupScheduleRow>('SELECT * FROM warmup_schedules WHERE id = ?')
    .get(id)!;
  return rowToPublic(row);
}

export function deleteWarmupSchedule(id: string): void {
  getDb().prepare('DELETE FROM warmup_schedules WHERE id = ?').run(id);
}

// Returns the local-midnight ms timestamp of the calendar day that
// contains `ms`. Relies on Date's local-tz setters — Electron runs in
// the user's tz so this matches what the user sees on their clock.
function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Decide whether a schedule should fire at timestamp `now`. Pure —
 *  exposed for testing / debug. */
export function shouldFire(schedule: WarmupSchedulePublic, now: number): boolean {
  const todayMidnight = localMidnight(now);
  if (todayMidnight < schedule.startDate) return false;
  if (todayMidnight > schedule.endDate) return false;

  const secondsSinceMidnight = Math.floor((now - todayMidnight) / 1000);
  if (secondsSinceMidnight < schedule.timeOfDaySec) return false;

  if (schedule.lastFiredAt != null) {
    const lastFiredMidnight = localMidnight(schedule.lastFiredAt);
    if (lastFiredMidnight >= todayMidnight) return false;
  }
  return true;
}

let tickHandle: NodeJS.Timeout | null = null;
let startupHandle: NodeJS.Timeout | null = null;

/** Start the scheduler. Idempotent — calling twice is a no-op. */
export function startWarmupScheduler(): void {
  if (tickHandle || startupHandle) return;
  startupHandle = setTimeout(() => {
    startupHandle = null;
    runTick();
    tickHandle = setInterval(runTick, WARMUP_SCHEDULE_TICK_INTERVAL_MS);
  }, WARMUP_STARTUP_CATCH_UP_DELAY_MS);
}

export function stopWarmupScheduler(): void {
  if (startupHandle) {
    clearTimeout(startupHandle);
    startupHandle = null;
  }
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
}

function runTick(): void {
  try {
    const now = Date.now();
    const schedules = listWarmupSchedules();
    for (const schedule of schedules) {
      if (!shouldFire(schedule, now)) continue;
      fireSchedule(schedule, now);
    }
  } catch (err) {
    console.error('[warmup-scheduler] tick failed:', err);
  }
}

function fireSchedule(schedule: WarmupSchedulePublic, now: number): void {
  const account: AccountPublic | null = getAccount(schedule.accountId);
  if (!account) {
    // Account was deleted — clean up the orphan so we don't re-check it
    // every tick.
    deleteWarmupSchedule(schedule.id);
    return;
  }
  if (account.status === 'error') {
    // Don't enqueue against an account that has no valid session. Mark
    // "fired for today" anyway so we don't keep retrying the same
    // broken account every minute — the user can retry the login from
    // the Accounts screen and tomorrow's run will happen normally.
    markFired(schedule.id, now);
    return;
  }

  for (const action of schedule.actions) {
    try {
      startWarmup({ accountId: schedule.accountId, action });
    } catch (err) {
      console.error(
        `[warmup-scheduler] could not enqueue action ${action.type} for ${account.username}:`,
        err
      );
    }
  }
  markFired(schedule.id, now);
}

function markFired(scheduleId: string, now: number): void {
  getDb()
    .prepare(`UPDATE warmup_schedules SET last_fired_at = ?, updated_at = ? WHERE id = ?`)
    .run(now, now, scheduleId);
}
