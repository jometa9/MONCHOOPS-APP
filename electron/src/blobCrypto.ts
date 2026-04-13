import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export function encryptBuffer(plaintext: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) throw new Error('Invalid key length');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptBuffer(blob: Buffer, keyHex: string): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== KEY_LENGTH) throw new Error('Invalid key length');
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) throw new Error('Blob too short');
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

export function readKeyFromFile(filePath: string): string {
  const key = fs.readFileSync(filePath, 'utf8').trim();
  if (key.length !== 64 || !/^[0-9a-fA-F]+$/.test(key)) {
    throw new Error(`Invalid key file: ${filePath}`);
  }
  return key;
}
