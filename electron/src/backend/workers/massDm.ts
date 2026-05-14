

import fs from 'fs';
import { attachDialogDismisser, ensureLoggedIn, followUser, likeNPostsOfUser, viewUserStories, waitForLocatorReady, waitForPageReady } from './ig';
import { isCancelled, launchBrowser, jitter, onInit, safeGoto, sendDmSend, sendError, sendLog, sendProgress, sendResult, waitFor, type WindowBounds } from './lib';
import type { AccountSecrets } from '../accounts';

interface InteractionsConfig {
  follow: boolean;
  likeCount: number;

  watchStories?: boolean;

  storyDwellSec?: number;
}

interface MassDmInit {
  jobId: string;
  secrets: AccountSecrets;
  usernamesCsvPath: string;
  messages: string[];
  intervalMs: number;
  interactions?: InteractionsConfig | null;

  excludeUsernames?: string[];
  maxSends?: number | null;
  headless: boolean;
  windowBounds?: WindowBounds;
  maximizeWindow?: boolean;
}

function pickVariant(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)]!;
}

function normaliseUsernameInput(raw: string): string {
  let s = raw.trim();
  const urlMatch = s.match(/(?:instagram\.com|ig\.me)\/([A-Za-z0-9._]+)/i);
  if (urlMatch && urlMatch[1]) s = urlMatch[1];
  return s.replace(/^@+/, '').replace(/[/?#].*$/, '').trim();
}

function parseUsernamesCsv(csvPath: string): string[] {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines[0]?.toLowerCase();
  const withoutHeader =
    first && (first === 'username' || first.startsWith('username,')) ? lines.slice(1) : lines;
  const usernames = withoutHeader
    .map((line) => normaliseUsernameInput(line.split(',')[0] ?? ''))
    .filter((u) => u.length > 0);
  return Array.from(new Set(usernames));
}

onInit<MassDmInit>(async (init) => {
  let usernames = parseUsernamesCsv(init.usernamesCsvPath);
  if (usernames.length === 0) {
    sendError('The username list is empty');
    return;
  }

  const excludeSet = new Set(
    (init.excludeUsernames ?? []).map((u) => String(u).toLowerCase().replace(/^@+/, ''))
  );
  if (excludeSet.size > 0) {
    const before = usernames.length;
    usernames = usernames.filter((u) => !excludeSet.has(u.toLowerCase()));
    const skipped = before - usernames.length;
    if (skipped > 0) {
      sendLog('info', `Skipping ${skipped} previously-DMed usernames`);
    }
    if (usernames.length === 0) {
      sendError('Every username in the list was already DMed by this account');
      return;
    }
  }
  const variants = (init.messages ?? []).map((m) => m.trim()).filter(Boolean);
  if (variants.length === 0) {
    sendError('No message variants provided');
    return;
  }

  const interactions =
    init.interactions &&
    (init.interactions.follow ||
      init.interactions.likeCount > 0 ||
      init.interactions.watchStories)
      ? {
          follow: !!init.interactions.follow,
          likeCount: Math.max(0, Math.min(5, Math.floor(init.interactions.likeCount))),
          watchStories: !!init.interactions.watchStories,
          storyDwellSec: Math.max(1, Math.min(15, Math.floor(init.interactions.storyDwellSec ?? 3))),
        }
      : null;

  const maxSends =
    typeof init.maxSends === 'number' && init.maxSends > 0
      ? init.maxSends
      : null;
  if (maxSends != null && usernames.length > maxSends) {
    sendLog(
      'info',
      `Plan limit: capping this campaign to ${maxSends} sends (your remaining monthly DM quota).`
    );
    usernames = usernames.slice(0, maxSends);
  }

  sendProgress(0, usernames.length);
  const { browser, context } = await launchBrowser({ headless: init.headless, secrets: init.secrets, windowBounds: init.windowBounds, maximizeWindow: init.maximizeWindow });

  let page = await context.newPage();
  let detachDismisser = attachDialogDismisser(page);
  let sent = 0;
  const failed: string[] = [];
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  try {

    if (interactions) await ensureLoggedIn(page, { captchaTimeoutMs: 5 * 60_000 });
  } catch (err) {
    sendLog('warn', `Login check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await safeGoto(page, 'https://www.instagram.com/direct/inbox/');
    await waitForPageReady(page);
  } catch (err) {
    sendLog('warn', `Initial nav failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (let i = 0; i < usernames.length; i++) {
    if (isCancelled()) break;
    const username = usernames[i]!;
    const personalised = pickVariant(variants).replace(/\{\{username\}\}/g, username);

    if (page.isClosed?.()) {
      sendLog('warn', 'Page was closed between DMs — reopening');
      try { detachDismisser(); } catch {}
      try {
        page = await context.newPage();
        detachDismisser = attachDialogDismisser(page);
      } catch (err) {
        sendLog('error', `Could not reopen page: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }

    if (interactions) {
      try {
        await runPreDmInteractions(page, username, interactions);
      } catch (err) {
        sendLog('warn', `Interactions for @${username} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (isCancelled()) break;
    }

    try {
      await sendDm(page, username, personalised);
      sent += 1;
      consecutiveFailures = 0;
      sendDmSend({ username, status: 'sent', message: personalised });
      sendProgress(i + 1, usernames.length, username);
    } catch (err) {
      failed.push(username);
      const reason = err instanceof Error ? err.message : String(err);
      const isVerification = err instanceof SendVerificationError;
      sendLog(
        isVerification ? 'info' : 'warn',
        isVerification
          ? `@${username} not verified after send: ${reason}`
          : `Failed to DM @${username}: ${reason}`
      );
      sendDmSend({ username, status: 'failed', message: personalised, error: reason });
      sendProgress(i + 1, usernames.length, username);

      if (!isVerification) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          sendLog(
            'error',
            `Aborting: ${MAX_CONSECUTIVE_FAILURES} failures in a row — IG likely blocked this account. Try again later.`
          );
          break;
        }
      }
    }

    if (i < usernames.length - 1) {
      await waitFor(jitter(init.intervalMs));
    }
  }

  sendResult({ sent, failed, total: usernames.length });
  detachDismisser();
  await browser.close();
  process.exit(0);
});

class SendVerificationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SendVerificationError';
  }
}

async function sendDm(page: any, username: string, message: string): Promise<void> {
  try {
    await sendDmViaShortlink(page, username, message);
    return;
  } catch (err) {
    if (err instanceof SendVerificationError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    sendLog('warn', `[@${username}] shortlink path failed (${reason}); falling back to /direct/new/`);
  }
  await sendDmViaDirectNew(page, username, message);
}

async function sendDmViaShortlink(
  page: any,
  username: string,
  message: string
): Promise<void> {
  sendLog('info', `[@${username}] opening ig.me/m/`);
  await safeGoto(page, `https://ig.me/m/${encodeURIComponent(username)}`);

  const composer = page
    .locator(
      [
        'main div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][aria-label*="Message" i]',
        'div[contenteditable="true"][aria-label*="Mensaje" i]',
      ].join(', ')
    )
    .first();
  await waitForLocatorReady(page, composer, { state: 'visible', timeout: 15_000 });
  sendLog('info', `[@${username}] composer visible (shortlink)`);

  await composer.click();
  await waitFor(jitter(400));
  await humanType(page, composer, message);
  sendLog('info', `[@${username}] typed message`);
  await waitFor(jitter(1200));
  await composer.press('Enter');
  sendLog('info', `[@${username}] pressed Enter`);
  await verifyAndConfirm(page, username, message);
}

async function sendDmViaDirectNew(
  page: any,
  username: string,
  message: string
): Promise<void> {
  sendLog('info', `[@${username}] opening /direct/new/`);
  await safeGoto(page, 'https://www.instagram.com/direct/new/');

  const composeBtn = page
    .locator(
      'div[role="button"]:has(svg[aria-label="New message"]), ' +
        'div[role="button"]:has(svg[aria-label="Mensaje nuevo"]), ' +
        'div[role="button"]:has(svg[aria-label="Nuevo mensaje"])'
    )
    .first();
  await waitForLocatorReady(page, composeBtn, { state: 'visible', timeout: 15_000 });
  await composeBtn.hover();
  await waitFor(jitter(600));
  await composeBtn.click();
  sendLog('info', `[@${username}] clicked New message icon`);

  const dialog = page.locator('div[role="dialog"]').first();
  await waitForLocatorReady(page, dialog, { state: 'visible', timeout: 20_000 });
  sendLog('info', `[@${username}] dialog visible`);

  const search = dialog.locator('input[type="text"], input:not([type])').first();
  await waitForLocatorReady(page, search, { state: 'visible', timeout: 10_000 });
  await search.click();
  await search.fill('');
  await humanType(page, search, username);
  sendLog('info', `[@${username}] typed username in search`);

  const firstRow = dialog
    .locator(
      'div[role="listbox"] [role="option"], label:has(input[type="checkbox"]), div[role="button"]:has(input[type="checkbox"])'
    )
    .first();
  await waitForLocatorReady(page, firstRow, { state: 'visible', timeout: 8_000 });
  await firstRow.hover();
  await waitFor(jitter(500));
  await firstRow.click();
  sendLog('info', `[@${username}] selected first result`);

  await waitFor(jitter(700));

  const chatBtn = dialog
    .locator('button, div[role="button"]')
    .filter({ hasText: /^(Chat|Chatear)$/ })
    .first();
  await waitForLocatorReady(page, chatBtn, { state: 'visible', timeout: 10_000 });
  await chatBtn.hover();
  await waitFor(jitter(500));
  await chatBtn.click();
  sendLog('info', `[@${username}] clicked Chat`);

  const composer = page
    .locator(
      [
        'main div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][aria-label*="Message" i]',
        'div[contenteditable="true"][aria-label*="Mensaje" i]',
      ].join(', ')
    )
    .first();
  await waitForLocatorReady(page, composer, { state: 'visible', timeout: 15_000 });
  await composer.click();
  await waitFor(jitter(400));
  await humanType(page, composer, message);
  sendLog('info', `[@${username}] typed message`);
  await waitFor(jitter(1200));
  await composer.press('Enter');
  sendLog('info', `[@${username}] pressed Enter`);
  await verifyAndConfirm(page, username, message);
}

async function verifyAndConfirm(page: any, username: string, message: string): Promise<void> {

  await waitFor(jitter(2500));

  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new SendVerificationError(`reload after send failed: ${reason}`);
  }
  await waitForPageReady(page);

  const needle = message.trim().replace(/\s+/g, ' ');
  if (!needle) throw new SendVerificationError('empty message — cannot verify');

  const found = (await page.evaluate((target: string) => {
    const main = document.querySelector('main');
    if (!main) return false;

    let acc = '';
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p: HTMLElement | null = (node as Text).parentElement;
        while (p && p !== main) {
          if (p.isContentEditable) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n: Node | null = walker.nextNode();
    while (n) {
      acc += ' ' + (n.textContent ?? '');
      n = walker.nextNode();
    }
    return acc.replace(/\s+/g, ' ').includes(target);
  }, needle)) as boolean;

  if (!found) {
    throw new SendVerificationError('message text not found in thread after reload');
  }
  sendLog('info', `[@${username}] verified — message present in thread`);
}

async function humanType(page: any, locator: any, text: string): Promise<void> {
  await locator.click();
  for (const ch of text) {
    await page.keyboard.type(ch);
    const thinking = Math.random() < 0.06 ? 250 + Math.random() * 250 : 0;
    await waitFor(60 + Math.random() * 80 + thinking);
  }
}

async function runPreDmInteractions(
  page: any,
  username: string,
  cfg: InteractionsConfig
): Promise<void> {
  if (cfg.watchStories) {
    try {
      const dwellMs = Math.max(1, cfg.storyDwellSec ?? 3) * 1000;
      const r = await viewUserStories(page, username, {
        perStoryDwellMs: [Math.floor(dwellMs * 0.7), Math.floor(dwellMs * 1.3)],
        maxStories: 5,
      });
      if (r.hadStories) sendLog('info', `Watched ${r.watched} stories of @${username}`);
    } catch (err) {
      sendLog('warn', `Story view for @${username} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await waitFor(jitter(1500));
    if (isCancelled()) return;
  }
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
