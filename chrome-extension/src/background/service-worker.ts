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
// Why the SW orchestrates instead of the content script: every navigation
// (location.href = X) destroys the content-script context, killing any
// in-flight async work. The fix is to keep each content-script call
// atomic (sub-second, never navigates) and drive navigation from the SW
// via chrome.tabs.update + waitForTabReady + ping-after-load.

import { db, nextPendingLead, countLeads } from '@/shared/db';
import { jitter, pickVariant, uuid } from '@/shared/format';
import type { Campaign, Lead, InteractionsConfig } from '@/shared/types';
import type {
  CsBoolData,
  CsDwellData,
  CsFollowData,
  CsLikeData,
  CsPostsData,
  CsRequest,
  CsResponse,
  IgSendResult,
} from '@/shared/messages';

// --- alarms --------------------------------------------------------------

const TICK_ALARM = 'b2dm-tick';
const TICK_PERIOD_MIN = 1;

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
  // b2dm/* primitives are addressed at content scripts via chrome.tabs.sendMessage
  // and never reach here, but be defensive in case any code uses runtime.sendMessage.
  if (type.startsWith('b2dm/')) return false;

  (async () => {
    try {
      switch (type) {
        case 'sw/ping':
          sendResponse({ ok: true });
          return;
        case 'sw/openDashboard': {
          const path = (req as { path?: string }).path;
          await openDashboard(path);
          sendResponse({ ok: true });
          return;
        }
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

chrome.action.onClicked.addListener(() => {
  void openDashboard();
});

async function openDashboard(path?: string): Promise<void> {
  const baseUrl = chrome.runtime.getURL('src/dashboard/index.html');
  const hash = path ? `#${path.startsWith('/') ? path : `/${path}`}` : '';
  const tabs = await chrome.tabs.query({ url: `${baseUrl}*` });
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true, url: baseUrl + hash });
    if (tabs[0].windowId !== undefined) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: baseUrl + hash });
}

// --- the tick ------------------------------------------------------------

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
      try {
        await processOne(campaign, lead);
      } catch (err) {
        console.error('[b2dm sw] processOne crashed', err);
      }
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

  console.log('[b2dm sw] processing lead', lead.username, 'in tab', tab.id);
  let result: IgSendResult;
  try {
    if (campaign.interactions) {
      await runInteractions(tab.id, lead.username, campaign.interactions);
    }
    const verified = await sendDm(tab.id, lead.username, message);
    result = { ok: true, verified };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[b2dm sw] processOne failed for', lead.username, error);
    result = { ok: false, error };
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

  const remaining = await countLeads(campaign.id, 'pending');
  if (remaining === 0) {
    await db.campaigns.update(campaign.id, {
      status: 'done',
      completedAt: ts,
    });
  }
}

// --- interaction flows (orchestrated step-by-step) -----------------------

async function runInteractions(
  tabId: number,
  username: string,
  cfg: InteractionsConfig
): Promise<void> {
  if (cfg.watchStories) {
    try {
      await watchStoriesFlow(tabId, username, cfg.storyDwellSec);
    } catch (err) {
      console.warn('[b2dm sw] watchStories failed for', username, err);
    }
    await sleep(jitter(1200));
  }
  if (cfg.follow) {
    try {
      await followUserFlow(tabId, username);
    } catch (err) {
      console.warn('[b2dm sw] follow failed for', username, err);
    }
    await sleep(jitter(1500));
  }
  if (cfg.likeCount > 0) {
    try {
      await likeNPostsFlow(tabId, username, cfg.likeCount);
    } catch (err) {
      console.warn('[b2dm sw] likeNPosts failed for', username, err);
    }
    await sleep(jitter(1500));
  }
}

