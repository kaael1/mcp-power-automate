import { createRoot } from 'react-dom/client';

import { ErrorView, LoadingView, SidePanelDashboardView } from './components/dashboard-view.js';
import { usePreferredLocale } from './use-locale.js';
import { useDashboard } from './use-dashboard.js';

const SidePanelApp = () => {
  const { locale, setLocale } = usePreferredLocale();
  const { model, pendingAction, phase, refresh, runAction } = useDashboard(locale);

  if (phase.kind === 'loading' || !model) {
    return <LoadingView locale={locale} onLocaleChange={setLocale} surface="sidepanel" />;
  }

  if (phase.kind === 'background-error') {
    return (
      <ErrorView
        bridgeHealth={phase.bridgeHealth}
        error={phase.error}
        locale={locale}
        onLocaleChange={setLocale}
        onRetry={() => void refresh()}
        surface="sidepanel"
      />
    );
  }

  return (
    <SidePanelDashboardView
      locale={locale}
      model={model}
      onAction={(action) => void runAction(action)}
      onLocaleChange={setLocale}
      pendingAction={pendingAction}
    />
  );
};

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing side panel root element.');
}

createRoot(rootElement).render(<SidePanelApp />);
