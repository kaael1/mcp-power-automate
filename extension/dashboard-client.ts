import type { HealthPayload, PopupStatusPayload } from '../server/bridge-types.js';
import type { DashboardPayload, RuntimeMessage } from './types.js';

export const sendRuntimeMessage = <T>(message: RuntimeMessage) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('The extension background did not reply in time.'));
    }, 4500);

    chrome.runtime.sendMessage(message, (response: T | PopupStatusPayload | undefined) => {
      window.clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response) {
        reject(new Error('The extension background returned no response.'));
        return;
      }

      resolve(response as T);
    });
  });

export const fetchBridgeHealthDirect = async () => {
  try {
    const response = await fetch('http://127.0.0.1:17373/health');
    if (!response.ok) {
      return null;
    }

    return (await response.json()) as HealthPayload;
  } catch {
    return null;
  }
};

export const getDashboardPayload = () => sendRuntimeMessage<DashboardPayload>({ type: 'get-dashboard' });
