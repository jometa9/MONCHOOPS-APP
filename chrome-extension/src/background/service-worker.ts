

import { db, nextPendingLead, countLeads } from '@/shared/db';
import { jitter, pickVariant, uuid } from '@/shared/format';
import {
  fetchUsage,
  flushDmBuffer,
  getCachedUsage,
  onDmLimitReached,
  queueDmReport,
} from '@/shared/license';
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

const TICK_ALARM = 'monchoops-tick';
const TICK_PERIOD_MIN = 1;

onDmLimitReached(({ limit, used }) => {
  void handleDmLimitReached(limit, used);
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureTick();
  void flushDmBuffer().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  void ensureTick();
  void flushDmBuffer().catch(() => {});
});

async function ensureTick(): Promise<void> {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, { periodInMinutes: TICK_PERIOD_MIN });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    void tick().catch((err) => console.error('[monchoops] tick failed', err));
  }
});

chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (!req || typeof req !== 'object' || !('type' in req)) return false;
  const type = (req as { type: string }).type;

  if (type.startsWith('monchoops/')) return false;

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

let ticking = false;

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    void flushDmBuffer().catch(() => {});

    const candidates = await db.campaigns
      .where('status')
      .equals('running')
      .toArray();
    if (candidates.length === 0) return;

    const usage = await fetchUsage();
    if (usage && usage.dms.limit != null && (usage.dms.remaining ?? 0) <= 0) {
      for (const campaign of candidates) {
        await db.campaigns.update(campaign.id, {
          status: 'paused',
          nextRunAt: Date.now() + 60 * 60_000,
        });
      }
      notify(
        'MonchoOps — DM limit reached',
        `Your ${usage.plan} plan allows ${usage.dms.limit} DMs per month. Campaigns paused. Upgrade or wait until next month.`
      );
      return;
    }

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
        console.error('[monchoops sw] processOne crashed', err);
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
      'MonchoOps — Cold DM paused',
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

  console.log('[monchoops sw] processing lead', lead.username, 'in tab', tab.id);
  let result: IgSendResult;
  try {
    if (campaign.interactions) {
      await runInteractions(tab.id, lead.username, campaign.interactions);
    }
    const verified = await sendDm(tab.id, lead.username, message);
    result = { ok: true, verified };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[monchoops sw] processOne failed for', lead.username, error);
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
    void reportSentDm(lead.username, ts).catch(() => {});
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

async function runInteractions(
  tabId: number,
  username: string,
  cfg: InteractionsConfig
): Promise<void> {
  if (cfg.watchStories) {
    try {
      await watchStoriesFlow(tabId, username, cfg.storyDwellSec);
    } catch (err) {
      console.warn('[monchoops sw] watchStories failed for', username, err);
    }
    await sleep(jitter(1200));
  }
  if (cfg.follow) {
    try {
      await followUserFlow(tabId, username);
    } catch (err) {
      console.warn('[monchoops sw] follow failed for', username, err);
    }
    await sleep(jitter(1500));
  }
  if (cfg.likeCount > 0) {
    try {
      await likeNPostsFlow(tabId, username, cfg.likeCount);
    } catch (err) {
      console.warn('[monchoops sw] likeNPosts failed for', username, err);
    }
    await sleep(jitter(1500));
  }
}

async function watchStoriesFlow(tabId: number, username: string, dwellSec: number): Promise<void> {
  await navigateTab(tabId, `https://www.instagram.com/stories/${encodeURIComponent(username)}/`);

  const onStories = await rpc<CsBoolData>(tabId, { type: 'monchoops/checkOnStories' });
  if (!onStories.value) return;
  const dwellMs = Math.max(1, dwellSec) * 1000;
  for (let i = 0; i < 5; i++) {
    const r = await rpc<CsDwellData>(tabId, { type: 'monchoops/dwellStory', dwellMs }).catch(() => null);
    if (!r || !r.stillOnStories) break;
  }
}

async function followUserFlow(tabId: number, username: string): Promise<void> {
  await navigateTab(tabId, `https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(1500));
  const before = await rpc<CsFollowData>(tabId, { type: 'monchoops/detectFollowState' });
  if (before.state === 'following' || before.state === 'requested' || before.state === 'unavailable') {
    return;
  }
  await rpc(tabId, { type: 'monchoops/clickFollow' });

  for (let i = 0; i < 6; i++) {
    await sleep(700);
    const after = await rpc<CsFollowData>(tabId, { type: 'monchoops/detectFollowState' }).catch(() => null);
    if (!after) return;
    if (after.state === 'following' || after.state === 'requested') return;
  }
}

async function likeNPostsFlow(tabId: number, username: string, n: number): Promise<void> {
  if (n <= 0) return;
  await navigateTab(tabId, `https://www.instagram.com/${encodeURIComponent(username)}/`);
  await sleep(jitter(1500));
  const posts = await rpc<CsPostsData>(tabId, { type: 'monchoops/findPostUrls', n });
  for (const url of posts.urls) {
    await navigateTab(tabId, url);
    await sleep(jitter(1500));
    const state = await rpc<CsLikeData>(tabId, { type: 'monchoops/detectLikeState' }).catch(() => null);
    if (!state || state.state !== 'not_liked') continue;
    await rpc(tabId, { type: 'monchoops/clickLike' });
    await sleep(jitter(1200));
  }
}

async function sendDm(tabId: number, username: string, message: string): Promise<boolean> {
  try {
    return await sendDmViaShortlink(tabId, username, message);
  } catch (err) {
    console.warn('[monchoops sw] shortlink path failed, falling back to /direct/new/', err);
    return sendDmViaDirectNew(tabId, username, message);
  }
}

async function sendDmViaShortlink(
  tabId: number,
  username: string,
  message: string
): Promise<boolean> {
  await navigateTab(tabId, `https://ig.me/m/${encodeURIComponent(username)}`);

  const matched = await rpc<{ matched: boolean }>(tabId, {
    type: 'monchoops/waitForUrlMatch',
    pattern: 'instagram\\.com/direct/(t|inbox)',
    timeoutMs: 25_000,
  });
  if (!matched.matched) throw new Error('shortlink_did_not_redirect');

  const composer = await rpc<{ found: boolean }>(tabId, {
    type: 'monchoops/waitForComposer',
    timeoutMs: 15_000,
  });
  if (!composer.found) throw new Error('composer_not_found');

  await rpc(tabId, { type: 'monchoops/typeAndSendDm', message });
  return verifyDelivery(tabId, message);
}

async function sendDmViaDirectNew(
  tabId: number,
  username: string,
  message: string
): Promise<boolean> {
  await navigateTab(tabId, 'https://www.instagram.com/direct/new/');
  await sleep(jitter(1200));

  const opened = await rpc<{ ok: boolean }>(tabId, { type: 'monchoops/openNewDmDialog' });
  if (!opened.ok) throw new Error('cannot_open_new_dm_dialog');

  const picked = await rpc<{ ok: boolean }>(tabId, {
    type: 'monchoops/pickFirstSearchResult',
    username,
  });
  if (!picked.ok) throw new Error('cannot_pick_search_result');

  const composer = await rpc<{ found: boolean }>(tabId, {
    type: 'monchoops/waitForComposer',
    timeoutMs: 15_000,
  });
  if (!composer.found) throw new Error('composer_not_found');

  await rpc(tabId, { type: 'monchoops/typeAndSendDm', message });
  return verifyDelivery(tabId, message);
}

async function verifyDelivery(tabId: number, message: string): Promise<boolean> {
  await sleep(jitter(2000));
  await chrome.tabs.reload(tabId);
  await waitForTabReady(tabId);
  await ensureContentScript(tabId);
  await sleep(2500);
  const r = await rpc<CsBoolData>(tabId, { type: 'monchoops/threadContains', needle: message });
  if (!r.value) throw new Error('verification_failed: message not found in thread after reload');
  return true;
}

async function forceInstagramEnglish(): Promise<void> {
  try {
    await chrome.cookies.set({
      url: 'https://www.instagram.com/',
      domain: '.instagram.com',
      name: 'ig_lang',
      value: 'en',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    });
  } catch (err) {
    console.warn('[monchoops sw] failed to set ig_lang cookie', err);
  }
}

async function ensureIgTab(): Promise<chrome.tabs.Tab> {
  await forceInstagramEnglish();
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
  console.log('[monchoops sw] navigate tab', tabId, 'to', url);
  await forceInstagramEnglish();
  await chrome.tabs.update(tabId, { url });
  await waitForTabReady(tabId, 30_000);
  await ensureContentScript(tabId);
}

async function waitForTabReady(tabId: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  let sawLoading = false;
  while (Date.now() < deadline) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return;
    if (t.status === 'loading') {
      sawLoading = true;
    }
    if (sawLoading && t.status === 'complete') return;
    if (!sawLoading && t.status === 'complete') {

      await sleep(150);
      const t2 = await chrome.tabs.get(tabId).catch(() => null);
      if (!t2) return;
      if (t2.status === 'complete') return;
    }
    await sleep(200);
  }
}

async function ensureContentScript(tabId: number): Promise<void> {

  for (let i = 0; i < 20; i++) {
    if (await pingContentScript(tabId)) return;
    await sleep(300);
  }

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
      chrome.tabs.sendMessage(tabId, { type: 'monchoops/ping' }, (resp) => {
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

let cachedIgUsername: string | null = null;
let cachedIgUsernameAt = 0;

async function getIgUsernameForReport(): Promise<string | null> {
  const now = Date.now();
  if (cachedIgUsername && now - cachedIgUsernameAt < 5 * 60_000) {
    return cachedIgUsername;
  }
  try {
    const { getCurrentIgUsername } = await import('@/shared/instagram');
    const u = await getCurrentIgUsername();
    if (u) {
      cachedIgUsername = u;
      cachedIgUsernameAt = now;
    }
    return u;
  } catch {
    return cachedIgUsername;
  }
}

async function reportSentDm(targetUsername: string, sentAt: number): Promise<void> {
  const fromUsername = await getIgUsernameForReport();
  if (!fromUsername) return;
  await queueDmReport({ fromUsername, targetUsername, sentAt });
}

async function handleDmLimitReached(limit: number | null, used?: number): Promise<void> {
  const cached = await getCachedUsage();
  const usedNum = used ?? cached?.dms.used;
  const limitNum = limit ?? cached?.dms.limit ?? null;
  notify(
    'MonchoOps — DM limit reached',
    usedNum != null && limitNum != null
      ? `You used ${usedNum}/${limitNum} DMs this month. Campaigns paused until next month or upgrade.`
      : 'You reached your monthly DM limit. Campaigns paused until next month or upgrade.'
  );
  const running = await db.campaigns.where('status').equals('running').toArray();
  for (const c of running) {
    await db.campaigns.update(c.id, {
      status: 'paused',
      nextRunAt: Date.now() + 60 * 60_000,
    });
  }
}


