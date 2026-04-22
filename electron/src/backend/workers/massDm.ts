// Forked worker: sends a Direct Message to a list of Instagram usernames,
// one at a time, with a configurable interval + jitter between sends. If
// the user enabled pre-DM interactions, we follow / like-n-posts of each
// target before opening the chat.
//
// DM strategy (see sendDm): try the ig.me/m/<username> shortlink first —
// Meta's own universal DM link that redirects to the thread page, so we
// land on the composer directly. Fall back to the legacy /direct/new/
// modal flow only when the shortlink doesn't produce a composer.

import fs from 'fs';
import { attachDialogDismisser, ensureLoggedIn, followUser, likeNPostsOfUser, waitForLocatorReady, waitForPageReady } from './ig';
import { isCancelled, launchBrowser, jitter, onInit, safeGoto, sendDmSend, sendError, sendLog, sendProgress, sendResult, waitFor, type WindowBounds } from './lib';
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
  /** Usernames to skip — previously-DMed targets the UI excluded before
   *  starting. Filtered out before any progress is reported so the total
   *  matches what the user sees in the review screen. */
  excludeUsernames?: string[];
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
  let usernames = parseUsernamesCsv(init.usernamesCsvPath);
  if (usernames.length === 0) {
    sendError('The username list is empty');
    return;
  }

  // Skiplist: usernames the UI marked as already-DMed by this account.
  // Applied before the loop so progress totals match what the review
  // screen showed and we never waste an IG request on a known dupe.
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
    (init.interactions.follow || init.interactions.likeCount > 0)
      ? { follow: !!init.interactions.follow, likeCount: Math.max(0, Math.min(5, Math.floor(init.interactions.likeCount))) }
      : null;

  sendProgress(0, usernames.length);
  const { browser, context } = await launchBrowser({ headless: init.headless, secrets: init.secrets, windowBounds: init.windowBounds, maximizeWindow: init.maximizeWindow });

  let page = await context.newPage();
  let detachDismisser = attachDialogDismisser(page);
  let sent = 0;
  const failed: string[] = [];
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

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
    await waitForPageReady(page);
  } catch (err) {
    sendLog('warn', `Initial nav failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (let i = 0; i < usernames.length; i++) {
    if (isCancelled()) break;
    const username = usernames[i]!;
    const personalised = pickVariant(variants).replace(/\{\{username\}\}/g, username);

    // Resilience: if the previous iteration killed the page (IG closed the
    // tab, a challenge nav aborted the target, crash, etc.), open a fresh
    // one on the same context so we don't cascade "Target closed" failures
    // through the rest of the list. If the context itself is dead, there's
    // no recovery from here — bail cleanly.
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

      // Verification failures don't count toward the consecutive-failure
      // abort — the system worked (composer reached, Enter pressed), IG
      // just didn't render the message back. Only "couldn't reach the
      // composer" style errors increment the counter; N of those in a row
      // means IG throttled the account (action block, composer hidden,
      // captcha wall) and continuing burns the list without sending. We
      // still fall through to the inter-DM throttle below.
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

// Thrown by the send paths when the composer was reached and Enter was
// pressed, but the post-reload verification couldn't find the message in
// the thread. The dispatcher must NOT fall back on this error — doing so
// would send a duplicate DM if the original send actually went through
// (false-negative verification). The send is reported as failed instead.
class SendVerificationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SendVerificationError';
  }
}

// Dispatcher: try the ig.me shortlink path first (cheapest + fewest
// selectors), fall back to the /direct/new/ modal flow if the composer
// never shows up. The shortlink is Meta's own universal message link, so
// IG resolves username → thread_id server-side and we land directly on
// the chat page — skipping the pencil button, dialog, search input, row
// selection and Chat button of the legacy flow. The fallback preserves
// behaviour for edge cases where ig.me refuses to redirect (e.g. account
// country/age gates, transient 404s).
//
// Verification failures (`SendVerificationError`) are NOT retried via the
// fallback because the original send may have actually reached IG — a
// retry would deliver a duplicate.
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

// Primary path: navigate to https://ig.me/m/<username> — Meta's universal
// DM link. IG resolves the username on the server and 3xx-redirects to
// https://www.instagram.com/direct/t/<thread_id>/. From there the thread
// is open and the composer is the only editable on the page, so we type
// and press Enter. This avoids every localized button/label selector the
// legacy /direct/new/ flow depends on.
async function sendDmViaShortlink(
  page: any,
  username: string,
  message: string
): Promise<void> {
  sendLog('info', `[@${username}] opening ig.me/m/`);
  await safeGoto(page, `https://ig.me/m/${encodeURIComponent(username)}`);

  // If IG can't resolve the username (doesn't exist, suspended, etc.) the
  // redirect lands on the inbox or a 404 shell — neither has a composer,
  // so the locator wait times out *after* the page has settled and the
  // dispatcher falls through to the modal path.
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

// Fallback path: drive the /direct/new/ modal when the shortlink flow
// doesn't land us on a thread. Open dialog → type username in the scoped
// search input → pick the first result → click Chat/Next → type message
// → Enter. Each step emits a log so failures tell us where we died
// instead of just "Failed to DM @x".
//
// Selectors deliberately avoid:
//   - input[name="queryBox"]   (removed by IG in 2025+)
//   - div:has-text(username)   (matches ancestor wrappers, not the row)
//   - single-language button text ("Chat")
async function sendDmViaDirectNew(
  page: any,
  username: string,
  message: string
): Promise<void> {
  sendLog('info', `[@${username}] opening /direct/new/`);
  await safeGoto(page, 'https://www.instagram.com/direct/new/');

  // IG no longer auto-opens the compose modal when landing on /direct/new/ —
  // it redirects to the inbox and the user must click the "New message"
  // pencil icon. Selector anchors on the svg's aria-label (localized in EN
  // and ES) and walks up to the clickable role="button" ancestor.
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

  // The search input lives inside the modal. Scope to the dialog so we
  // never grab the top-nav search. placeholder / aria-label are both
  // localized (Search… / Buscar…), so we anchor on the input being the
  // only visible text-entry inside the dialog.
  const search = dialog.locator('input[type="text"], input:not([type])').first();
  await waitForLocatorReady(page, search, { state: 'visible', timeout: 10_000 });
  await search.click();
  await search.fill('');
  await humanType(page, search, username);
  sendLog('info', `[@${username}] typed username in search`);

  // Pick the first row in the results list. IG orders matches by its own
  // ranking, so the top row is the intended target. Each row is rendered
  // as a role="option" inside a listbox, or — on older variants — as a
  // label wrapping a checkbox. We try both. The readiness wait inside
  // `waitForLocatorReady` is what gives the user-search XHR time to land —
  // no blunt sleep needed.
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

  // Click the Chat button to open the thread. Localized EN/ES.
  const chatBtn = dialog
    .locator('button, div[role="button"]')
    .filter({ hasText: /^(Chat|Chatear)$/ })
    .first();
  await waitForLocatorReady(page, chatBtn, { state: 'visible', timeout: 10_000 });
  await chatBtn.hover();
  await waitFor(jitter(500));
  await chatBtn.click();
  sendLog('info', `[@${username}] clicked Chat`);

  // Message composer. Scope to <main> so a lingering dialog input or a
  // search bar above doesn't get picked. aria-label is localized, so we
  // match both EN and ES.
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

// Confirm the message actually landed in the thread. IG renders an
// optimistic bubble the instant Enter is pressed even when the server
// later rejects the send (action block, soft-captcha, silent drop), so
// reading the local DOM right away gives false positives. We reload the
// thread to force a re-fetch from the server, then look for the message
// text inside <main> excluding any contenteditable region (the composer
// is empty after reload, but defending against drafts is cheap insurance).
//
// Throws SendVerificationError on miss so the loop can flag the row as
// failed without triggering the consecutive-failure abort.
async function verifyAndConfirm(page: any, username: string, message: string): Promise<void> {
  // Let the optimistic UI commit and the server respond before reloading,
  // otherwise the reload can race the in-flight send request.
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

    // Walk every text node under <main>, skipping anything inside a
    // contenteditable subtree (the composer). Aggregate to a single string,
    // collapse whitespace, and substring-match the message.
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

// Type `text` into the focused locator one character at a time with a
// per-char delay drawn from a human-like distribution (60-140ms base +
// occasional 250-500ms "thinking" pauses). Playwright's locator.type only
// accepts a constant delay, and IG's anti-bot reads keystroke inter-arrival
// times — constant-interval typing is the single easiest signal to flag.
async function humanType(page: any, locator: any, text: string): Promise<void> {
  await locator.click();
  for (const ch of text) {
    await page.keyboard.type(ch);
    const thinking = Math.random() < 0.06 ? 250 + Math.random() * 250 : 0;
    await waitFor(60 + Math.random() * 80 + thinking);
  }
}

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
