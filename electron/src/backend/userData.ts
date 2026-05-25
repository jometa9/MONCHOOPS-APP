import fs from 'fs';
import { getDb } from './db';
import { cancelJob, listRunningJobs, listScrapeResults } from './jobs';

export function wipeUserData(): void {
  const running = listRunningJobs();
  for (const job of running) cancelJob(job.id);

  const scrapeRows = listScrapeResults();
  for (const row of scrapeRows) {
    if (!row.csvPath) continue;
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
    db.prepare('DELETE FROM scrape_results').run();
    db.prepare('DELETE FROM jobs').run();
    db.prepare('DELETE FROM accounts').run();
    db.prepare('DELETE FROM meta').run();
  });
  wipe();
}
