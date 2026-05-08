import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { b2dm } from '@/lib/b2dm';

interface Preferences {
  headless: boolean;
  fullWindow: boolean;
  soundsEnabled: boolean;
  scrapeExportDir: string;
}

interface PreferencesContextValue {
  prefs: Preferences;
  setHeadless: (v: boolean) => void;
  setFullWindow: (v: boolean) => void;
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
  return { headless: true, fullWindow: false, soundsEnabled: true, scrapeExportDir: '' };
}

function savePrefs(prefs: Preferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);

  useEffect(() => {
    void b2dm.settings.getHeadless().then((headless) => {
      setPrefs((prev) => {
        if (prev.headless === headless) return prev;
        const next = { ...prev, headless };
        savePrefs(next);
        return next;
      });
    });
    void b2dm.settings.getFullWindow().then((fullWindow) => {
      setPrefs((prev) => {
        if (prev.fullWindow === fullWindow) return prev;
        const next = { ...prev, fullWindow };
        savePrefs(next);
        return next;
      });
    });
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const setHeadless = useCallback(
    (v: boolean) => {
      update({ headless: v });
      void b2dm.settings.setHeadless(v);
    },
    [update]
  );

  const setFullWindow = useCallback(
    (v: boolean) => {
      update({ fullWindow: v });
      void b2dm.settings.setFullWindow(v);
    },
    [update]
  );

  return (
    <PreferencesContext.Provider
      value={{
        prefs,
        setHeadless,
        setFullWindow,
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
