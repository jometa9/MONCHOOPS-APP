// Shared dismisser for Instagram's interstitial prompts. IG drops two modals
// on top of the page at unpredictable moments — "Turn on Notifications" and
// "Save your login info?" — that cover the composer / grid / feed and break
// every selector-based worker until someone clicks "Not now". We watch for
// them on a low-frequency timer so any worker that opens an IG page is
// protected regardless of which route it lands on.

import { sendLog, waitFor } from '../lib';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const POLL_MS = 2500;

// "Not now" label variants across EN/ES and IG's alternate casings.
const NOT_NOW_LABELS = ['Not now', 'Not Now', 'Ahora no', 'Ahora No'];

// Title snippets we expect to see in the dialog body. We match against the
// modal heading so we never click "Not now" on an unrelated dialog — e.g. a
// confirmation the worker itself opened.
const NOTIFICATIONS_TITLES = [
  'turn on notifications',
  'activar las notificaciones',
  'activar notificaciones',
];
const SAVE_LOGIN_TITLES = [
  'save your login info',
  'guardar tu información de inicio',
  'guardar tus datos de inicio',
];

async function dismissByTitles(page: Page, titles: string[]): Promise<boolean> {
  const dialog = page.locator('div[role="dialog"]').first();
  const visible = await dialog.isVisible({ timeout: 250 }).catch(() => false);
  if (!visible) return false;

  const text = ((await dialog.innerText({ timeout: 500 }).catch(() => '')) || '').toLowerCase();
  if (!titles.some((t) => text.includes(t))) return false;

  for (const label of NOT_NOW_LABELS) {
    const btn = dialog
      .locator(`button:has-text("${label}"), div[role="button"]:has-text("${label}")`)
      .first();
    const btnVisible = await btn.isVisible({ timeout: 250 }).catch(() => false);
    if (!btnVisible) continue;
    try {
      await btn.click({ timeout: 1500 });
      await waitFor(500);
      return true;
    } catch {
      // Keep trying the next label variant.
    }
  }
  return false;
}

export async function dismissNotificationsPrompt(page: Page): Promise<boolean> {
  try {
    return await dismissByTitles(page, NOTIFICATIONS_TITLES);
  } catch {
    return false;
  }
}

export async function dismissSaveLoginPrompt(page: Page): Promise<boolean> {
  try {
    return await dismissByTitles(page, SAVE_LOGIN_TITLES);
  } catch {
    return false;
  }
}

// Runs both dismissers once. Callers use this right after a navigation when
// they want the page to be in a known state before continuing.
export async function dismissIgPrompts(page: Page): Promise<void> {
  await dismissSaveLoginPrompt(page);
  await dismissNotificationsPrompt(page);
}

// Starts a background watcher that keeps dismissing IG prompts while the
// page is alive. Returns a stop() so the worker can detach before tearing
// down the browser. Safe to call once per page.
export function attachDialogDismisser(page: Page): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, POLL_MS);
  };

  const tick = async () => {
    if (stopped) return;
    try {
      if (page.isClosed?.()) {
        stopped = true;
        return;
      }
      const url = (typeof page.url === 'function' ? page.url() : '') || '';
      if (/instagram\.com/i.test(url)) {
        if (await dismissNotificationsPrompt(page)) {
          sendLog('info', 'Dismissed "Turn on Notifications" prompt');
        }
        if (await dismissSaveLoginPrompt(page)) {
          sendLog('info', 'Dismissed "Save login info" prompt');
        }
      }
    } catch {
      // Page may be navigating or the context is closing — ignore and retry.
    }
    schedule();
  };

  try {
    page.on?.('close', () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });
  } catch {
    // Older playwright shims without event emitters — no-op.
  }

  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
