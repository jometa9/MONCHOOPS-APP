import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../public/icon.png');
const OUT = resolve(__dirname, '../public/icon.ico');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const src = await readFile(SRC);
const pngs = await Promise.all(
  SIZES.map((size) => sharp(src).resize(size, size, { fit: 'contain' }).png().toBuffer()),
);

const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;
const offsets = [];
let cursor = HEADER_SIZE + ENTRY_SIZE * SIZES.length;
for (const png of pngs) {
  offsets.push(cursor);
  cursor += png.length;
}

const header = Buffer.alloc(HEADER_SIZE);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);

const entries = Buffer.alloc(ENTRY_SIZE * SIZES.length);
SIZES.forEach((size, i) => {
  const o = i * ENTRY_SIZE;
  entries.writeUInt8(size === 256 ? 0 : size, o + 0);
  entries.writeUInt8(size === 256 ? 0 : size, o + 1);
  entries.writeUInt8(0, o + 2);
  entries.writeUInt8(0, o + 3);
  entries.writeUInt16LE(1, o + 4);
  entries.writeUInt16LE(32, o + 6);
  entries.writeUInt32LE(pngs[i].length, o + 8);
  entries.writeUInt32LE(offsets[i], o + 12);
});

const ico = Buffer.concat([header, entries, ...pngs]);
await writeFile(OUT, ico);
console.log(`Wrote ${OUT} (${ico.length} bytes, ${SIZES.length} sizes)`);
