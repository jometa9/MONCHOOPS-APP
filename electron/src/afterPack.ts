import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const appRoot = path.resolve(__dirname, '..', '..');

interface AfterPackContext {
  electronPlatformName: string;
  appOutDir: string;
}

function applyWindowsIcon(appOutDir: string) {
  const exePath = path.join(appOutDir, 'MonchoOps.exe');
  if (!fs.existsSync(exePath)) return;
  const icoPath = path.join(appRoot, 'public', 'icon.ico');
  if (!fs.existsSync(icoPath)) return;
  const rceditPath = path.join(appRoot, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
  if (!fs.existsSync(rceditPath)) return;
  try {
    execSync(`"${rceditPath}" "${exePath}" --set-icon "${icoPath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.error('afterPack: set icon failed:', err);
  }
  const targetLocations = [
    path.join(appOutDir, 'icon.ico'),
    path.join(appOutDir, 'resources', 'icon.ico'),
  ];
  for (const target of targetLocations) {
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(icoPath, target);
  }
}

export default async function afterPack(context: AfterPackContext) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName === 'win32') {
    try {
      applyWindowsIcon(appOutDir);
    } catch (err) {
      console.error('afterPack: Windows icon application failed:', err);
    }
  }
}

module.exports = afterPack as any;
