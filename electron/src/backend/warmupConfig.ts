// Central tuning knobs for the warmup subsystem. Everything worth tweaking
// lives here so the user can change behaviour without hunting through
// multiple files. Every consumer imports from here.
//
// All durations are in milliseconds unless named otherwise.

/** Minimum age (in days since account creation) before an account can be
 *  considered "warmed". */
export const WARMUP_MIN_DAYS_SINCE_CREATION = 15;

/** Minimum number of distinct calendar days on which warmup activity was
 *  performed against the account before it counts as "warmed". */
export const WARMUP_MIN_DISTINCT_ACTIVE_DAYS = 15;

/** How often the scheduler scans its table looking for schedules that
 *  should fire. 60s is a good tradeoff: small enough that the user
 *  doesn't notice a delay between "scheduled time" and "fires", large
 *  enough to be cheap. */
export const WARMUP_SCHEDULE_TICK_INTERVAL_MS = 60_000;

/** After a fresh boot the scheduler runs a single catch-up tick before
 *  the regular cadence kicks in, so reopened apps fire any missed-but-
 *  still-in-window schedules immediately. This delay is the grace period
 *  between app-ready and that first tick, to let migrations / IPC
 *  handlers finish wiring up. */
export const WARMUP_STARTUP_CATCH_UP_DELAY_MS = 2_000;

/** One day in milliseconds. Exposed as a named constant because it
 *  appears in several date-math expressions and the literal is easy to
 *  mis-type. */
export const DAY_MS = 86_400_000;
