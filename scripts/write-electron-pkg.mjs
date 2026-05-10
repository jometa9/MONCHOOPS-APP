#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const outDir = path.join(repoRoot, 'electron', 'dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify({ type: 'commonjs', version: rootPkg.version }),
);
