import { useEffect, useState } from 'react';

import {
  applyDocumentLocale,
  getStoredLocale,
  normalizeLocale,
  setStoredLocale,
  UI_LOCALE_STORAGE_KEY,
  type Locale,
} from './i18n.js';

export const usePreferredLocale = () => {
  const [locale, setLocaleState] = useState<Locale>(() => getStoredLocale());

  useEffect(() => {
    applyDocumentLocale(locale);
    setStoredLocale(locale);
  }, [locale]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== UI_LOCALE_STORAGE_KEY) return;
      setLocaleState(normalizeLocale(event.newValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return {
    locale,
    setLocale: setLocaleState,
  };
};
