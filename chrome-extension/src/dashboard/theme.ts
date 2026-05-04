import { useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'b2dm.themeMode';
const mql = window.matchMedia('(prefers-color-scheme: dark)');

function resolve(mode: ThemeMode): boolean {
  if (mode === 'system') return mql.matches;
  return mode === 'dark';
}

function apply(mode: ThemeMode) {
  document.documentElement.classList.toggle('dark', resolve(mode));
}

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

let current: ThemeMode = readStored();
const listeners = new Set<(m: ThemeMode) => void>();

apply(current);
mql.addEventListener('change', () => {
  if (current === 'system') apply('system');
});

export function setThemeMode(mode: ThemeMode) {
  current = mode;
  localStorage.setItem(STORAGE_KEY, mode);
  apply(mode);
  listeners.forEach((l) => l(mode));
}

export function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(current);
  useEffect(() => {
    const l = (m: ThemeMode) => setMode(m);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return [mode, setThemeMode];
}
