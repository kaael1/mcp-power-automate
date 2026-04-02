import { BRIDGE_SIGNAL, type RuntimeMessage } from './types.js';
import { buildFinding, decodeJwtPayload, dedupeFindings, extractTokenCandidates, scoreScopes } from './token-utils.js';

declare global {
  interface Window {
    __paMcpBridgeTeardown?: () => void;
  }
}

let extensionContextAlive = true;
let refreshTimer: number | null = null;
let locationWatchTimer: number | null = null;
let lastObservedUrl = window.location.href;

const isContextInvalidatedError = (error: unknown) =>
  error instanceof Error && /Extension context invalidated/i.test(error.message);

const cleanupRuntimeHooks = () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (locationWatchTimer !== null) {
    window.clearInterval(locationWatchTimer);
    locationWatchTimer = null;
  }

  window.removeEventListener('focus', handleFocus);
  window.removeEventListener('storage', handleStorage);
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('popstate', handleLocationChange);
  window.removeEventListener('hashchange', handleLocationChange);
  window.removeEventListener('beforeunload', cleanupRuntimeHooks);
};

const markContextInvalidated = (error: unknown) => {
  if (!isContextInvalidatedError(error)) return;

  extensionContextAlive = false;
  cleanupRuntimeHooks();
};

const safeSendMessage = async (message: RuntimeMessage) => {
  if (!extensionContextAlive) return null;

  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    markContextInvalidated(error);
    return null;
  }
};

const inspectStorage = (storage: Storage, storageName: string) => {
  const findings = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key) continue;

    const rawValue = storage.getItem(key);
    if (!rawValue) continue;

    const candidates = extractTokenCandidates(rawValue);

    for (const candidate of candidates) {
      const payload = decodeJwtPayload(candidate);
      if (!payload?.aud) continue;

      const scope = payload.scp || payload.roles?.join(' ') || '';
      const score = scoreScopes(scope);

      findings.push(
        buildFinding({
          payload,
          scope,
          score,
          source: `${storageName}:${key}`,
          token: `Bearer ${candidate}`,
        }),
      );
    }
  }

  return findings;
};

const collectAllFromStore = (db: IDBDatabase, storeName: string) =>
  new Promise<unknown[]>((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error(`Failed to read ${storeName}`));
    } catch (error) {
      reject(error);
    }
  });

const openDb = (name: string, version?: number) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(`Failed to open ${name}`));
  });

const inspectIndexedDb = async () => {
  if (!indexedDB.databases) return [];

  const dbs = await indexedDB.databases();
  const findings = [];

  for (const dbInfo of dbs) {
    if (!dbInfo?.name) continue;

    try {
      const db = await openDb(dbInfo.name, dbInfo.version);

      for (const storeName of db.objectStoreNames) {
        try {
          const values = await collectAllFromStore(db, storeName);

          for (const value of values) {
            const candidates = extractTokenCandidates(value);

            for (const candidate of candidates) {
              const payload = decodeJwtPayload(candidate);
              if (!payload?.aud) continue;

              const scope = payload.scp || payload.roles?.join(' ') || '';
              const score = scoreScopes(scope);

              findings.push(
                buildFinding({
                  payload,
                  scope,
                  score,
                  source: `indexedDB:${dbInfo.name}:${storeName}`,
                  token: `Bearer ${candidate}`,
                }),
              );
            }
          }
        } catch {
          // Ignore stores we cannot enumerate.
        }
      }

      db.close();
    } catch {
      // Ignore databases we cannot open.
    }
  }

  return findings;
};

const reportBestToken = async () => {
  try {
    const findings = dedupeFindings([
      ...inspectStorage(window.localStorage, 'localStorage'),
      ...inspectStorage(window.sessionStorage, 'sessionStorage'),
      ...(await inspectIndexedDb()),
    ]);

    if (findings.length === 0) return;

    findings.sort((left, right) => (right.score || 0) - (left.score || 0));
    const best = findings[0];

    if (!best) return;

    await safeSendMessage({
      payload: {
        candidates: findings.slice(0, 50),
        capturedAt: new Date().toISOString(),
        envId: window.location.href.match(/environments\/([a-zA-Z0-9-]+)/i)?.[1],
        flowId: window.location.href.match(/flows\/(?:shared\/)?([0-9a-f-]{36})/i)?.[1],
        portalUrl: window.location.href,
        source: 'browser-storage',
      },
      source: BRIDGE_SIGNAL,
      type: 'token-audit',
    } satisfies RuntimeMessage);

    await safeSendMessage({
      scope: best.scope,
      score: best.score || 0,
      source: best.source,
      token: best.token,
      type: 'token-from-storage',
    } satisfies RuntimeMessage);
  } catch {
    // Ignore storage capture failures; request interception is still the primary path.
  }
};

const injectProbe = () => {
  if (!extensionContextAlive) return;

  document.querySelectorAll('script[data-pa-mcp-probe="true"]').forEach((node) => node.remove());

  const script = document.createElement('script');
  try {
    script.src = chrome.runtime.getURL('page-probe.js');
  } catch (error) {
    markContextInvalidated(error);
    return;
  }
  script.dataset.paMcpProbe = 'true';
  script.async = false;
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
};

const handleMessage = (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.data?.source !== BRIDGE_SIGNAL) return;

  void safeSendMessage(event.data as RuntimeMessage);
};

const handleFocus = () => {
  void reportBestToken();
  injectProbe();
};

const handleStorage = () => {
  void reportBestToken();
  injectProbe();
};

const handleLocationChange = () => {
  if (window.location.href === lastObservedUrl) return;
  lastObservedUrl = window.location.href;
  void reportBestToken();
  injectProbe();
};

window.__paMcpBridgeTeardown?.();
window.__paMcpBridgeTeardown = cleanupRuntimeHooks;

window.addEventListener('message', handleMessage);
window.addEventListener('beforeunload', cleanupRuntimeHooks, { once: true });
window.addEventListener('popstate', handleLocationChange);
window.addEventListener('hashchange', handleLocationChange);

void reportBestToken();
injectProbe();
window.addEventListener('focus', handleFocus);
window.addEventListener('storage', handleStorage);
refreshTimer = window.setInterval(() => {
  void reportBestToken();
  injectProbe();
}, 5000);
locationWatchTimer = window.setInterval(handleLocationChange, 1000);
