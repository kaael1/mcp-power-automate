export type Locale = 'en' | 'pt-BR';

export const DEFAULT_LOCALE: Locale = 'en';
export const UI_LOCALE_STORAGE_KEY = 'mcpPowerAutomate.uiLocale';

export const LOCALE_OPTIONS: Array<{ flag: string; id: Locale; label: string }> = [
  { flag: '🇺🇸', id: 'en', label: 'EN' },
  { flag: '🇧🇷', id: 'pt-BR', label: 'PT' },
];

export const normalizeLocale = (value: string | null | undefined): Locale =>
  value === 'pt-BR' ? 'pt-BR' : 'en';

export const getStoredLocale = (): Locale => {
  try {
    return normalizeLocale(window.localStorage.getItem(UI_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
};

export const setStoredLocale = (locale: Locale) => {
  try {
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures and keep the in-memory selection.
  }
};

export const applyDocumentLocale = (locale: Locale) => {
  if (typeof document === 'undefined') return;

  document.documentElement.lang = locale;
};

export const t = (locale: Locale, english: string, portuguese: string) =>
  locale === 'pt-BR' ? portuguese : english;

const formatUnit = (
  locale: Locale,
  amount: number,
  englishLong: string,
  englishShort: string,
  portugueseLong: string,
  portugueseShort: string,
  compact: boolean,
) => {
  if (locale === 'pt-BR') {
    return compact ? `${amount}${portugueseShort}` : `${amount} ${portugueseLong}`;
  }

  return compact ? `${amount}${englishShort}` : `${amount} ${englishLong}`;
};

export const formatRelativeTime = (
  locale: Locale,
  value: Date | string | null | undefined,
  options: { compact?: boolean; fallback?: string } = {},
) => {
  const { compact = false, fallback = '—' } = options;
  if (!value) return fallback;

  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return fallback;

  const diffMs = Date.now() - date.getTime();
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));

  if (totalSeconds < 60) {
    if (compact) {
      return formatUnit(locale, totalSeconds, 'sec', 's', 'seg', 's', compact);
    }

    return locale === 'pt-BR'
      ? totalSeconds <= 1
        ? 'agora mesmo'
        : `${totalSeconds} segundos atrás`
      : totalSeconds <= 1
        ? 'just now'
        : `${totalSeconds} seconds ago`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    if (compact) {
      return formatUnit(locale, totalMinutes, 'min', 'm', 'min', 'm', compact);
    }

    return locale === 'pt-BR'
      ? `${totalMinutes} min atrás`
      : `${totalMinutes} min ago`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    if (compact) {
      return formatUnit(locale, totalHours, 'hr', 'h', 'h', 'h', compact);
    }

    return locale === 'pt-BR' ? `${totalHours} h atrás` : `${totalHours} hr ago`;
  }

  const totalDays = Math.floor(totalHours / 24);
  if (compact) {
    return formatUnit(locale, totalDays, 'day', 'd', 'dia', 'd', compact);
  }

  return locale === 'pt-BR' ? `${totalDays} d atrás` : `${totalDays} day${totalDays === 1 ? '' : 's'} ago`;
};
