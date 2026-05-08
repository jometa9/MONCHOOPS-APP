

const PORT_RANGE_START = 17775;
const PORT_RANGE_END = 17780;
const STORAGE_KEY_PORT = 'b2dm_bridge_port';
const LEGACY_STORAGE_KEY_TOKEN = 'b2dm_bridge_token';

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

export interface DesktopCategoryLead {
  id: number;
  categoryId: string;
  username: string;
  sourceKind: string;
  sourceJobId: string | null;
  sourceDetail: string | null;
  scrapedAt: number;
}

export interface DesktopVariantGroup {
  id: string;
  name: string;
  variants: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DesktopDmResult {
  jobId: string;
  accountId: string | null;
  accountUsername: string | null;
  accountProfilePicUrl: string | null;
  sentCount: number;
  failedCount: number;
  totalCount: number;
  durationMs: number;
  completedAt: number;
}

export interface DesktopDmSend {
  jobId: string;
  accountId: string | null;
  username: string;
  status: 'sent' | 'failed';
  message: string | null;
  error: string | null;
  sentAt: number;
}

export interface DesktopJob {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  accountId: string | null;
  startedAt: number;
  runningAt: number | null;
  finishedAt: number | null;
  progressDone: number;
  progressTotal: number | null;
  error: string | null;
  params: Record<string, unknown> | null;
}

export class BridgeError extends Error {
  constructor(public readonly code: 'no_desktop' | 'request_failed', message: string) {
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

export async function discoverDesktop(): Promise<{ port: number; ping: DesktopPing }> {

  await storageRemove(LEGACY_STORAGE_KEY_TOKEN);

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
    'Could not connect. Start the MonchoOps desktop app and try again.'
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

async function bridgeFetch(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  const { port } = await discoverDesktop();
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body,
  });
}

export async function listDesktopCategories(): Promise<DesktopCategory[]> {
  const res = await bridgeFetch('/leads/categories');
  if (!res.ok) throw new BridgeError('request_failed', `categories returned ${res.status}`);
  return (await res.json()) as DesktopCategory[];
}

export async function listCategoryLeads(categoryId: string): Promise<DesktopLead[]> {
  const rows = await listCategoryLeadsFull(categoryId);
  return rows.map((r) => ({ username: r.username, displayName: r.username }));
}

export async function listCategoryLeadsFull(
  categoryId: string
): Promise<DesktopCategoryLead[]> {
  const res = await bridgeFetch(`/leads/categories/${encodeURIComponent(categoryId)}`);
  if (!res.ok) throw new BridgeError('request_failed', `leads returned ${res.status}`);
  return (await res.json()) as DesktopCategoryLead[];
}

export async function createDesktopCategory(name: string): Promise<DesktopCategory> {
  const res = await bridgeFetch('/leads/categories', {
    method: 'POST',
    body: { name },
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
  return (await res.json()) as DesktopCategory;
}

export async function renameDesktopCategory(
  id: string,
  name: string
): Promise<DesktopCategory> {
  const res = await bridgeFetch(`/leads/categories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: { name },
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
  return (await res.json()) as DesktopCategory;
}

export async function deleteDesktopCategory(id: string): Promise<void> {
  const res = await bridgeFetch(`/leads/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
}

export async function listDesktopDmResults(): Promise<DesktopDmResult[]> {
  const res = await bridgeFetch('/dm/results');
  if (!res.ok) throw new BridgeError('request_failed', `dm results returned ${res.status}`);
  return (await res.json()) as DesktopDmResult[];
}

export async function listDesktopDmSends(jobId: string): Promise<DesktopDmSend[]> {
  const res = await bridgeFetch(`/dm/results/${encodeURIComponent(jobId)}/sends`);
  if (!res.ok) throw new BridgeError('request_failed', `dm sends returned ${res.status}`);
  return (await res.json()) as DesktopDmSend[];
}

export async function listDesktopActiveJobs(): Promise<DesktopJob[]> {
  const res = await bridgeFetch('/jobs/active');
  if (!res.ok) throw new BridgeError('request_failed', `jobs returned ${res.status}`);
  return (await res.json()) as DesktopJob[];
}

export async function cancelDesktopJob(jobId: string): Promise<void> {
  const res = await bridgeFetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
}

export async function pushLeadsToDesktopCategory(
  categoryId: string,
  usernames: string[],
  sourceDetail = 'extension'
): Promise<{ added: number }> {
  const res = await bridgeFetch(
    `/leads/categories/${encodeURIComponent(categoryId)}/leads`,
    {
      method: 'POST',
      body: { usernames, sourceKind: 'manual', sourceDetail },
    }
  );
  if (!res.ok) {
    const msg = await readErrorMessage(res);
    throw new BridgeError('request_failed', msg);
  }
  return (await res.json()) as { added: number };
}

export async function isDesktopReachable(): Promise<boolean> {
  try {
    await discoverDesktop();
    return true;
  } catch {
    return false;
  }
}

export async function listDesktopScrapes(): Promise<DesktopScrape[]> {
  const res = await bridgeFetch('/leads/scrapes');
  if (!res.ok) throw new BridgeError('request_failed', `scrapes returned ${res.status}`);
  return (await res.json()) as DesktopScrape[];
}

export async function listScrapeLeads(jobId: string): Promise<DesktopLead[]> {
  const res = await bridgeFetch(`/leads/scrapes/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new BridgeError('request_failed', `scrape leads returned ${res.status}`);
  return (await res.json()) as DesktopLead[];
}

export async function listVariantGroups(): Promise<DesktopVariantGroup[]> {
  const res = await bridgeFetch('/variants');
  if (!res.ok) throw new BridgeError('request_failed', `variants returned ${res.status}`);
  return (await res.json()) as DesktopVariantGroup[];
}

export async function createVariantGroup(payload: {
  name: string;
  variants: string[];
}): Promise<DesktopVariantGroup> {
  const res = await bridgeFetch('/variants', { method: 'POST', body: payload });
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
  const res = await bridgeFetch(`/variants/${encodeURIComponent(id)}`, {
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
  const res = await bridgeFetch(`/variants/${encodeURIComponent(id)}`, {
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
