/**
 * Language negotiation, kept apart from the dictionaries so the preload script
 * can validate the locale without bundling every string in the app.
 */

export const LOCALES = ['en', 'pl'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the first supported language from an ordered list of BCP 47 tags
 * (`app.getPreferredSystemLanguages()`, `navigator.languages`, …). Anything we
 * do not speak falls back to English.
 */
export function resolveLocale(tags: readonly (string | null | undefined)[]): Locale {
  for (const tag of tags) {
    const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}
