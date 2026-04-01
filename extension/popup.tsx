import { createRoot } from 'react-dom/client';

import { ErrorView, LoadingView, PopupDashboardView } from './components/dashboard-view.js';
import { useDashboard } from './use-dashboard.js';

const PopupApp = () => {
  const { model, pendingAction, phase, refresh, runAction } = useDashboard();

  if (phase.kind === 'loading' || !model) {
    return <LoadingView surface="popup" />;
  }

  if (phase.kind === 'background-error') {
    return <ErrorView bridgeHealth={phase.bridgeHealth} error={phase.error} onRetry={() => void refresh()} surface="popup" />;
  }

  return <PopupDashboardView model={model} onAction={(action) => void runAction(action)} pendingAction={pendingAction} />;
};

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing popup root element.');
}

createRoot(rootElement).render(<PopupApp />);
