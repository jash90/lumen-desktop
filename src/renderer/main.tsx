import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App';
import { I18nProvider } from './i18n';
import { setLocale } from '../shared/i18n';
import './index.css';

/**
 * The bridge pushes state changes over the event stream (PRD §23), so polling is
 * switched off entirely — queries are refetched only on demand.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchInterval: false,
      retry: 1,
      staleTime: Infinity,
    },
  },
});

// Module-level too, for the few helpers that format text outside a component
// (error fallbacks, lightCountLabel).
const locale = window.lumen.locale;
setLocale(locale);
document.documentElement.lang = locale;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider locale={locale}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
