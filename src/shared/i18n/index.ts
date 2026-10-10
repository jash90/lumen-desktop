import { en, type MessageKey } from './en';
import { pl } from './pl';
import { DEFAULT_LOCALE, type Locale } from './locale';

/**
 * A deliberately small i18n layer shared by the main process and the renderer.
 *
 * English is the source of truth and the fallback; Polish is the only other
 * language. The language is picked once per process from the operating system
 * (see `resolveLocale`) — the main process passes its choice to the renderer, so
 * the tray, dialogs and window always agree.
 */

export type { MessageKey } from './en';

export { DEFAULT_LOCALE, isLocale, LOCALES, resolveLocale, type Locale } from './locale';

/**
 * A message is either plain text or one entry per CLDR plural category, chosen
 * by the `count` parameter. `other` is always required; English needs only
 * `one` besides it, Polish also `few` and `many` (1 lampa, 2 lampy, 5 lamp).
 */
export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralMessage;
export type Dictionary = Record<MessageKey, Message>;

export type MessageParams = Record<string, string | number>;

export const DICTIONARIES: Record<Locale, Dictionary> = { en, pl };

const pluralRules = new Map<Locale, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

function interpolate(text: string, params: MessageParams | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translates one key for an explicit locale. Missing Polish entries fall back to English. */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const message = DICTIONARIES[locale][key] ?? DICTIONARIES[DEFAULT_LOCALE][key] ?? key;
  if (typeof message === 'string') return interpolate(message, params);
  const count = Number(params?.count ?? 0);
  const text = message[pluralCategory(locale, count)] ?? message.other;
  return interpolate(text, params);
}

/*
 * Each process (main, renderer, a test run) has its own copy of this module, so
 * a module-level locale is per-process state — exactly the scope we want.
 */
let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** Translates for the current process locale. */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(current, key, params);
}

export type Translate = typeof t;
