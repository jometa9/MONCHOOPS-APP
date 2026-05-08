#!/usr/bin/env node
// Obfuscates the compiled electron output (electron/dist/**/*.js) in place.
// Conservative config: no stringArray / no controlFlowFlattening, because
// workers serialize arrow functions via Playwright's page.evaluate(fn) — those
// run in the browser context and would break if they referenced an outer
// helper added by the obfuscator.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const targetDir = path.join(repoRoot, 'electron', 'dist');

const obfuscatorOptions = {
  compact: true,
  simplify: true,
  target: 'node',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  transformObjectKeys: false,
  stringArray: false,
  splitStrings: true,
  splitStringsChunkLength: 6,
  unicodeEscapeSequence: true,
  numbersToExpressions: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  sourceMap: false,
};

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && full.endsWith('.js')) yield full;
  }
}

async function run() {
  const files = [];
  for await (const f of walk(targetDir)) files.push(f);

  if (files.length === 0) {
    console.error('[obfuscate] no .js files found under', targetDir);
    process.exit(1);
  }

  console.log(`[obfuscate] processing ${files.length} files`);
  let totalIn = 0;
  let totalOut = 0;
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    totalIn += src.length;
    const out = JavaScriptObfuscator.obfuscate(src, obfuscatorOptions).getObfuscatedCode();
    totalOut += out.length;
    await writeFile(file, out, 'utf8');
  }
  const ratio = totalIn === 0 ? 0 : (totalOut / totalIn).toFixed(2);
  console.log(`[obfuscate] done. ${totalIn} → ${totalOut} bytes (x${ratio})`);
}

run().catch((err) => {
  console.error('[obfuscate] failed:', err);
  process.exit(1);
});
