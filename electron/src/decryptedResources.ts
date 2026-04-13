import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { decryptBuffer, readKeyFromFile } from './blobCrypto';

let decryptedRoot: string | null = null;

function getKeyPath(): string {
  return path.join(__dirname, 'decrypt-key.txt');
}

function getResourcesPath(): string {
  return process.resourcesPath;
}

function getDataEncPath(): string {
  return path.join(getResourcesPath(), 'data.enc');
}

function getExtractDir(): string {
  return path.join(app.getPath('userData'), 'decrypted');
}

export function ensureDecryptedResources(): string | null {
  if (decryptedRoot != null) return decryptedRoot;
  if (!app.isPackaged) return null;
  const encPath = getDataEncPath();
  if (!fs.existsSync(encPath)) return null;
  const keyPath = getKeyPath();
  if (!fs.existsSync(keyPath)) {
    console.warn('[decryptedResources] decrypt-key.txt not found');
    return null;
  }
  try {
    const key = readKeyFromFile(keyPath);
    const blob = fs.readFileSync(encPath);
    const zipBuffer = decryptBuffer(blob, key);
    const extractDir = getExtractDir();
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(extractDir, true);
    decryptedRoot = extractDir;
    return decryptedRoot;
  } catch (err) {
    console.error('[decryptedResources] Decrypt/extract failed:', err);
    return null;
  }
}

export function getDecryptedResourcesPath(): string | null {
  return decryptedRoot;
}
