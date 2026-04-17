import { createContext, useContext, useState, useCallback } from 'react';

interface Preferences {
  headless: boolean;
  soundsEnabled: boolean;
  scrapeExportDir: string;
}

interface PreferencesContextValue {
  prefs: Preferences;
  setHeadless: (v: boolean) => void;
  setSoundsEnabled: (v: boolean) => void;
  setScrapeExportDir: (v: string) => void;
}

const STORAGE_KEY = 'b2dm-prefs';

function loadPrefs(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

function defaults(): Preferences {
  return { headless: true, soundsEnabled: true, scrapeExportDir: '' };
}

function savePrefs(prefs: Preferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  return (
    <PreferencesContext.Provider
      value={{
        prefs,
        setHeadless: (v) => update({ headless: v }),
        setSoundsEnabled: (v) => update({ soundsEnabled: v }),
        setScrapeExportDir: (v) => update({ scrapeExportDir: v }),
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider');
  return ctx;
}
