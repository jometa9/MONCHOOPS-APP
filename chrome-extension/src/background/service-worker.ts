// Service worker — single source of truth for campaign progress.
//
// Why alarms: MV3 service workers are evicted after ~30s of inactivity.
// chrome.alarms is the only API that wakes us back up reliably even when
// the dashboard tab is closed. We register a global "tick" alarm and let
// every running campaign be re-evaluated on each fire — no per-campaign
// alarms, no in-memory job state to lose.
//
// Why one DM at a time: IG hates parallel sends from the same account.
// The single content-script tab guarantees serialization. The dashboard
// also locks its navigation while a campaign is running so the user can't
// start another one in parallel.
//
// Tab strategy: we keep a dedicated background IG tab pinned (created on
// demand, reused across ticks). It has to exist before we can talk to the
// content script. The user can also leave their normal IG tab open — we
// reuse the first eligible IG tab we find.

import { db, nextPendingLead, countLeads } from '@/shared/db';
import { jitter, pickVariant, uuid } from '@/shared/format';
import type { Campaign, Lead } from '@/shared/types';
import type { IgSendRequest, IgSendResult } from '@/shared/messages';

// --- alarms --------------------------------------------------------------

const TICK_ALARM = 'b2dm-tick';
const TICK_PERIOD_MIN = 1; // chrome.alarms minimum granularity

chrome.runtime.onInstalled.addListener(() => {
  void ensureTick();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureTick();
});

async function ensureTick(): Promise<void> {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_PERIOD_MIN });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    void tick().catch((err) => console.error('[b2dm] tick failed', err));
  }
});