async function watchStoriesFlow(tabId: number, username: string, dwellSec: number): Promise<void> {
  await navigateTab(tabId, `https://www.instagram.com/stories/${encodeURIComponent(username)}/`);
  // Quick check: if IG bounced us off /stories/, no story exists.
  const onStories = await rpc<CsBoolData>(tabId, { type: 'b2dm/checkOnStories' });
  if (!onStories.value) return;
  const dwellMs = Math.max(1, dwellSec) * 1000;
  for (let i = 0; i < 5; i++) {
    const r = await rpc<CsDwellData>(tabId, { type: 'b2dm/dwellStory', dwellMs }).catch(() => null);
    if (!r || !r.stillOnStories) break;
  }
}

async function followUserFlow(tabId: number, username: string): Promise<void> {
  await navigateTab(tabId, `https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(1500));
  const before = await rpc<CsFollowData>(tabId, { type: 'b2dm/detectFollowState' });
  if (before.state === 'following' || before.state === 'requested' || before.state === 'unavailable') {
    return;
  }
  await rpc(tabId, { type: 'b2dm/clickFollow' });
  // Settle: re-poll a few times until state changes or timeout.
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    const after = await rpc<CsFollowData>(tabId, { type: 'b2dm/detectFollowState' }).catch(() => null);
    if (!after) return;
    if (after.state === 'following' || after.state === 'requested') return;
  }
}

async function likeNPostsFlow(tabId: number, username: string, n: number): Promise<void> {
  if (n <= 0) return;
  await navigateTab(tabId, `https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(1500));
  const posts = await rpc<CsPostsData>(tabId, { type: 'b2dm/findPostUrls', n });
  for (const url of posts.urls) {
    await navigateTab(tabId, url);
    await sleep(jitter(1500));
    const state = await rpc<CsLikeData>(tabId, { type: 'b2dm/detectLikeState' }).catch(() => null);
    if (!state || state.state !== 'not_liked') continue;
    await rpc(tabId, { type: 'b2dm/clickLike' });
    await sleep(jitter(1200));
  }
}

// --- DM flow -------------------------------------------------------------

async function sendDm(tabId: number, username: string, message: string): Promise<boolean> {
  try {
    return await sendDmViaShortlink(tabId, username, message);
  } catch (err) {
    console.warn('[b2dm sw] shortlink path failed, falling back to /direct/new/', err);
    return sendDmViaDirectNew(tabId, username, message);
  }
}

async function sendDmViaShortlink(
  tabId: number,
  username: string,
  message: string
): Promise<boolean> {
  await navigateTab(tabId, `https://ig.me/m/${encodeURIComponent(username)}`);
  // ig.me 3xx-redirects to instagram.com/direct/t/<thread_id>/. If IG can't
  // resolve the username it lands on the inbox or a 404 — wait for either.
  const matched = await rpc<{ matched: boolean }>(tabId, {
    type: 'b2dm/waitForUrlMatch',
    pattern: 'instagram\\.com/direct/(t|inbox)',
    timeoutMs: 25_000,
  });
  if (!matched.matched) throw new Error('shortlink_did_not_redirect');

  const composer = await rpc<{ found: boolean }>(tabId, {
    type: 'b2dm/waitForComposer',
    timeoutMs: 15_000,
  });
  if (!composer.found) throw new Error('composer_not_found');

  await rpc(tabId, { type: 'b2dm/typeAndSendDm', message });
  return verifyDelivery(tabId, message);
}

async function sendDmViaDirectNew(
  tabId: number,
  username: string,
  message: string
): Promise<boolean> {
  await navigateTab(tabId, 'https://www.instagram.com/direct/new/');
  await sleep(jitter(1200));

  const opened = await rpc<{ ok: boolean }>(tabId, { type: 'b2dm/openNewDmDialog' });
  if (!opened.ok) throw new Error('cannot_open_new_dm_dialog');

  const picked = await rpc<{ ok: boolean }>(tabId, {
    type: 'b2dm/pickFirstSearchResult',
    username,
  });
  if (!picked.ok) throw new Error('cannot_pick_search_result');

  const composer = await rpc<{ found: boolean }>(tabId, {
    type: 'b2dm/waitForComposer',
    timeoutMs: 15_000,
  });
  if (!composer.found) throw new Error('composer_not_found');

  await rpc(tabId, { type: 'b2dm/typeAndSendDm', message });
  return verifyDelivery(tabId, message);
}

