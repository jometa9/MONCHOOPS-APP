#!/usr/bin/env node
// Kill whatever is bound to the given port. Used before `vite` to avoid
// "port is in use, trying next..." which breaks our strictPort contract.
import { execSync } from 'node:child_process';

const port = Number(process.argv[2]);
if (!Number.isFinite(port) || port <= 0) {
  console.error('kill-port: expected a port number, got', process.argv[2]);
  process.exit(1);
}

try {
  if (process.platform === 'win32') {
    const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true });
    const needle = `:${port}`;
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(needle) || !line.toUpperCase().includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore', windowsHide: true });
      } catch {}
    }
  } else {
    execSync(`lsof -ti :${port} 2>/dev/null | xargs kill -9 2>/dev/null`, {
      stdio: 'ignore',
      shell: '/bin/sh',
    });
  }
} catch {
  // Best-effort; never block the dev command.
}
