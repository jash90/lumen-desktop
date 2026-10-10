import { createContext, useCallback, useContext, type ReactNode } from 'react';

import {
  DEFAULT_LOCALE,
  type Locale,
  type MessageKey,
  type MessageParams,
  type Translate,
  translate,
} from '../shared/i18n';

/**
 * React binding for the shared dictionaries.
 *
 * The locale is chosen by the main process and handed over by the preload
 * script, so the window speaks the same language as the tray and the dialogs.
 * It never changes during a session — switching the system language takes an
 * app restart, as it does in most desktop apps.
 */

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Returns `t(key, params)` bound to the window's locale. */
export function useT(): Translate {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, params?: MessageParams) => translate(locale, key, params),
    [locale],
  );
}
