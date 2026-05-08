

import http from 'node:http';
import { metaSetJson } from './db';
import {
  createCategory,
  deleteCategory,
  getCategory,
  ingestLeads,
  listCategories,
  listLeads,
  renameCategory,
} from './leads';
import {
  cancelJob,
  getMassDmResult,
  getScrapeResult,
  listActiveJobs,
  listMassDmResults,
  listMassDmSends,
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
const TOKENS_META_KEY = 'bridge_tokens';

export interface BridgeStatus {
  running: boolean;
  port: number | null;
}

let server: http.Server | null = null;
let listeningPort: number | null = null;

let onMutation: ((channel: string) => void) | null = null;

export function setMutationHandler(cb: (channel: string) => void): void {
  onMutation = cb;
}

function notifyMutation(channel: string): void {
  if (!onMutation) return;
  try {
    onMutation(channel);
  } catch (err) {

    console.warn('[bridge] mutation handler threw', err);
  }
}

export function getStatus(): BridgeStatus {
  return {
    running: !!server,
    port: listeningPort,
  };
}

export async function startBridgeServer(): Promise<void> {
  if (server) return;

  try {
    metaSetJson(TOKENS_META_KEY, []);
  } catch {

  }
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    try {
      await tryListen(port);
      listeningPort = port;

      console.log(`[bridge] listening on http://127.0.0.1:${port}`);
      return;
    } catch (err) {

      if (isAddressInUseError(err)) continue;

      console.warn(`[bridge] could not bind to port ${port}: ${err}`);
    }
  }

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

      s.on('error', (err) => {

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
    s.close(() => resolve());
  });
}

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

    if (req.method === 'GET' && path === '/leads/categories') {
      respondJson(res, 200, listCategories());
      return;
    }

    if (req.method === 'POST' && path === '/leads/categories') {
      void handleCategoryCreate(req, res);
      return;
    }

    const catMatch = path.match(/^\/leads\/categories\/([\w-]+)$/);
    if (catMatch) {
      const id = catMatch[1]!;
      if (req.method === 'GET') {
        handleCategoryLeads(res, id);
        return;
      }
      if (req.method === 'PUT') {
        void handleCategoryRename(req, res, id);
        return;
      }
      if (req.method === 'DELETE') {
        deleteCategory(id);
        notifyMutation('categories:changed');
        respondJson(res, 200, { ok: true });
        return;
      }
    }

    const catLeadsMatch = path.match(/^\/leads\/categories\/([\w-]+)\/leads$/);
    if (req.method === 'POST' && catLeadsMatch) {
      void handleCategoryLeadsAdd(req, res, catLeadsMatch[1]!);
      return;
    }

    if (req.method === 'GET' && path === '/leads/scrapes') {

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

    if (req.method === 'GET' && path === '/dm/results') {
      respondJson(res, 200, listMassDmResults());
      return;
    }

    const dmJobMatch = path.match(/^\/dm\/results\/([\w-]+)$/);
    if (req.method === 'GET' && dmJobMatch) {
      const result = getMassDmResult(dmJobMatch[1]!);
      if (!result) {
        respondJson(res, 404, { error: 'not_found' });
        return;
      }
      respondJson(res, 200, result);
      return;
    }

    const dmSendsMatch = path.match(/^\/dm\/results\/([\w-]+)\/sends$/);
    if (req.method === 'GET' && dmSendsMatch) {
      respondJson(res, 200, listMassDmSends(dmSendsMatch[1]!));
      return;
    }

    if (req.method === 'GET' && path === '/jobs/active') {
      respondJson(res, 200, listActiveJobs());
      return;
    }

    const cancelMatch = path.match(/^\/jobs\/([\w-]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
      try {
        cancelJob(cancelMatch[1]!);
        notifyMutation('jobs:changed');
        respondJson(res, 200, { ok: true });
      } catch (err) {
        respondJson(res, 400, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
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

    console.warn('[bridge] handler error', err);
    respondJson(res, 500, { error: msg });
  }
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

  const rows = listLeads({ categoryId, limit: 5000, offset: 0 });
  respondJson(res, 200, rows);
}

async function handleCategoryCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const parsed = await readJsonBody<{ name?: string }>(req, res);
  if (!parsed) return;
  try {
    const cat = createCategory(String(parsed.name ?? ''));
    notifyMutation('categories:changed');
    respondJson(res, 200, cat);
  } catch (err) {
    respondJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleCategoryLeadsAdd(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  categoryId: string
): Promise<void> {
  const parsed = await readJsonBody<{
    usernames?: string[];
    sourceKind?: string;
    sourceDetail?: string;
  }>(req, res);
  if (!parsed) return;
  if (!getCategory(categoryId)) {
    respondJson(res, 404, { error: 'not_found' });
    return;
  }
  const usernames = Array.isArray(parsed.usernames) ? parsed.usernames : [];
  if (usernames.length === 0) {
    respondJson(res, 400, { error: 'no_usernames' });
    return;
  }
  try {
    const added = ingestLeads(
      categoryId,
      String(parsed.sourceKind ?? 'manual'),
      null,
      usernames.map((u) => ({
        username: u,
        sourceDetail: parsed.sourceDetail ?? 'manual',
      }))
    );
    notifyMutation('categories:changed');
    respondJson(res, 200, { added });
  } catch (err) {
    respondJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleCategoryRename(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string
): Promise<void> {
  const parsed = await readJsonBody<{ name?: string }>(req, res);
  if (!parsed) return;
  if (!getCategory(id)) {
    respondJson(res, 404, { error: 'not_found' });
    return;
  }
  try {
    const cat = renameCategory(id, String(parsed.name ?? ''));
    notifyMutation('categories:changed');
    respondJson(res, 200, cat);
  } catch (err) {
    respondJson(res, 400, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

function applyCors(res: http.ServerResponse, origin?: string): void {

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function isAddressInUseError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'EADDRINUSE';
}

export const BRIDGE_PORT_RANGE = { start: PORT_RANGE_START, end: PORT_RANGE_END };
