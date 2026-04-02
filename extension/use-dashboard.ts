import { startTransition, useEffect, useMemo, useState } from 'react';

import type { HealthPayload } from '../server/bridge-types.js';
import { deriveDashboardModel } from './dashboard-model.js';
import { fetchBridgeHealthDirect, getDashboardPayload, openSidePanelDirect, sendRuntimeMessage } from './dashboard-client.js';
import type { Locale } from './i18n.js';
import type { DashboardPayload, RuntimeMessage } from './types.js';

type DashboardMessageAction =
  | 'open-side-panel'
  | 'refresh-current-tab'
  | 'refresh-flows'
  | 'refresh-last-run'
  | 'resend-session'
  | 'revert-last-update'
  | 'set-active-flow-from-tab';

export type DashboardAction =
  | { type: DashboardMessageAction }
  | { flowId: string; type: 'set-active-flow' }
  | { flowId: string; type: 'toggle-pinned-flow' };

export type DashboardPhase =
  | { kind: 'loading' }
  | { kind: 'ready'; payload: DashboardPayload }
  | { bridgeHealth: HealthPayload | null; error: string; kind: 'background-error' };

export const useDashboard = (locale: Locale) => {
  const [phase, setPhase] = useState<DashboardPhase>({ kind: 'loading' });
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const refresh = async () => {
    startTransition(() => {
      setPhase({ kind: 'loading' });
    });

    try {
      const payload = await getDashboardPayload();
      startTransition(() => {
        setPhase({ kind: 'ready', payload });
      });
    } catch (error) {
      const bridgeHealth = await fetchBridgeHealthDirect();
      startTransition(() => {
        setPhase({
          bridgeHealth,
          error: error instanceof Error ? error.message : String(error),
          kind: 'background-error',
        });
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const runAction = async (action: DashboardAction) => {
    setPendingAction(action.type);

    try {
      if (action.type === 'open-side-panel') {
        try {
          await openSidePanelDirect();
        } catch {
          await sendRuntimeMessage<{ ok: true }>(action as RuntimeMessage);
        }

        if (document.body.dataset.surface === 'popup') {
          window.close();
          return;
        }

        const payload = await getDashboardPayload();
        startTransition(() => {
          setPhase({ kind: 'ready', payload });
        });
      } else {
        const payload = await sendRuntimeMessage<DashboardPayload>(action as RuntimeMessage);
        startTransition(() => {
          setPhase({ kind: 'ready', payload });
        });
      }
    } catch (error) {
      const bridgeHealth = await fetchBridgeHealthDirect();
      startTransition(() => {
        setPhase({
          bridgeHealth,
          error: error instanceof Error ? error.message : String(error),
          kind: 'background-error',
        });
      });
    } finally {
      setPendingAction(null);
    }
  };

  const model = useMemo(() => {
    if (phase.kind === 'ready') {
      return deriveDashboardModel(phase.payload, locale);
    }

    return null;
  }, [locale, phase]);

  return {
    model,
    pendingAction,
    phase,
    refresh,
    runAction,
  };
};
