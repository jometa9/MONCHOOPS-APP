// Local HTTP server that lets the B2DM Chrome extension read leads from
// this user's desktop install. Bound to 127.0.0.1 only — never exposed
// over the network. Token-gated: each extension pairs once via an in-app
// confirmation modal, after which it can call the leads endpoints with
// `Authorization: Bearer <token>`.
//
// CORS: allowed origins are chrome-extension:// (any) plus localhost dev.
// Without the token, no payload is ever returned, so a malicious site that
// finds the port still can't read anything.
//
// State:
//   - pending pairings live in memory; cleared after 5 min or on resolve
//   - tokens live in the meta table as `bridge_tokens` (sha256 hashed)
//   - the renderer is notified of new pairing requests via the
//     `onPairRequest` callback wired by main.ts

import http from 'node:http';
import crypto from 'node:crypto';
import { metaGetJson, metaSetJson } from './db';
import {
  exportCategoryCsv,
  listCategories,
  listLeads,
  type LeadCategoryPublic,
} from './leads';
import {
  getScrapeResult,
  listScrapeResults,
  readScrapeUsernames,
} from './jobs';
import {
  createMessageVariantGroup,
  deleteMessageVariantGroup,
  getMessageVariantGroup,
  listMessageVariantGroups,
  updateMessageVariantGroup,
} from './messageVariants';
import { BUILD_CONFIG } from '../buildConfig';

const PORT_RANGE_START = 17775;
const PORT_RANGE_END = 17780;
const PAIRING_TTL_MS = 5 * 60_000;
const PAIRING_CODE_DIGITS = 4;
const TOKENS_META_KEY = 'bridge_tokens';

interface PairedClient {
  /** stable id we hand back to the extension */
  id: string;
  /** sha256 hex of the secret token */
  tokenHash: string;
  /** human-readable label the user sees in Settings */
  name: string;
  createdAt: number;
  lastSeenAt: number;
}

interface PendingPairing {
  pairingId: string;
  code: string;
  name: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected';
  /** populated when status === 'accepted' */
  token?: string;
  /** so the bridge can reject if the renderer never resolves it */
  timer: NodeJS.Timeout;
}

export interface BridgePairRequest {
  pairingId: string;
  code: string;
  name: string;
}

export interface BridgeStatus {
  running: boolean;
  port: number | null;
  pairedCount: number;
}

let server: http.Server | null = null;
let listeningPort: number | null = null;
const pendingPairings = new Map<string, PendingPairing>();

let onPairRequest: ((req: BridgePairRequest) => void) | null = null;
let onMutation: ((channel: string) => void) | null = null;

export function setPairRequestHandler(cb: (req: BridgePairRequest) => void): void {
  onPairRequest = cb;
}

/** Fires when the bridge mutates renderer-visible state (e.g. the extension
 *  creates a variant group). Wire this to your renderer broadcast so the
 *  desktop UI re-renders. */
export function setMutationHandler(cb: (channel: string) => void): void {
  onMutation = cb;
}

function notifyMutation(channel: string): void {
  if (!onMutation) return;
  try {
    onMutation(channel);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[bridge] mutation handler threw', err);
  }
}

export function getStatus(): BridgeStatus {
  return {
    running: !!server,
    port: listeningPort,
    pairedCount: loadTokens().length,
  };
}

export function listPairedClients(): Array<Omit<PairedClient, 'tokenHash'>> {
  return loadTokens().map(({ tokenHash: _hash, ...rest }) => rest);
}

export function revokePairedClient(id: string): void {
  const tokens = loadTokens().filter((t) => t.id !== id);
  metaSetJson(TOKENS_META_KEY, tokens);
}

