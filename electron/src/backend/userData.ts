import fs from 'fs';
import { getDb } from './db';
import { cancelJob, listRunningJobs, listScrapeResults } from './jobs';

// Erases every row tied to the active user (accounts, jobs, scrapes,
// categories, DM + warmup history, schedules, preference meta) and their
// on-disk artifacts. Kept out of `license.ts` so both the explicit
// "Delete all my data" button and the automatic wipe-on-user-switch go
// through the exact same code path.
//
// The login state (license_key, profile, subscription meta rows) is
// preserved — callers that want to replace it do it themselves.
export function wipeUserData(): void {
  const running = listRunningJobs();
  for (const job of running) cancelJob(job.id);

  const scrapeRows = listScrapeResults();
  for (const row of scrapeRows) {
    try {
      fs.unlinkSync(row.csvPath);
    } catch {}
  }

  const db = getDb();
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM leads').run();
    db.prepare('DELETE FROM category_scrapes').run();
    db.prepare('DELETE FROM lead_categories').run();
    db.prepare('DELETE FROM mass_dm_results').run();
    db.prepare('DELETE FROM warmup_results').run();
    db.prepare('DELETE FROM warmup_schedules').run();
    db.prepare('DELETE FROM scrape_results').run();
    db.prepare('DELETE FROM jobs').run();
    db.prepare('DELETE FROM accounts').run();
    db.prepare(
      `DELETE FROM meta
       WHERE key NOT IN ('license_key_encrypted', 'profile', 'subscription', 'last_owner_email')`
    ).run();
  });
  wipe();
}
