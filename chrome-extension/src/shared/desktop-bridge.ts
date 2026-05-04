// Client for the B2DM desktop app's local HTTP bridge.
//
// Discovery: scans 127.0.0.1:17775..17780 for a /ping that returns
// `{ ok, productName: 'B2DM' }`. The first match wins; we cache the port
// in chrome.storage so subsequent calls skip the scan.
//
// Auth: token-based, stored in chrome.storage.local. First time the
// extension talks to the desktop app, the user goes through pairing —
// extension shows a 4-digit code, desktop shows a confirmation modal
// with the same code, user clicks Allow on the desktop. Token is then
// persisted and used for all future requests.

const PORT_RANGE_START = 17775;
const PORT_RANGE_END = 17780;
const STORAGE_KEY_PORT = 'b2dm_bridge_port';
const STORAGE_KEY_TOKEN = 'b2dm_bridge_token';

export interface DesktopPing {
  ok: boolean;
  productName: string;
  version: string;
}

export interface DesktopCategory {
  id: string;
  name: string;
  leadCount: number;
  scrapeCount: number;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number | null;
}

export interface DesktopScrape {
  jobId: string;
  summary: string;
  usernameCount: number;
  completedAt: number;
  targetName: string | null;
  kind: string;
  accountUsername: string | null;
}

export interface DesktopLead {
  username: string;
  displayName: string;
}

export interface DesktopVariantGroup {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
}

export class BridgeError extends Error {
  constructor(public readonly code: 'no_desktop' | 'unauthorized' | 'request_failed', message: string) {
    super(message);
    this.name = 'BridgeError';
  }
}

async function storageGet<T>(key: string): Promise<T | null> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? null;
}

async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

async function storageRemove(key: string): Promise<void> {
  await chrome.storage.local.remove(key);
}

/** Returns the cached port if reachable, otherwise scans the range. Throws
 *  BridgeError('no_desktop') when no instance answers. */
export async function discoverDesktop(): Promise<{ port: number; ping: DesktopPing }> {
  const cached = await storageGet<number>(STORAGE_KEY_PORT);
  if (cached) {
    const ping = await tryPing(cached);
    if (ping) return { port: cached, ping };
  }
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (port === cached) continue;
    const ping = await tryPing(port);
    if (ping) {
      await storageSet(STORAGE_KEY_PORT, port);
      return { port, ping };
    }
  }
  await storageRemove(STORAGE_KEY_PORT);
  throw new BridgeError(
    'no_desktop',
    'Could not find the MonchoOps desktop app on localhost. Make sure it is running.'
  );
}

async function tryPing(port: number): Promise<DesktopPing | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/ping`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as DesktopPing;
    if (body.productName !== 'B2DM') return null;
    return body;
  } catch {
    return null;
  }
}

export async function getStoredToken(): Promise<string | null> {
  return storageGet<string>(STORAGE_KEY_TOKEN);
}

export async function clearToken(): Promise<void> {
  await storageRemove(STORAGE_KEY_TOKEN);
}

/** Drive the pairing flow. Returns the final token. The `onCode` callback
 *  is invoked once with the 4-digit verification code so the UI can show
 *  it next to the desktop's confirmation modal. */
export async function pairWithDesktop(opts: {
  name: string;
  onCode: (code: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { port } = await discoverDesktop();

  const startRes = await fetch(`http://127.0.0.1:${port}/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: opts.name }),
  });
  if (!startRes.ok) {
    throw new BridgeError('request_failed', `pair start returned ${startRes.status}`);
  }
  const { pairingId, code } = (await startRes.json()) as {
    pairingId: string;
    code: string;
  };
  opts.onCode(code);

  // Poll until accepted/rejected/expired. The desktop modal sits open
  // until the user clicks; default 5 min timeout enforced server-side.
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new BridgeError('request_failed', 'cancelled');
    await sleep(1500);
    const statusRes = await fetch(
      `http://127.0.0.1:${port}/pair/${encodeURIComponent(pairingId)}/status`
    );
    if (statusRes.status === 410) {
      throw new BridgeError('request_failed', 'Pairing expired. Please try again.');
    }
    if (!statusRes.ok) continue;
    const data = (await statusRes.json()) as {
      status: 'pending' | 'accepted' | 'rejected';
      token?: string;
    };
    if (data.status === 'rejected') {
      throw new BridgeError('unauthorized', 'Pairing was rejected.');
    }
    if (data.status === 'accepted' && data.token) {
      await storageSet(STORAGE_KEY_TOKEN, data.token);
      return data.token;
    }
  }
  throw new BridgeError('request_failed', 'Pairing timed out.');
}

async function authedFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  const { port } = await discoverDesktop();
  const token = await getStoredToken();
  if (!token) throw new BridgeError('unauthorized', 'Not paired with the desktop app yet.');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body,
  });
  if (res.status === 401) {
    // Token was revoked from the desktop side. Wipe it so the next call
    // routes through pairing again.
    await clearToken();
    throw new BridgeError('unauthorized', 'The desktop app revoked this extension.');
  }
  return res;
}

export async function listDesktopCategories(): Promise<DesktopCategory[]> {
  const res = await authedFetch('/leads/categories');
  if (!res.ok) throw new BridgeError('request_failed', `categories returned ${res.status}`);
  return (await res.json()) as DesktopCategory[];
}

export async function listCategoryLeads(categoryId: string): Promise<DesktopLead[]> {
  const res = await authedFetch(`/leads/categories/${encodeURIComponent(categoryId)}`);
  if (!res.ok) throw new BridgeError('request_failed', `leads returned ${res.status}`);
  return (await res.json()) as DesktopLead[];
}

export async function listDesktopScrapes(): Promise<DesktopScrape[]> {
  const res = await authedFetch('/leads/scrapes');
  if (!res.ok) throw new BridgeError('request_failed', `scrapes returned ${res.status}`);
  return (await res.json()) as DesktopScrape[];
}

export async function listScrapeLeads(jobId: string): Promise<DesktopLead[]> {
  const res = await authedFetch(`/leads/scrapes/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new BridgeError('request_failed', `scrape leads returned ${res.status}`);
  return (await res.json()) as DesktopLead[];
}

// --- variant groups ------------------------------------------------------
//
// The desktop app is the source of truth for variant groups. The extension
// reads/writes through these wrappers so a group created here shows up in
// the desktop UI without a manual refresh, and vice versa.

export async function listVariantGroups(): Promise<DesktopVariantGroup[]> {
  const res = await authedFetch('/variants');
  if (!res.ok) throw new BridgeError('request_failed', `variants returned ${res.status}`);
  return (await res.json()) as DesktopVariantGroup[];
}

export async function createVariantGroup(payload: {
  name: string;
  variants: string[];
}): Promise<DesktopVariantGroup> {
  const res = await authedFetch('/variants', { method: 'POST', body: payload });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
  return (await res.json()) as DesktopVariantGroup;
}

export async function updateVariantGroup(
  id: string,
  payload: { name: string; variants: string[] }
): Promise<DesktopVariantGroup> {
  const res = await authedFetch(`/variants/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: payload,
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
  return (await res.json()) as DesktopVariantGroup;
}

export async function deleteVariantGroup(id: string): Promise<void> {
  const res = await authedFetch(`/variants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? `request failed: ${res.status}`;
  } catch {
    return `request failed: ${res.status}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
