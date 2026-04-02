import { createRoot } from 'react-dom/client';

import { ErrorView, LoadingView, PopupDashboardView } from './components/dashboard-view.js';
import { usePreferredLocale } from './use-locale.js';
import { useDashboard } from './use-dashboard.js';

const PopupApp = () => {
  const { locale, setLocale } = usePreferredLocale();
  const { model, phase, refresh, runAction } = useDashboard(locale);

  if (phase.kind === 'loading' || !model) {
    return <LoadingView locale={locale} onLocaleChange={setLocale} surface="popup" />;
  }

  if (phase.kind === 'background-error') {
    return (
      <ErrorView
        bridgeHealth={phase.bridgeHealth}
        error={phase.error}
        locale={locale}
        onLocaleChange={setLocale}
        onRetry={() => void refresh()}
        surface="popup"
      />
    );
  }

  return (
    <PopupDashboardView
      locale={locale}
      model={model}
      onAction={(action) => void runAction(action)}
      onLocaleChange={setLocale}
    />
  );
};

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing popup root element.');
}

createRoot(rootElement).render(<PopupApp />);
