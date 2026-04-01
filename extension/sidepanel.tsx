import { createRoot } from 'react-dom/client';

import { ErrorView, LoadingView, SidePanelDashboardView } from './components/dashboard-view.js';
import { useDashboard } from './use-dashboard.js';

const SidePanelApp = () => {
  const { model, pendingAction, phase, refresh, runAction } = useDashboard();

  if (phase.kind === 'loading' || !model) {
    return <LoadingView surface="sidepanel" />;
  }

  if (phase.kind === 'background-error') {
    return <ErrorView bridgeHealth={phase.bridgeHealth} error={phase.error} onRetry={() => void refresh()} surface="sidepanel" />;
  }

  return <SidePanelDashboardView model={model} onAction={(action) => void runAction(action)} pendingAction={pendingAction} />;
};

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing side panel root element.');
}

createRoot(rootElement).render(<SidePanelApp />);
