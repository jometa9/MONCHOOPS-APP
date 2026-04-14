import { app, safeStorage } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const KEY_FILE = '.b2dm-key';

let cachedKey: Buffer | null = null;

function keyPath(): string {
  return path.join(app.getPath('userData'), KEY_FILE);
}

// Returns a 32-byte key. Prefers an OS-keychain-backed key via safeStorage;
// falls back to a file in userData/ (0600) if the keychain isn't available
// (e.g. first run on a headless Linux box).
export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const p = keyPath();
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p);
      const decoded = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf8');
      const buf = Buffer.from(decoded, 'hex');
      if (buf.length === KEY_LENGTH) {
        cachedKey = buf;
        return cachedKey;
      }
    }
  } catch {
    // Fall through and regenerate.
  }
  const fresh = crypto.randomBytes(KEY_LENGTH);
  const asHex = fresh.toString('hex');
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(asHex)
    : Buffer.from(asHex, 'utf8');
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, payload);
    if (process.platform !== 'win32') {
      try { fs.chmodSync(p, 0o600); } catch {}
    }
  } catch (err) {
    console.warn('[crypto] could not persist key file:', err);
  }
  cachedKey = fresh;
  return cachedKey;
}

export function encryptString(plaintext: string): Buffer {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptString(blob: Buffer): string {
  const key = getEncryptionKey();
  if (blob.length < IV_LENGTH + TAG_LENGTH) throw new Error('ciphertext too short');
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function encryptJson(value: unknown): Buffer {
  return encryptString(JSON.stringify(value));
}

export function decryptJson<T>(blob: Buffer): T {
  return JSON.parse(decryptString(blob)) as T;
}
