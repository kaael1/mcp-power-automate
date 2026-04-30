import { BRIDGE_SIGNAL, type RuntimeMessage } from './types.js';
import { buildFinding, decodeJwtPayload, dedupeFindings, extractTokenCandidates, scoreScopes } from './token-utils.js';
import { extractBestFlowLocation } from './url-utils.js';

declare global {
  interface Window {
    __paMcpBridgeTeardown?: () => void;
  }
}

(() => {
let extensionContextAlive = true;
let deepScanTimer: number | null = null;
let refreshTimer: number | null = null;
let locationWatchTimer: number | null = null;
let lastObservedUrl = window.location.href;

const getFrameUrlCandidates = () => {
  const candidates = [window.location.href, document.referrer];

  try {
    if (window.parent && window.parent !== window) {
      candidates.push(window.parent.location.href);
    }
  } catch {
    // Cross-origin frames can still expose the parent URL through document.referrer.
  }

  try {
    if (window.top && window.top !== window) {
      candidates.push(window.top.location.href);
    }
  } catch {
    // Cross-origin top frames can still expose the parent URL through document.referrer.
  }

  return candidates;
};

const getCurrentContext = () => extractBestFlowLocation(getFrameUrlCandidates());

const isContextInvalidatedError = (error: unknown) =>
  error instanceof Error && /Extension context invalidated/i.test(error.message);

const cleanupRuntimeHooks = () => {
  if (deepScanTimer !== null) {
    window.clearTimeout(deepScanTimer);
    deepScanTimer = null;
  }

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

const reportDiagnostic = async ({
  details,
  message,
  stage,
  status = 'ok',
}: {
  details?: Record<string, unknown>;
  message?: string;
  stage: string;
  status?: 'error' | 'ok' | 'warning';
}) => {
  const context = getCurrentContext();
  await safeSendMessage({
    payload: {
      capturedAt: new Date().toISOString(),
      details,
      envId: context.envId || undefined,
      flowId: context.flowId || undefined,
      message,
      portalUrl: context.portalUrl || undefined,
      source: 'storage-capture',
      stage,
      status,
    },
    source: BRIDGE_SIGNAL,
    type: 'capture-diagnostics',
  } satisfies RuntimeMessage);
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

const reportBestToken = async ({ includeIndexedDb = false }: { includeIndexedDb?: boolean } = {}) => {
  try {
    const findings = dedupeFindings([
      ...inspectStorage(window.localStorage, 'localStorage'),
      ...inspectStorage(window.sessionStorage, 'sessionStorage'),
      ...(includeIndexedDb ? await inspectIndexedDb() : []),
    ]);

    if (findings.length === 0) {
      await reportDiagnostic({
        details: {
          includeIndexedDb,
        },
        message: 'Storage token scan completed without token candidates.',
        stage: 'storage-scan',
        status: 'warning',
      });
      return;
    }

    findings.sort((left, right) => (right.score || 0) - (left.score || 0));
    const best = findings[0];

    if (!best) return;

    await reportDiagnostic({
      details: {
        bestAudience: best.aud,
        bestScore: best.score,
        bestSource: best.source,
        candidateCount: findings.length,
        includeIndexedDb,
        topAudiences: [...new Set(findings.slice(0, 10).map((finding) => finding.aud))],
      },
      message: 'Storage token scan captured token candidates.',
      stage: 'storage-scan',
    });

    const context = getCurrentContext();
    await safeSendMessage({
      payload: {
        candidates: findings.slice(0, 50),
        capturedAt: new Date().toISOString(),
        envId: context.envId || undefined,
        flowId: context.flowId || undefined,
        portalUrl: context.portalUrl || undefined,
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
  } catch (error) {
    await reportDiagnostic({
      details: {
        includeIndexedDb,
      },
      message: error instanceof Error ? error.message : String(error),
      stage: 'storage-scan',
      status: 'error',
    });
  }
};

const scheduleDeepScan = (delayMs = 15000) => {
  if (!extensionContextAlive) return;

  if (deepScanTimer !== null) {
    window.clearTimeout(deepScanTimer);
  }

  deepScanTimer = window.setTimeout(() => {
    deepScanTimer = null;
    void reportBestToken({ includeIndexedDb: true });
  }, delayMs);
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
};

const handleLocationChange = () => {
  if (window.location.href === lastObservedUrl) return;
  lastObservedUrl = window.location.href;
  void reportBestToken();
  injectProbe();
  scheduleDeepScan(5000);
};

window.__paMcpBridgeTeardown?.();
window.__paMcpBridgeTeardown = cleanupRuntimeHooks;

window.addEventListener('message', handleMessage);
window.addEventListener('beforeunload', cleanupRuntimeHooks, { once: true });
window.addEventListener('popstate', handleLocationChange);
window.addEventListener('hashchange', handleLocationChange);

void reportDiagnostic({
  details: {
    href: window.location.href,
    isTopFrame: window.top === window,
    matchedPortalUrl: getCurrentContext().portalUrl,
    referrer: document.referrer || null,
  },
  message: 'Content script started.',
  stage: 'content-script-start',
});
void reportBestToken();
injectProbe();
scheduleDeepScan();
window.addEventListener('focus', handleFocus);
window.addEventListener('storage', handleStorage);
refreshTimer = window.setInterval(() => {
  void reportBestToken();
}, 30000);
locationWatchTimer = window.setInterval(handleLocationChange, 1000);
})();