export function resolvePairing(pairingId: string, accept: boolean): boolean {
  const pending = pendingPairings.get(pairingId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  if (!accept) {
    pending.status = 'rejected';
    // Keep around briefly so the polling extension sees the rejection.
    setTimeout(() => pendingPairings.delete(pairingId), 5_000);
    return true;
  }
  const token = generateToken();
  const id = crypto.randomUUID();
  const now = Date.now();
  const tokens = loadTokens();
  tokens.push({
    id,
    tokenHash: hashToken(token),
    name: pending.name,
    createdAt: now,
    lastSeenAt: now,
  });
  metaSetJson(TOKENS_META_KEY, tokens);
  pending.status = 'accepted';
  pending.token = token;
  setTimeout(() => pendingPairings.delete(pairingId), 30_000);
  return true;
}

// --- server lifecycle ----------------------------------------------------

export async function startBridgeServer(): Promise<void> {
  if (server) return;
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    try {
      await tryListen(port);
      listeningPort = port;
      // eslint-disable-next-line no-console
      console.log(`[bridge] listening on http://127.0.0.1:${port}`);
      return;
    } catch (err) {
      // Port in use — try the next one.
      if (isAddressInUseError(err)) continue;
      // eslint-disable-next-line no-console
      console.warn(`[bridge] could not bind to port ${port}: ${err}`);
    }
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[bridge] could not find a free port in ${PORT_RANGE_START}-${PORT_RANGE_END}; extension bridge disabled`
  );
}

function tryListen(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const s = http.createServer(handleRequest);
    const onError = (err: Error) => {
      s.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      s.removeListener('error', onError);
      server = s;
      // Once listening, replace the temporary error handler with a
      // permanent one that just logs (we don't want unhandled errors
      // to crash the main process).
      s.on('error', (err) => {
        // eslint-disable-next-line no-console
        console.warn('[bridge] server error', err);
      });
      resolve();
    };
    s.once('error', onError);
    s.once('listening', onListening);
    s.listen(port, '127.0.0.1');
  });
}

export function stopBridgeServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    listeningPort = null;
    for (const p of pendingPairings.values()) clearTimeout(p.timer);
    pendingPairings.clear();
    s.close(() => resolve());
  });
}

// --- request handling ----------------------------------------------------

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  applyCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://127.0.0.1${listeningPort ? `:${listeningPort}` : ''}`);
  const path = url.pathname;

  try {
    if (req.method === 'GET' && path === '/ping') {
      respondJson(res, 200, {
        ok: true,
        productName: BUILD_CONFIG.PRODUCT_NAME,
        version: BUILD_CONFIG.APP_VERSION,
      });
      return;
    }

    if (req.method === 'POST' && path === '/pair') {
      void handlePairCreate(req, res);
      return;
    }

    const pairStatusMatch = path.match(/^\/pair\/([\w-]+)\/status$/);
    if (req.method === 'GET' && pairStatusMatch) {
      handlePairStatus(res, pairStatusMatch[1]!);
      return;
    }

    // Everything else needs auth.
    const authedClient = authenticate(req);
    if (!authedClient) {
      respondJson(res, 401, { error: 'unauthorized' });
      return;
    }
    touchClient(authedClient.id);

    if (req.method === 'GET' && path === '/me') {
      respondJson(res, 200, { id: authedClient.id, name: authedClient.name });
      return;
    }

    if (req.method === 'GET' && path === '/leads/categories') {
      respondJson(res, 200, listCategories());
      return;
    }

    const catMatch = path.match(/^\/leads\/categories\/([\w-]+)$/);
    if (req.method === 'GET' && catMatch) {
      handleCategoryLeads(res, catMatch[1]!);
      return;
    }

    if (req.method === 'GET' && path === '/leads/scrapes') {
      // Filter to scrapes that actually have a CSV/usernames available.
      respondJson(
        res,
        200,
        listScrapeResults().filter((s) => s.status === 'completed' && !!s.csvPath)
      );
      return;
    }

    const scrapeMatch = path.match(/^\/leads\/scrapes\/([\w-]+)$/);
    if (req.method === 'GET' && scrapeMatch) {
      handleScrapeUsernames(res, scrapeMatch[1]!);
      return;
    }

    if (req.method === 'GET' && path === '/variants') {
      respondJson(res, 200, listMessageVariantGroups());
      return;
    }

    if (req.method === 'POST' && path === '/variants') {
      void handleVariantCreate(req, res);
      return;
    }

    const variantMatch = path.match(/^\/variants\/([\w-]+)$/);
    if (variantMatch) {
      const id = variantMatch[1]!;
      if (req.method === 'GET') {
        const group = getMessageVariantGroup(id);
        if (!group) {
          respondJson(res, 404, { error: 'not_found' });
          return;
        }
        respondJson(res, 200, group);
        return;
      }
      if (req.method === 'PUT') {
        void handleVariantUpdate(req, res, id);
        return;
      }
      if (req.method === 'DELETE') {
        deleteMessageVariantGroup(id);
        notifyMutation('messageVariants:changed');
        respondJson(res, 200, { ok: true });
        return;
      }
    }

    respondJson(res, 404, { error: 'not_found' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[bridge] handler error', err);
    respondJson(res, 500, { error: msg });
  }
}

function handlePairStatus(res: http.ServerResponse, pairingId: string): void {
  const pending = pendingPairings.get(pairingId);
  if (!pending) {
    respondJson(res, 410, { status: 'expired' });
    return;
  }
  if (pending.status === 'pending') {
    respondJson(res, 200, { status: 'pending' });
    return;
  }
  if (pending.status === 'rejected') {
    respondJson(res, 200, { status: 'rejected' });
    return;
  }
  respondJson(res, 200, { status: 'accepted', token: pending.token });
}

async function handlePairCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const body = await readBody(req);
  let parsed: { name?: string } = {};
  try {
    parsed = body ? (JSON.parse(body) as { name?: string }) : {};
  } catch {
    respondJson(res, 400, { error: 'invalid_json' });
    return;
  }
  const name = (parsed.name ?? '').toString().slice(0, 80) || 'Chrome extension';
  const pairingId = crypto.randomUUID();
  const code = generatePairingCode();
  const timer = setTimeout(() => {
    const p = pendingPairings.get(pairingId);
    if (p && p.status === 'pending') {
      p.status = 'rejected';
      setTimeout(() => pendingPairings.delete(pairingId), 5_000);
    }
  }, PAIRING_TTL_MS);
  const pending: PendingPairing = {
    pairingId,
    code,
    name,
    createdAt: Date.now(),
    status: 'pending',
    timer,
  };
  pendingPairings.set(pairingId, pending);

  if (onPairRequest) {
    try {
      onPairRequest({ pairingId, code, name });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[bridge] pair request handler threw', err);
    }
  }

  respondJson(res, 200, { pairingId, code });
}

async function handleVariantCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsed = await readJsonBody<{ name?: string; variants?: string[] }>(req, res);
  if (!parsed) return;
  try {
    const group = createMessageVariantGroup(
      String(parsed.name ?? ''),
      Array.isArray(parsed.variants) ? parsed.variants : []
    );
    notifyMutation('messageVariants:changed');
    respondJson(res, 200, group);
  } catch (err) {
    respondJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleVariantUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const parsed = await readJsonBody<{ name?: string; variants?: string[] }>(req, res);
  if (!parsed) return;
  try {
    const group = updateMessageVariantGroup(
      id,
      String(parsed.name ?? ''),
      Array.isArray(parsed.variants) ? parsed.variants : []
    );
    notifyMutation('messageVariants:changed');
    respondJson(res, 200, group);
  } catch (err) {
    respondJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function readJsonBody<T>(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<T | null> {
  const body = await readBody(req);
  if (!body) return {} as T;
  try {
    return JSON.parse(body) as T;
  } catch {
    respondJson(res, 400, { error: 'invalid_json' });
    return null;
  }
}

function handleCategoryLeads(res: http.ServerResponse, categoryId: string): void {
  // listLeads streams directly; the bridge consumer doesn't need the rich
  // LeadPublic shape, just a flat username list. We re-shape here so the
  // wire payload is small and the extension doesn't have to know about
  // source_kind / source_detail.
  const rows = listLeads({ categoryId, limit: 5000, offset: 0 });
  respondJson(
    res,
    200,
    rows.map((r) => ({ username: r.username, displayName: r.username }))
  );
}

function handleScrapeUsernames(res: http.ServerResponse, jobId: string): void {
  const result = getScrapeResult(jobId);
  if (!result) {
    respondJson(res, 404, { error: 'not_found' });
    return;
  }
  const usernames = readScrapeUsernames(jobId);
  respondJson(
    res,
    200,
    usernames.map((u) => ({ username: u.username, displayName: u.username }))
  );
}

// --- helpers -------------------------------------------------------------

function applyCors(res: http.ServerResponse, origin?: string): void {
  // Allow chrome-extension://* and localhost dev. We *could* echo any
  // origin since auth is token-based and we bind to 127.0.0.1, but
  // narrowing the allowlist gives one more layer of defence-in-depth.
  let allowed = '';
  if (origin) {
    if (origin.startsWith('chrome-extension://')) allowed = origin;
    else if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      allowed = origin;
    }
  }
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 64 * 1024;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authenticate(req: http.IncomingMessage): PairedClient | null {
  const header = req.headers.authorization ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]!.trim();
  if (!token) return null;
  const hash = hashToken(token);
  const tokens = loadTokens();
  const found = tokens.find((t) => t.tokenHash === hash);
  return found ?? null;
}

function loadTokens(): PairedClient[] {
  const raw = metaGetJson<PairedClient[]>(TOKENS_META_KEY);
  return Array.isArray(raw) ? raw : [];
}

function touchClient(id: string): void {
  const tokens = loadTokens();
  const idx = tokens.findIndex((t) => t.id === id);
  if (idx === -1) return;
  tokens[idx]!.lastSeenAt = Date.now();
  metaSetJson(TOKENS_META_KEY, tokens);
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_DIGITS; i++) {
    code += String(Math.floor(Math.random() * 10));
  }
  return code;
}

function isAddressInUseError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'EADDRINUSE';
}

// Re-export for tests / consumers needing the constant.
export const BRIDGE_PORT_RANGE = { start: PORT_RANGE_START, end: PORT_RANGE_END };
