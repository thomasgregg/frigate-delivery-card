import { de } from "./locales/de";
import { en } from "./locales/en";
import type { TranslationCatalog, TranslationKey } from "./locales/en";

const translations = { de, en } satisfies Record<string, TranslationCatalog>;

export type SupportedLocale = keyof typeof translations;
export type { TranslationCatalog, TranslationKey };

export function resolveLanguage(language?: string): string {
  const detected = language?.trim() ||
    (typeof document !== "undefined" ? document.documentElement.lang : "") ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "en";
  try {
    return Intl.getCanonicalLocales(detected)[0] ?? "en";
  } catch {
    return "en";
  }
}

export function resolveLocale(language?: string): SupportedLocale {
  const detected = resolveLanguage(language).toLowerCase();
  if (detected in translations) return detected as SupportedLocale;
  const base = detected.split("-")[0] ?? "en";
  return base in translations ? base as SupportedLocale : "en";
}

export function getTranslations(language?: string): TranslationCatalog {
  return translations[resolveLocale(language)];
}

export function localize(
  key: TranslationKey,
  language?: string,
  replacements: Record<string, string | number> = {},
): string {
  const catalog = translations[resolveLocale(language)];
  const template = catalog[key] ?? en[key] ?? key;
  return Object.entries(replacements).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)),
    template,
  );
}
