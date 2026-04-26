// Instagram Direct inbox parsing primitives. Two strategies, with the JSON
// strategy preferred when IG returns it:
//   1. Network interception of /api/v1/direct_v2/inbox/ and per-thread feeds
//      — stable, structured.
//   2. DOM scraping of /direct/inbox/ as fallback — fragile but works when
//      IG ships a UI-only render.
//
// Encapsulates ALL inbox-specific selector/JSON knowledge so the worker
// (../inbox.ts) doesn't have to care about which path produced the data.

import { safeGoto, sendLog, waitFor } from '../lib';

type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ParsedThreadDelta {
  igThreadId: string;
  peerUsername: string;
  peerDisplayName: string | null;
  peerPicUrl: string | null;
  isGroup: boolean;
  lastMessageAt: number | null;
  lastMessagePreview: string | null;
  lastMessageFromMe: boolean;
  unreadCount: number;
}

export interface ParsedMessageDelta {
  igMessageId: string | null;
  direction: 'in' | 'out';
  senderUsername: string;
  body: string | null;
  mediaKind: string | null;
  mediaCaption: string | null;
  sentAt: number;
}

const INBOX_URL = 'https://www.instagram.com/direct/inbox/';

export interface FetchInboxOpts {
  /** Cap on how many threads to return (top of the list). */
  maxThreads?: number;
}

export async function fetchInboxThreads(
  page: Page,
  opts: FetchInboxOpts = {}
): Promise<ParsedThreadDelta[]> {
  const maxThreads = Math.max(1, Math.min(500, opts.maxThreads ?? 50));

  const captured: any[] = [];
  const responseHandler = async (resp: any) => {
    try {
      const url = resp.url() as string;
      if (!url.includes('/api/v1/direct_v2/inbox/') && !url.includes('/api/graphql')) return;
      // Some endpoints are not JSON; guard.
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const json = await resp.json().catch(() => null);
      if (!json) return;
      captured.push(json);
    } catch {}
  };
  page.on('response', responseHandler);

  try {
    await safeGoto(page, INBOX_URL);
    // Wait a beat so the inbox feed JSON has time to land.
    await waitFor(2500);
    // Lightweight scroll to nudge IG into requesting more threads.
    try {
      await page
        .locator('div[role="list"], div[aria-label="Chats"]')
        .first()
        .evaluate((el: HTMLElement) => {
          el.scrollTop = el.scrollHeight;
        })
        .catch(() => undefined);
    } catch {}
    await waitFor(1500);
  } finally {
    page.off?.('response', responseHandler);
  }

  const fromJson = collectThreadsFromJson(captured);
  if (fromJson.length > 0) {
    return fromJson.slice(0, maxThreads);
  }
  // Expected path: IG's web client renders DMs via Bloks + WebSocket so the
  // mobile JSON endpoints we'd love to intercept are never called. The DOM
  // scrape is doing the real work here — log at info, not warn.
  sendLog('info', '[inbox] using DOM scrape (web client does not expose JSON)');
  return (await scrapeThreadsFromDom(page)).slice(0, maxThreads);
}

function collectThreadsFromJson(payloads: any[]): ParsedThreadDelta[] {
  const out = new Map<string, ParsedThreadDelta>();
  for (const p of payloads) {
    // IG's classic web inbox payload shape: { inbox: { threads: [...] } }
    const threads: any[] = p?.inbox?.threads ?? [];
    for (const t of threads) {
      const id = String(t.thread_id ?? t.threadId ?? '').trim();
      if (!id) continue;
      const lastItem = Array.isArray(t.items) && t.items.length > 0 ? t.items[0] : null;
      const users: any[] = Array.isArray(t.users) ? t.users : [];
      const peer = users[0] ?? {};
      const lastTs = lastItem?.timestamp
        ? Math.floor(Number(lastItem.timestamp) / 1000)
        : null;
      const lastFromMe = lastItem
        ? String(lastItem.user_id ?? '') === String(t.viewer_id ?? '')
        : false;
      out.set(id, {
        igThreadId: id,
        peerUsername: peer?.username ?? users.map((u) => u.username).filter(Boolean).join(', ') ?? '',
        peerDisplayName: peer?.full_name ?? null,
        peerPicUrl: peer?.profile_pic_url ?? null,
        isGroup: users.length > 1,
        lastMessageAt: lastTs,
        lastMessagePreview: extractItemPreview(lastItem),
        lastMessageFromMe: lastFromMe,
        unreadCount: Number(t.read_state ?? 0) > 0 ? 1 : 0,
      });
    }
  }
  return Array.from(out.values()).sort(
    (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)
  );
}