// IG's optimistic UI lies on rejected sends — reload the thread to force a
// server fetch, then check the rendered DOM for the message text.
async function verifyDelivery(tabId: number, message: string): Promise<boolean> {
  await sleep(jitter(2000));
  await chrome.tabs.reload(tabId);
  await waitForTabReady(tabId);
  await ensureContentScript(tabId);
  await sleep(2500);
  const r = await rpc<CsBoolData>(tabId, { type: 'b2dm/threadContains', needle: message });
  if (!r.value) throw new Error('verification_failed: message not found in thread after reload');
  return true;
}

// --- IG tab management --------------------------------------------------

async function ensureIgTab(): Promise<chrome.tabs.Tab> {
  const existing = await chrome.tabs.query({ url: ['https://www.instagram.com/*'] });
  for (const t of existing) {
    if (t.id !== undefined && t.url) {
      await ensureContentScript(t.id);
      return t;
    }
  }
  const created = await chrome.tabs.create({
    url: 'https://www.instagram.com/',
    active: false,
    pinned: true,
  });
  await waitForTabReady(created.id!);
  await ensureContentScript(created.id!);
  return created;
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  console.log('[b2dm sw] navigate tab', tabId, 'to', url);
  await chrome.tabs.update(tabId, { url });
  await waitForTabReady(tabId, 30_000);
  await ensureContentScript(tabId);
}

async function waitForTabReady(tabId: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // First wait for the tab to LEAVE 'complete' (i.e. start loading the new
  // url) — chrome.tabs.update is async and 'complete' from a previous nav
  // may still be reported on the very next read.
  let sawLoading = false;
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return;
    if (t.status === 'loading') {
      sawLoading = true;
    }
    if (sawLoading && t.status === 'complete') return;
    if (!sawLoading && t.status === 'complete') {
      // Maybe the navigation hasn't been picked up yet — give it a beat.
      await sleep(150);
      const t2 = await chrome.tabs.get(tabId).catch(() => null);
      if (!t2) return;
      if (t2.status === 'complete') return;
    }
    await sleep(200);
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  // Newly-loaded pages need a beat for the content script to attach its
  // listener at document_idle.
  for (let i = 0; i < 20; i++) {
    if (await pingContentScript(tabId)) return;
    await sleep(300);
  }
  // Last resort: reload the tab. Happens if the URL is one our manifest
  // doesn't match (eg ig.me before redirect) or the script crashed.
  try {
    await chrome.tabs.reload(tabId);
  } catch {
    return;
  }
  await waitForTabReady(tabId);
  for (let i = 0; i < 20; i++) {
    if (await pingContentScript(tabId)) return;
    await sleep(300);
  }
}

function pingContentScript(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'b2dm/ping' }, (resp) => {
        const err = chrome.runtime.lastError;
        resolve(!err && !!resp);
      });
    } catch {
      resolve(false);
    }
  });
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

// --- RPC primitive calls -------------------------------------------------

async function rpc<T = unknown>(tabId: number, message: CsRequest, timeoutMs = 60_000): Promise<T> {
  const resp = await sendToTab<CsResponse>(tabId, message, timeoutMs);
  if (!resp.ok) throw new Error(`${message.type}: ${resp.error}`);
  return (resp.data as T) ?? (undefined as T);
}

function sendToTab<T>(tabId: number, message: unknown, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error('send_to_tab_timeout')));
    }, timeoutMs);
    const onRemoved = (closedId: number) => {
      if (closedId === tabId) finish(() => reject(new Error('ig_tab_closed')));
    };
    chrome.tabs.onRemoved.addListener(onRemoved);
    try {
      chrome.tabs.sendMessage(tabId, message, (response: T) => {
        const err = chrome.runtime.lastError;
        if (err) finish(() => reject(new Error(err.message)));
        else finish(() => resolve(response));
      });
    } catch (err) {
      finish(() => reject(err));
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
  } catch {}
}

