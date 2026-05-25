import { app, shell } from 'electron';
import { metaGetJson, metaSetJson } from './db';

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

interface VersionCache {
  lastCheckedAt: number;
  version: string;
  downloadUrls: { mac?: string; windows?: string };
}

const VERSION_CACHE_META = 'app_version_cache';
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 5_000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANUAL_CHECK_DEBOUNCE_MS = 3_000;
const NOT_AVAILABLE_CLEAR_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

const GITHUB_RELEASES_LATEST =
  'https://api.github.com/repos/jometa9/B2DM/releases/latest';

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

let currentExtensionUrl: string = '';

function setExtensionUrl(next: string): void {
  const value = (next ?? '').trim();
  if (value === currentExtensionUrl) return;
  currentExtensionUrl = value;
  if (broadcaster) broadcaster('updater:extensionUrl', currentExtensionUrl);
}

export function getExtensionUrl(): string {
  return currentExtensionUrl;
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

function getPlatformKey(): 'mac' | 'windows' | null {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'win32') return 'windows';
  return null;
}

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

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubReleaseResponse {
  tag_name: string;
  name?: string;
  assets?: GithubAsset[];
}

function pickAssetUrl(assets: GithubAsset[], match: (name: string) => boolean): string | undefined {
  const found = assets.find((a) => match(a.name.toLowerCase()));
  return found?.browser_download_url;
}

async function fetchLatestRelease(): Promise<VersionCache> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GITHUB_RELEASES_LATEST, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `MonchoOps/${app.getVersion?.() ?? 'dev'}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GitHub releases returned ${res.status}`);
    const data = (await res.json()) as GithubReleaseResponse;
    const tag = (data.tag_name ?? '').replace(/^v/, '');
    if (!tag) throw new Error('Malformed release response');
    const assets = data.assets ?? [];
    const macUrl = pickAssetUrl(
      assets,
      (n) => n.endsWith('.dmg') || n.endsWith('-mac.zip')
    );
    const winUrl = pickAssetUrl(assets, (n) => n.endsWith('.exe'));
    return {
      lastCheckedAt: Date.now(),
      version: tag,
      downloadUrls: { mac: macUrl, windows: winUrl },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkVersionIfStale(force = false): Promise<void> {
  if (inFlightCheck) return inFlightCheck;
  const cache = loadCache();
  const now = Date.now();
  if (!force && cache && now - cache.lastCheckedAt < STALE_THRESHOLD_MS) {
    if (currentStatus.kind === 'idle') applyCacheToStatus(cache);
    return;
  }

  inFlightCheck = (async () => {
    if (currentStatus.kind === 'idle' || currentStatus.kind === 'not-available') {
      setStatus({ kind: 'checking' });
    }
    try {
      const next = await fetchLatestRelease();
      saveCache(next);
      applyCacheToStatus(next);
    } catch (err) {
      logUpdater('check failed', err);
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

  const cache = loadCache();
  if (cache) applyCacheToStatus(cache);

  setTimeout(() => {
    void checkVersionIfStale(true);
  }, INITIAL_CHECK_DELAY_MS);

  setInterval(() => {
    void checkVersionIfStale(true);
  }, PERIODIC_CHECK_INTERVAL_MS);
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
