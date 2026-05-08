import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

export type LocalePreference = 'system' | 'en' | 'es';
export type Locale = 'en' | 'es';

const STORAGE_KEY = 'b2dm-locale';
const SUPPORTED: Locale[] = ['en', 'es'];

function detectFromBrowser(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of langs) {
    const base = (tag || '').toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base as Locale)) return base as Locale;
  }
  return 'es';
}

function resolve(pref: LocalePreference): Locale {
  if (pref === 'system') return detectFromBrowser();
  return pref;
}

async function readStoredPreference(): Promise<LocalePreference> {

  if (typeof chrome === 'undefined' || !chrome.storage?.local) return 'system';
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      const v = res?.[STORAGE_KEY];
      if (v === 'en' || v === 'es' || v === 'system') resolve(v);
      else resolve('system');
    });
  });
}

async function writeStoredPreference(pref: LocalePreference): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY]: pref }, () => resolve());
  });
}

export async function initI18n(): Promise<void> {
  if (i18n.isInitialized) return;
  const pref = await readStoredPreference();
  const locale = resolve(pref);
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: locale,
    fallbackLng: 'es',
    supportedLngs: SUPPORTED,
    interpolation: { escapeValue: false },
    returnNull: false,
  });

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]) return;
      const v = changes[STORAGE_KEY].newValue as LocalePreference | undefined;
      const next = resolve(v ?? 'system');
      if (i18n.language !== next) void i18n.changeLanguage(next);
    });
  }
}

export async function getLocalePreference(): Promise<LocalePreference> {
  return readStoredPreference();
}

export async function setLocalePreference(pref: LocalePreference): Promise<void> {
  await writeStoredPreference(pref);
  await i18n.changeLanguage(resolve(pref));
}

export { i18n };
