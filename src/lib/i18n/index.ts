import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

export type LocalePreference = 'system' | 'en' | 'es';
export type Locale = 'en' | 'es';

const STORAGE_KEY = 'monchoops-locale';
const SUPPORTED: Locale[] = ['en', 'es'];

function detectFromBrowser(): Locale {
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of langs) {
    const base = (tag || '').toLowerCase().split('-')[0];
    if (SUPPORTED.includes(base as Locale)) return base as Locale;
  }
  return 'es';
}

function readPreference(): LocalePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'en' || v === 'es' || v === 'system') return v;
  } catch {

  }
  return 'system';
}

function resolve(pref: LocalePreference): Locale {
  return pref === 'system' ? detectFromBrowser() : pref;
}

export function initI18n(): void {
  if (i18n.isInitialized) return;
  const locale = resolve(readPreference());
  void i18n.use(initReactI18next).init({
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
}

export function getLocalePreference(): LocalePreference {
  return readPreference();
}

export function setLocalePreference(pref: LocalePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {

  }
  void i18n.changeLanguage(resolve(pref));
}

export { i18n };
