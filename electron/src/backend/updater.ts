import { app, shell } from 'electron';
import { BUILD_CONFIG } from '../buildConfig';
import { metaGetJson, metaSetJson } from './db';

// The landing returns the current shipping version + per-OS download URLs.
// We compare against `app.getVersion()` and surface a manual-download banner.
// No auto-download, no auto-install.
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'available';
      version: string;
      currentVersion: string;
      downloadUrl: string;
    }
  | { kind: 'not-available' }
  | { kind: 'error'; message: string };

interface AppVersionResponse {
  version: string;
  downloadUrls: { mac?: string; windows?: string };
}

interface VersionCache {
  lastCheckedAt: number;
  version: string;
  downloadUrls: { mac?: string; windows?: string };
}

const VERSION_CACHE_META = 'app_version_cache';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 5_000;
const MANUAL_CHECK_DEBOUNCE_MS = 3_000;
const NOT_AVAILABLE_CLEAR_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

type Broadcaster = (channel: string, payload?: unknown) => void;

let currentStatus: UpdateStatus = { kind: 'idle' };
let broadcaster: Broadcaster | null = null;
let initialized = false;
let lastManualCheck = 0;
let inFlightCheck: Promise<void> | null = null;

function logUpdater(message: string, err?: unknown): void {
  if (err !== undefined) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[updater] ${message}: ${msg}`);
  } else {
    console.log(`[updater] ${message}`);
  }
}

function setStatus(next: UpdateStatus): void {
  currentStatus = next;
  if (broadcaster) broadcaster('updater:state', currentStatus);
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

function getPlatformKey(): 'mac' | 'windows' | null {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return null;
}

// Plain dotted-numeric compare, e.g. "1.10.0" > "1.9.5". Non-numeric segments
// sort lexicographically. Avoids pulling in the `semver` package for a single
// comparison.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? '0';
    const sb = pb[i] ?? '0';
    const na = Number(sa);
    const nb = Number(sb);
    const bothNumeric = !Number.isNaN(na) && !Number.isNaN(nb);
    if (bothNumeric) {
      if (na !== nb) return na < nb ? -1 : 1;
    } else {
      if (sa !== sb) return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

function loadCache(): VersionCache | null {
  return metaGetJson<VersionCache>(VERSION_CACHE_META);
}

function saveCache(cache: VersionCache): void {
  metaSetJson(VERSION_CACHE_META, cache);
}

function applyCacheToStatus(cache: VersionCache): void {
  const platform = getPlatformKey();
  const downloadUrl = platform ? cache.downloadUrls[platform] ?? '' : '';
  const currentVersion = app.getVersion();
  if (compareVersions(cache.version, currentVersion) > 0 && downloadUrl) {
    setStatus({
      kind: 'available',
      version: cache.version,
      currentVersion,
      downloadUrl,
    });
  } else {
    setStatus({ kind: 'not-available' });
    setTimeout(() => {
      if (currentStatus.kind === 'not-available') setStatus({ kind: 'idle' });
    }, NOT_AVAILABLE_CLEAR_MS);
  }
}

async function fetchAppVersion(): Promise<AppVersionResponse> {
  const url = new URL('/api/app-version', BUILD_CONFIG.LICENSE_API_BASE).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': `B2DM/${app.getVersion?.() ?? 'dev'}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Version endpoint returned ${res.status}`);
    }
    const data = (await res.json()) as AppVersionResponse;
    if (!data || typeof data.version !== 'string') {
      throw new Error('Malformed version response');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Refresh the version cache + status. By default, no-op if we already
// checked within the last 24h. Pass `force=true` for the manual settings
// trigger or any time the user explicitly asks for a check.
export async function checkVersionIfStale(force = false): Promise<void> {
  if (inFlightCheck) return inFlightCheck;
  const cache = loadCache();
  const now = Date.now();
  if (!force && cache && now - cache.lastCheckedAt < STALE_THRESHOLD_MS) {
    // Cache still fresh — make sure the banner reflects it.
    if (currentStatus.kind === 'idle') applyCacheToStatus(cache);
    return;
  }

  inFlightCheck = (async () => {
    if (currentStatus.kind === 'idle' || currentStatus.kind === 'not-available') {
      setStatus({ kind: 'checking' });
    }
    try {
      const data = await fetchAppVersion();
      const next: VersionCache = {
        lastCheckedAt: Date.now(),
        version: data.version,
        downloadUrls: {
          mac: data.downloadUrls?.mac,
          windows: data.downloadUrls?.windows,
        },
      };
      saveCache(next);
      applyCacheToStatus(next);
    } catch (err) {
      logUpdater('check failed', err);
      // Fall back to cached state if we have one — otherwise stay silent
      // so a flaky network never paints an error in the user's face.
      const stale = loadCache();
      if (stale) {
        applyCacheToStatus(stale);
      } else {
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    } finally {
      inFlightCheck = null;
    }
  })();

  return inFlightCheck;
}

export function initUpdater(broadcast: Broadcaster): void {
  if (initialized) return;
  initialized = true;
  broadcaster = broadcast;

  // Paint last-known state immediately so the banner doesn't flicker on
  // every cold start while we wait for the network check.
  const cache = loadCache();
  if (cache) applyCacheToStatus(cache);

  setTimeout(() => {
    void checkVersionIfStale();
  }, INITIAL_CHECK_DELAY_MS);
}

export function checkForUpdatesManual(): void {
  const now = Date.now();
  if (now - lastManualCheck < MANUAL_CHECK_DEBOUNCE_MS) return;
  lastManualCheck = now;
  void checkVersionIfStale(true);
}

export function openDownloadPage(): void {
  if (currentStatus.kind !== 'available') return;
  void shell.openExternal(currentStatus.downloadUrl);
}