// --- popup / dashboard messages -----------------------------------------

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !('type' in req)) return false;
  const type = (req as { type: string }).type;

  // ig/sendDm comes from a content script and is not directed at the SW —
  // skip so the content-script handler in the IG tab claims it.
  if (type === 'ig/sendDm') return false;

  (async () => {
    try {
      switch (type) {
        case 'sw/ping':
          sendResponse({ ok: true });
          return;
        case 'sw/openDashboard':
          await openDashboard();
          sendResponse({ ok: true });
          return;
        case 'sw/igSessionCheck': {
          const c = await chrome.cookies.get({
            url: 'https://www.instagram.com',
            name: 'sessionid',
          });
          sendResponse({ ok: true, data: { loggedIn: !!c?.value } });
          return;
        }
        case 'sw/runCampaignNow': {
          const id = (req as { campaignId: string }).campaignId;
          await db.campaigns.update(id, {
            status: 'running',
            nextRunAt: Date.now(),
          });
          await ensureTick();
          // Run a tick right away so a "Start" doesn't have to wait
          // up to a minute for the next periodic fire.
          void tick();
          sendResponse({ ok: true });
          return;
        }
        case 'sw/pauseCampaign': {
          const id = (req as { campaignId: string }).campaignId;
          await db.campaigns.update(id, { status: 'paused' });
          sendResponse({ ok: true });
          return;
        }
        case 'sw/resumeCampaign': {
          const id = (req as { campaignId: string }).campaignId;
          await db.campaigns.update(id, { status: 'running', nextRunAt: Date.now() });
          void tick();
          sendResponse({ ok: true });
          return;
        }
        default:
          sendResponse({ ok: false, error: `unknown type: ${type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});

// --- click on the action icon → open the dashboard ----------------------

chrome.action.onClicked.addListener(() => {
  // Only fires if no popup is set in the manifest. We do declare a popup,
  // so this is a no-op fallback for users who disable popups.
  void openDashboard();
});

async function openDashboard(): Promise<void> {
  const url = chrome.runtime.getURL('src/dashboard/index.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

// --- the tick ------------------------------------------------------------

// Mutex: ensures only one tick is processing at a time even if Chrome
// double-fires the alarm or a manual "Run now" arrives mid-tick.
let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const candidates = await db.campaigns
      .where('status')
      .equals('running')
      .toArray();

    const now = Date.now();
    for (const campaign of candidates) {
      if (campaign.nextRunAt && campaign.nextRunAt > now) continue;
      const lead = await nextPendingLead(campaign.id);
      if (!lead || lead.id === undefined) {
        await db.campaigns.update(campaign.id, {
          status: 'done',
          completedAt: now,
        });
        continue;
      }
      // Process a single DM. processOne is awaited so we don't fire
      // multiple sends in one tick — keeps things gentle and avoids
      // racing the IG content script.
      try {
        await processOne(campaign, lead);
      } catch (err) {
        console.error('[b2dm] processOne crashed', err);
      }
      // Schedule the next attempt with jitter.
      await db.campaigns.update(campaign.id, {
        nextRunAt: Date.now() + jitter(campaign.intervalMs),
      });
    }
  } finally {
    ticking = false;
  }
}

async function processOne(campaign: Campaign, lead: Lead): Promise<void> {
  if (lead.id === undefined) return;
  const sessionOk = await chrome.cookies.get({
    url: 'https://www.instagram.com',
    name: 'sessionid',
  });
  if (!sessionOk?.value) {
    // No IG session → don't burn the lead. Park the campaign for an hour
    // so we don't loop while the user logs in.
    await db.campaigns.update(campaign.id, {
      status: 'paused',
      nextRunAt: Date.now() + 60 * 60_000,
    });
    notify(
      'B2DM — Cold DM paused',
      `No Instagram session detected. Log into instagram.com and resume "${campaign.name}".`
    );
    return;
  }

  const tab = await ensureIgTab();
  if (!tab.id) {
    await db.campaigns.update(campaign.id, { nextRunAt: Date.now() + 60_000 });
    return;
  }

  await db.leads.update(lead.id, { status: 'sending' });

  const message = pickVariant(campaign.variants).replace(/\{\{username\}\}/g, lead.username);
  const req: IgSendRequest = {
    type: 'ig/sendDm',
    username: lead.username,
    message,
    interactions: campaign.interactions,
  };

  let result: IgSendResult;
  try {
    result = await sendToTab<IgSendResult>(tab.id, req, 5 * 60_000);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const ts = Date.now();
  if (result.ok) {
    await db.leads.update(lead.id, {
      status: 'sent',
      sentAt: ts,
      sentMessage: message,
    });
    await db.history.put({
      id: uuid(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      username: lead.username,
      status: 'sent',
      message,
      timestamp: ts,
    });
    await db.campaigns.update(campaign.id, {
      sentCount: (campaign.sentCount ?? 0) + 1,
    });
  } else {
    await db.leads.update(lead.id, {
      status: 'failed',
      sentAt: ts,
      sentMessage: message,
      error: result.error,
    });
    await db.history.put({
      id: uuid(),
      campaignId: campaign.id,
      campaignName: campaign.name,
      username: lead.username,
      status: 'failed',
      message,
      error: result.error,
      timestamp: ts,
    });
    await db.campaigns.update(campaign.id, {
      failedCount: (campaign.failedCount ?? 0) + 1,
    });
  }

  // If everything is done, mark the campaign as such so the UI flips.
  const remaining = await countLeads(campaign.id, 'pending');
  if (remaining === 0) {
    await db.campaigns.update(campaign.id, {
      status: 'done',
      completedAt: ts,
    });
  }
}

// --- IG tab management --------------------------------------------------

async function ensureIgTab(): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.query({ url: ['https://www.instagram.com/*'] });
  // Prefer a tab that already has our content script — i.e. one that's
  // been idle on instagram.com long enough. Any IG tab works though.
  for (const t of existing) {
    if (t.id !== undefined && t.url) return t;
  }
  // No IG tab — create one in the background so we don't steal focus.
  const created = await chrome.tabs.create({
    url: 'https://www.instagram.com/',
    active: false,
    pinned: true,
  });
  // Wait for it to load enough that the content script is up.
  await waitForTabReady(created.id!);
  return created;
}

async function waitForTabReady(tabId: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t && t.status === 'complete') return;
    await sleep(500);
  }
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

function sendToTab<T>(tabId: number, message: unknown, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error('send_to_tab_timeout'));
    }, timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, message, (response: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response);
      });
    } catch (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

// --- notifications ------------------------------------------------------

function notify(title: string, body: string): void {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message: body,
    });
  } catch {
    // notifications permission not granted — silent.
  }
}
