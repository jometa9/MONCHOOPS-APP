import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = resolve(__dirname, '..');
const SVG_PATH = resolve(EXT_ROOT, '..', 'public', 'home-bg.svg');
const OUT_DIR = resolve(EXT_ROOT, 'icons');

const SIZES = [16, 32, 48, 128];
const VARIANTS = [
  { name: 'black', color: '#000000' },
  { name: 'white', color: '#ffffff' },
];

mkdirSync(OUT_DIR, { recursive: true });

const source = readFileSync(SVG_PATH, 'utf8');

for (const variant of VARIANTS) {
  const themed = source.replace(/fill="#[0-9a-fA-F]{6}"/g, `fill="${variant.color}"`);
  for (const size of SIZES) {
    const out = join(OUT_DIR, `icon-${variant.name}-${size}.png`);
    await sharp(Buffer.from(themed), { density: 144, limitInputPixels: false })
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(out);
    console.log(`generated ${out}`);
  }
}
