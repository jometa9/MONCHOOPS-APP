

import { sendLog, waitFor } from '../lib';

type Page = any;

const POLL_MS = 2500;

const NOT_NOW_LABELS = ['Not now', 'Not Now', 'Ahora no', 'Ahora No'];

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

    }
  }
  return false;
}

const VIEW_AS_TITLES = ['view as ', 'ver como ', 'ver historia como '];
const VIEW_STORY_LABELS = ['View story', 'Ver historia', 'Ver story'];

export async function confirmViewStoryPrompt(page: Page): Promise<boolean> {
  try {
    const dialog = page.locator('div[role="dialog"]').first();
    const visible = await dialog.isVisible({ timeout: 250 }).catch(() => false);
    if (!visible) return false;

    const text = ((await dialog.innerText({ timeout: 500 }).catch(() => '')) || '').toLowerCase();
    if (!VIEW_AS_TITLES.some((t) => text.includes(t))) return false;

    for (const label of VIEW_STORY_LABELS) {
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

      }
    }
  } catch {

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

export async function dismissIgPrompts(page: Page): Promise<void> {
  await dismissSaveLoginPrompt(page);
  await dismissNotificationsPrompt(page);
}

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

    }
    schedule();
  };

  try {
    page.on?.('close', () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    });
  } catch {

  }

  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