function extractItemPreview(item: any): string | null {
  if (!item) return null;
  if (typeof item.text === 'string' && item.text.trim()) return item.text.trim().slice(0, 200);
  const t = item.item_type ?? item.type;
  if (t === 'media' || t === 'media_share') return '[media]';
  if (t === 'voice_media') return '[voice]';
  if (t === 'reel_share' || t === 'clip') return '[reel]';
  if (t === 'story_share') return '[story reply]';
  return '[unsupported]';
}

// Pulls structured thread data straight out of the rendered DOM. One
// evaluate() round-trip so we don't pay the IPC cost per anchor.
//
// IG web inbox row anatomy (as of 2026-04):
//   <a href="/direct/t/{id}/">
//     <img src="..." />                      ← peer pic
//     <span>peer.username</span>             ← bold display
//     <span class="…">last preview · 3h</span>   ← preview + timestamp combined
//     <div aria-label="Unread"></div>        ← only when unread
//
// The exact tag/class shape rotates between IG releases; the structure
// below is intentionally selector-loose (text walking, not class matching).
async function scrapeThreadsFromDom(page: Page): Promise<ParsedThreadDelta[]> {
  try {
    await page
      .waitForSelector('a[href*="/direct/t/"]', { timeout: 12_000 })
      .catch(() => undefined);
  } catch {
    return [];
  }

  const raw = await page
    .evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
      const isTimeLike = (t: string): boolean =>
        /^\d+\s*[smhdw]$/i.test(t) ||
        /^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(t) ||
        /^yesterday$/i.test(t) ||
        /^[A-Z][a-z]{2,8}\s+\d{1,2}(,\s*\d{4})?$/.test(t);

      return anchors
        .map((a) => {
          const href = a.getAttribute('href') ?? '';
          const m = /\/direct\/t\/([^/]+)\//.exec(href);
          if (!m) return null;
          const igThreadId = m[1]!;

          const img = a.querySelector('img') as HTMLImageElement | null;
          const peerPicUrl = img?.src ?? null;
          const peerDisplayName = img?.getAttribute('alt') ?? null;

          // Walk every span/div text inside the anchor, dedup, and split
          // into (username, time, preview) by heuristic. IG sometimes
          // renders username + handle in two separate spans — we take the
          // shortest non-time text as username if multiple candidates exist.
          const texts: string[] = [];
          const elList = Array.from(a.querySelectorAll<HTMLElement>('span, div'));
          for (const el of elList) {
            const t = (el.textContent ?? '').trim();
            if (!t) continue;
            // Skip nodes that contain other text-bearing nodes (we only
            // want leaf text, otherwise we'd grab the same content N times).
            const childList = Array.from(el.children) as Element[];
            const hasChildText = childList.some(
              (c) => (c.textContent ?? '').trim().length > 0
            );
            if (hasChildText) continue;
            if (texts.includes(t)) continue;
            texts.push(t);
          }

          let username: string | null = null;
          let lastTimeText: string | null = null;
          const previewParts: string[] = [];
          for (const t of texts) {
            if (isTimeLike(t) && !lastTimeText) {
              lastTimeText = t;
              continue;
            }
            if (!username) {
              username = t;
              continue;
            }
            previewParts.push(t);
          }

          // "You: foo" indicates the last message is outbound.
          const lastMessageFromMe = previewParts.some((t) => /^you:/i.test(t.trim()));
          const preview = previewParts.length > 0 ? previewParts.join(' · ') : null;

          // Unread cue: the row carries an aria-label on a child div, or a
          // small dot rendered as an SVG. Best-effort detection.
          const isUnread =
            a.querySelector('[aria-label*="Unread" i]') !== null ||
            a.querySelector('div[role="presentation"] svg[aria-label*="circle" i]') !== null;

          return {
            igThreadId,
            peerUsername: username ?? '',
            peerDisplayName,
            peerPicUrl,
            lastMessageRel: lastTimeText,
            lastMessagePreview: preview,
            lastMessageFromMe,
            unreadCount: isUnread ? 1 : 0,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    })
    .catch(() => [] as Array<{
      igThreadId: string;
      peerUsername: string;
      peerDisplayName: string | null;
      peerPicUrl: string | null;
      lastMessageRel: string | null;
      lastMessagePreview: string | null;
      lastMessageFromMe: boolean;
      unreadCount: number;
    }>);

  const now = Date.now();
  const seen = new Set<string>();
  const out: ParsedThreadDelta[] = [];
  for (const r of raw) {
    if (!r.igThreadId || seen.has(r.igThreadId)) continue;
    seen.add(r.igThreadId);
    out.push({
      igThreadId: r.igThreadId,
      peerUsername: (r.peerUsername || '').trim(),
      peerDisplayName: r.peerDisplayName,
      peerPicUrl: r.peerPicUrl,
      isGroup: false,
      lastMessageAt: parseRelativeTime(r.lastMessageRel, now),
      lastMessagePreview: r.lastMessagePreview,
      lastMessageFromMe: r.lastMessageFromMe,
      unreadCount: r.unreadCount,
    });
  }
  return out;
}

function parseRelativeTime(rel: string | null, now: number): number | null {
  if (!rel) return null;
  const compact = rel.trim().toLowerCase();
  const m = /^(\d+)\s*([smhdw])$/.exec(compact);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!;
    const ms =
      unit === 's'
        ? n * 1000
        : unit === 'm'
        ? n * 60_000
        : unit === 'h'
        ? n * 3_600_000
        : unit === 'd'
        ? n * 86_400_000
        : n * 7 * 86_400_000;
    return now - ms;
  }
  if (compact === 'yesterday') return now - 86_400_000;
  // "Mar 12" / "Mar 12, 2025" — best-effort.
  const dateMatch = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(rel.trim());
  if (dateMatch) {
    const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : new Date(now).getFullYear();
    const parsed = Date.parse(`${dateMatch[1]} ${dateMatch[2]}, ${year}`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export interface FetchThreadMessagesOpts {
  igThreadId: string;
  /** Max messages to return. Newest first in the response array. */
  maxMessages?: number;
}

export async function fetchThreadMessages(
  page: Page,
  opts: FetchThreadMessagesOpts
): Promise<{ peerUsername: string | null; messages: ParsedMessageDelta[] }> {
  const captured: any[] = [];
  const responseHandler = async (resp: any) => {
    try {
      const url = resp.url() as string;
      if (!url.includes(`/direct_v2/threads/${opts.igThreadId}/`)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const json = await resp.json().catch(() => null);
      if (!json) return;
      captured.push(json);
    } catch {}
  };
  page.on('response', responseHandler);

  try {
    await safeGoto(page, `https://www.instagram.com/direct/t/${opts.igThreadId}/`);
    await waitFor(2500);
    // Scroll the message scroller up a few times to coax older messages.
    const passes = Math.min(10, Math.max(1, Math.floor((opts.maxMessages ?? 30) / 20)));
    for (let i = 0; i < passes; i++) {
      try {
        await page
          .locator('main div[role="presentation"], div[role="grid"]')
          .first()
          .evaluate((el: HTMLElement) => {
            el.scrollTop = 0;
          })
          .catch(() => undefined);
      } catch {}
      await waitFor(800);
    }
  } finally {
    page.off?.('response', responseHandler);
  }

  let messages = collectMessagesFromJson(captured);
  let peer: string | null = captured
    .flatMap((p: any) => (p?.thread?.users as any[]) ?? [])
    .find((u: any) => u && u.username)?.username ?? null;

  // Web client doesn't expose `/direct_v2/threads/...` JSON, so the JSON
  // path is usually empty. Fall back to scraping rendered messages from
  // the DOM.
  if (messages.length === 0) {
    const scraped = await scrapeMessagesFromDom(page);
    messages = scraped.messages;
    if (!peer) peer = scraped.peerUsername;
  }

  const cap = Math.max(1, Math.min(500, opts.maxMessages ?? 100));
  return {
    peerUsername: peer,
    messages: messages.slice(0, cap),
  };
}

// Walks the rendered conversation pane and pulls each visible message
// bubble. Only text messages are reliably extractable; everything else
// gets a media_kind placeholder. Newest-first to match the JSON path.
async function scrapeMessagesFromDom(page: Page): Promise<{
  peerUsername: string | null;
  messages: ParsedMessageDelta[];
}> {
  // Wait for at least one bubble to render.
  await page
    .waitForSelector('[data-scope="messages_table"], div[role="row"], main div[role="grid"]', {
      timeout: 10_000,
    })
    .catch(() => undefined);

  const result = await page
    .evaluate(() => {
      // IG renders each message as a row. We try several plausible
      // containers in order of specificity.
      const rowCandidates: Element[] = [];
      const seenRows = new Set<Element>();
      const pushRows = (sel: string) => {
        const found = Array.from(document.querySelectorAll<HTMLElement>(sel));
        for (const el of found) {
          if (seenRows.has(el)) continue;
          seenRows.add(el);
          rowCandidates.push(el);
        }
      };
      pushRows('[data-scope="messages_table"] [role="row"]');
      pushRows('main div[role="grid"] [role="row"]');
      pushRows('main div[role="row"]');

      // Fallback: each text bubble lives in a div with this kind of role
      // when the row container isn't present.
      if (rowCandidates.length === 0) {
        pushRows('main div[dir="auto"]');
      }

      // Best-effort peer username from the conversation header.
      const headerLink =
        (document.querySelector('header a[href*="/"]') as HTMLAnchorElement | null) ??
        (document.querySelector('section header a[href*="/"]') as HTMLAnchorElement | null);
      const headerHref = headerLink?.getAttribute('href') ?? '';
      const peerMatch = /^\/([^/?#]+)\/?$/.exec(headerHref);
      const peerUsername = peerMatch ? peerMatch[1]! : null;

      const out: Array<{
        body: string | null;
        direction: 'in' | 'out';
        sentAt: number;
        rawTime: string | null;
        mediaKind: string | null;
        mediaCaption: string | null;
      }> = [];

      const now = Date.now();

      for (const row of rowCandidates) {
        // Skip empty/structural rows.
        const text = (row.textContent ?? '').trim();
        if (!text) continue;

        // Direction heuristic: outbound bubbles are right-aligned via
        // `justify-content: flex-end` or `text-align: right`; inbound is
        // left-aligned. Also IG sometimes labels them via aria-roledescription.
        const computed = window.getComputedStyle(row);
        const justify = computed.justifyContent;
        const isOutBubble =
          justify === 'flex-end' ||
          row.querySelector('[style*="flex-end"]') !== null ||
          row.getAttribute('data-from-me') === 'true';

        const direction: 'in' | 'out' = isOutBubble ? 'out' : 'in';

        // The body is the inner text minus any trailing time tooltip.
        // Time often lives in a separate <time> element.
        const timeEl = row.querySelector('time');
        const rawTime = timeEl?.getAttribute('datetime') ?? timeEl?.textContent ?? null;
        let body: string | null = text;
        if (timeEl && timeEl.textContent) {
          body = body.replace(timeEl.textContent.trim(), '').trim();
        }
        if (!body) body = null;

        // Media detection: <img> / <video> / aria labels
        let mediaKind: string | null = null;
        let mediaCaption: string | null = null;
        if (row.querySelector('video, audio')) {
          mediaKind = row.querySelector('audio') ? 'voice' : 'video';
        } else if (row.querySelector('img:not([alt*="profile" i])')) {
          mediaKind = 'image';
        }
        if (mediaKind) {
          mediaCaption = body;
          body = null;
        }

        // Resolve sentAt — prefer ISO datetime when present, else fall
        // back to the row order (we'll fix monotonic order downstream).
        let sentAt = now - rowCandidates.indexOf(row) * 1000;
        if (rawTime) {
          const iso = Date.parse(rawTime);
          if (Number.isFinite(iso)) sentAt = iso;
        }

        out.push({ body, direction, sentAt, rawTime, mediaKind, mediaCaption });
      }
      return { peerUsername, items: out };
    })
    .catch(() => ({ peerUsername: null, items: [] as Array<{
      body: string | null;
      direction: 'in' | 'out';
      sentAt: number;
      rawTime: string | null;
      mediaKind: string | null;
      mediaCaption: string | null;
    }> }));

  type ScrapedItem = {
    body: string | null;
    direction: 'in' | 'out';
    sentAt: number;
    rawTime: string | null;
    mediaKind: string | null;
    mediaCaption: string | null;
  };
  const messages: ParsedMessageDelta[] = (result.items as ScrapedItem[]).map((it) => ({
    igMessageId: null,
    direction: it.direction,
    senderUsername: it.direction === 'out' ? 'me' : result.peerUsername ?? 'them',
    body: it.body,
    mediaKind: it.mediaKind,
    mediaCaption: it.mediaCaption,
    sentAt: it.sentAt,
  }));
  // Newest-first.
  messages.sort((a, b) => b.sentAt - a.sentAt);
  return { peerUsername: result.peerUsername, messages };
}

function collectMessagesFromJson(payloads: any[]): ParsedMessageDelta[] {
  const out = new Map<string, ParsedMessageDelta>();
  for (const p of payloads) {
    const items: any[] = p?.thread?.items ?? p?.items ?? [];
    const viewerId = String(p?.thread?.viewer_id ?? '');
    for (const item of items) {
      const id = String(item.item_id ?? item.client_context ?? '').trim() || null;
      const sentAt = item?.timestamp
        ? Math.floor(Number(item.timestamp) / 1000)
        : Date.now();
      const senderId = String(item.user_id ?? '');
      const direction: 'in' | 'out' = senderId === viewerId ? 'out' : 'in';
      const senderUsername = String(item.user?.username ?? '') || (direction === 'out' ? 'me' : 'them');
      let body: string | null = null;
      let mediaKind: string | null = null;
      let mediaCaption: string | null = null;
      const t = item.item_type ?? item.type;
      if (t === 'text' && typeof item.text === 'string') {
        body = item.text;
      } else if (t === 'media' || t === 'media_share') {
        mediaKind = 'image';
        mediaCaption = item.media?.caption?.text ?? null;
      } else if (t === 'voice_media') {
        mediaKind = 'voice';
      } else if (t === 'reel_share' || t === 'clip') {
        mediaKind = 'reel';
        mediaCaption = item.reel_share?.text ?? null;
      } else if (t === 'story_share') {
        mediaKind = 'story_reply';
      } else {
        mediaKind = 'unsupported';
      }
      const key = id ?? `${sentAt}:${direction}:${(body ?? mediaKind ?? '').slice(0, 20)}`;
      out.set(key, {
        igMessageId: id,
        direction,
        senderUsername,
        body,
        mediaKind,
        mediaCaption,
        sentAt,
      });
    }
  }
  // Newest first.
  return Array.from(out.values()).sort((a, b) => b.sentAt - a.sentAt);
}

export interface SendMessageResult {
  igMessageId: string | null;
  sentAt: number;
}

export async function sendThreadMessage(
  page: Page,
  igThreadId: string,
  text: string
): Promise<SendMessageResult> {
  await safeGoto(page, `https://www.instagram.com/direct/t/${igThreadId}/`);
  await waitFor(2500);
  // Composer is a contenteditable in IG's web UI.
  const composer = page
    .locator('div[contenteditable="true"][role="textbox"]')
    .first();
  try {
    await composer.click({ timeout: 10_000 });
  } catch (err) {
    throw new Error(
      `Could not find DM composer for thread ${igThreadId}. IG layout may have changed.`
    );
  }
  // Type with realistic per-char delay (50-120 ms with jitter).
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 50 + Math.random() * 70 });
  }
  await waitFor(400 + Math.random() * 600);
  // Try the explicit Send button first; fall back to Enter.
  const sendBtn = page
    .locator('div[role="button"]', { hasText: /^Send$/i })
    .first();
  let pressed = false;
  try {
    if (await sendBtn.count()) {
      await sendBtn.click({ timeout: 5000 });
      pressed = true;
    }
  } catch {}
  if (!pressed) {
    await page.keyboard.press('Enter');
  }
  await waitFor(1500);
  return { igMessageId: null, sentAt: Date.now() };
}
