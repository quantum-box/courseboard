import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { ja } from './locales/ja'
import { jaPlain } from './locales/ja-plain'

export const LOCALES = ['ja', 'ja-plain', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** Locale names stay in their own language so the switcher is readable to everyone. */
export const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  'ja-plain': 'わかりやすい日本語',
  en: 'English',
}

const STORAGE_KEY = 'courseboard.locale'

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : null
  } catch {
    return null
  }
}

/** Stored choice wins; otherwise fall back to the OS/browser language. */
export function detectLocale(): Locale {
  const stored = readStoredLocale()
  if (stored) return stored
  const candidates = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate.toLowerCase().startsWith('ja')) return 'ja'
    if (candidate.toLowerCase().startsWith('en')) return 'en'
  }
  return 'ja'
}

/**
 * `ja-plain` is not a valid BCP 47 tag, so keep the document language at `ja`
 * for screen readers and CJK font selection.
 */
function documentLanguage(locale: Locale) {
  return locale === 'en' ? 'en' : 'ja'
}

export function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = documentLanguage(locale)
  document.documentElement.dataset.locale = locale
}

void i18next.use(initReactI18next).init({
  resources: {
    ja: ja as unknown as Record<string, Record<string, unknown>>,
    'ja-plain': jaPlain as unknown as Record<string, Record<string, unknown>>,
    en: en as unknown as Record<string, Record<string, unknown>>,
  },
  lng: detectLocale(),
  // Easy Japanese and English both fall back to Japanese for untranslated keys.
  fallbackLng: { 'ja-plain': ['ja'], en: ['ja'], default: ['ja'] },
  supportedLngs: [...LOCALES],
  // i18next upper-cases the part after the hyphen ("ja-plain" → "ja-EASY") unless
  // codes are lower-cased, which would drop `ja-plain` from the resolve chain and
  // silently render Japanese instead.
  lowerCaseLng: true,
  cleanCode: false,
  nonExplicitSupportedLngs: false,
  ns: Object.keys(ja),
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
})

applyDocumentLocale(i18next.language as Locale)

export function currentLocale(): Locale {
  return isLocale(i18next.language) ? i18next.language : 'ja'
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Private-mode storage failures must not block the language change.
  }
  applyDocumentLocale(locale)
  void i18next.changeLanguage(locale)
}

export { i18next }
