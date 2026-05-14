import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const extDir = resolve(rootDir, 'chrome-extension');
const distDir = resolve(extDir, 'dist');
const releaseDir = resolve(rootDir, 'release');

const pkg = JSON.parse(readFileSync(resolve(extDir, 'package.json'), 'utf8'));
const zipName = `MonchoOps-Extension-${pkg.version}.zip`;
const zipPath = resolve(releaseDir, zipName);

console.log(`> Building chrome-extension v${pkg.version}`);
if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
execSync('npm run build', { cwd: extDir, stdio: 'inherit' });

if (!existsSync(distDir)) {
  console.error('Build failed: dist directory not created');
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
if (existsSync(zipPath)) rmSync(zipPath, { force: true });

console.log(`> Zipping dist/ -> release/${zipName}`);
execSync(`zip -r "${zipPath}" .`, { cwd: distDir, stdio: 'inherit' });

console.log(`\n✓ Extension package ready: release/${zipName}`);
