// Forked worker: sends a Direct Message to a list of Instagram usernames,
// one at a time, with a configurable interval + jitter between sends. If
// the user enabled pre-DM interactions, we follow / like-n-posts of each
// target before opening the chat.

import fs from 'fs';
import { ensureLoggedIn, followUser, likeNPostsOfUser } from './ig';
import { isCancelled, launchBrowser, jitter, onInit, safeGoto, sendError, sendLog, sendProgress, sendResult, waitFor, type WindowBounds } from './lib';
import type { AccountSecrets } from '../accounts';

interface InteractionsConfig {
  follow: boolean;
  likeCount: number;
}

interface MassDmInit {
  jobId: string;
  secrets: AccountSecrets;
  usernamesCsvPath: string;
  messages: string[];
  intervalMs: number;
  interactions?: InteractionsConfig | null;
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

function pickVariant(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)]!;
}

function parseUsernamesCsv(csvPath: string): string[] {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0]?.toLowerCase();
  const withoutHeader =
    first && (first === 'username' || first.startsWith('username,')) ? lines.slice(1) : lines;
  const usernames = withoutHeader
    .map((line) => line.split(',')[0]!.trim().replace(/^@+/, ''))
    .filter((u) => u.length > 0);
  return Array.from(new Set(usernames));
}

onInit<MassDmInit>(async (init) => {
  const usernames = parseUsernamesCsv(init.usernamesCsvPath);
  if (usernames.length === 0) {
    sendError('The username list is empty');
    return;
  }
  const variants = (init.messages ?? []).map((m) => m.trim()).filter(Boolean);
  if (variants.length === 0) {
    sendError('No message variants provided');
    return;
  }

  const interactions =
    init.interactions &&
    (init.interactions.follow || init.interactions.likeCount > 0)
      ? { follow: !!init.interactions.follow, likeCount: Math.max(0, Math.min(5, Math.floor(init.interactions.likeCount))) }
      : null;

  sendProgress(0, usernames.length);
  const { browser, context } = await launchBrowser({ headless: init.headless, secrets: init.secrets, windowBounds: init.windowBounds, maximizeWindow: init.maximizeWindow });

  const page = await context.newPage();
  let sent = 0;
  const failed: string[] = [];

  try {
    // Make sure we actually have a live session before we start hitting
    // DM / profile pages. ensureLoggedIn is a no-op when the cookie is
    // already valid; otherwise it waits out captcha and tries a password
    // re-login if credentials were seeded on the context.
    if (interactions) await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });
  } catch (err) {
    sendLog('warn', `Login check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await safeGoto(page, 'https://www.instagram.com/direct/inbox/');
    await waitFor(2000);
  } catch (err) {
    sendLog('warn', `Initial nav failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (let i = 0; i < usernames.length; i++) {
    if (isCancelled()) break;
    const username = usernames[i]!;
    const personalised = pickVariant(variants).replace(/\{\{username\}\}/g, username);

    if (interactions) {
      try {
        await runPreDmInteractions(page, username, interactions);
      } catch (err) {
        sendLog('warn', `Interactions for @${username} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (isCancelled()) break;
    }

    try {
      await safeGoto(page, 'https://www.instagram.com/direct/new/');
      await waitFor(1500);

      // Search box for a new DM thread.
      const search = page
        .locator('input[placeholder*="Search" i], input[name="queryBox"]')
        .first();
      await search.waitFor({ state: 'visible', timeout: 15_000 });
      await search.click();
      await search.fill('');
      await search.type(username, { delay: 60 });
      await waitFor(1500);

      // Click matching result.
      const result = page
        .locator(`div[role="dialog"] div:has-text("${username}")`)
        .first();
      await result.waitFor({ state: 'visible', timeout: 10_000 });
      await result.click();
      await waitFor(400);

      const chatBtn = page.locator('button:has-text("Chat"), div[role="button"]:has-text("Chat")').first();
      await chatBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await chatBtn.click();
      await waitFor(1500);

      const input = page
        .locator('div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message" i]')
        .first();
      await input.waitFor({ state: 'visible', timeout: 15_000 });
      await input.click();
      await input.type(personalised, { delay: 15 });
      await waitFor(500);
      await input.press('Enter');
      await waitFor(1500);

      sent += 1;
      sendProgress(i + 1, usernames.length, username);
    } catch (err) {
      failed.push(username);
      sendLog('warn', `Failed to DM @${username}: ${err instanceof Error ? err.message : String(err)}`);
      sendProgress(i + 1, usernames.length, username);
    }

    if (i < usernames.length - 1) {
      await waitFor(jitter(init.intervalMs));
    }
  }

  sendResult({ sent, failed, total: usernames.length });
  await browser.close();
  process.exit(0);
});

// Follow → like N posts. Order is deliberately "visit profile → engage
// → DM" because that reads as a natural funnel to IG's spam heuristics
// and mirrors how a real user discovers someone before messaging.
async function runPreDmInteractions(
  page: any,
  username: string,
  cfg: InteractionsConfig
): Promise<void> {
  if (cfg.follow) {
    const res = await followUser(page, username);
    if (res.ok && !res.skipped) sendLog('info', `Followed @${username}`);
    else if (res.ok && res.skipped) sendLog('info', `@${username} — ${res.reason}`);
    else sendLog('warn', `Follow @${username} failed: ${res.reason}`);
    await waitFor(jitter(2000));
    if (isCancelled()) return;
  }
  if (cfg.likeCount > 0) {
    const res = await likeNPostsOfUser(page, username, cfg.likeCount);
    if (res.reason) {
      sendLog('info', `@${username}: ${res.reason}`);
    } else {
      sendLog(
        'info',
        `@${username}: liked ${res.liked}/${res.attempted} (${res.skipped} skipped, ${res.failed} failed)`
      );
    }
    await waitFor(jitter(2000));
  }
}
