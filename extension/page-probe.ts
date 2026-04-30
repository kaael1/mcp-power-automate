import { BRIDGE_SIGNAL, type RuntimeMessage } from './types.js';
import { extractBestFlowLocation } from './url-utils.js';

type ProbeState = {
  fetchPatched: boolean;
  initialized: boolean;
  seenMsalTokens: Set<string>;
  seenPayloads: Set<string>;
  xhrPatched: boolean;
};

(() => {
  const globalWindow = window as Window & {
    __paMcpPageProbeState?: ProbeState;
  };
  const TARGET_SCOPES = [
    ['https://service.flow.microsoft.com/user_impersonation'],
    ['https://service.flow.microsoft.com/.default'],
    ['https://service.powerapps.com/user_impersonation'],
    ['https://service.powerapps.com/.default'],
    ['https://api.powerplatform.com/PowerAutomate.Flow.Read', 'https://api.powerplatform.com/PowerAutomate.Flow.Write'],
    ['https://api.powerplatform.com/PowerAutomate.Flow.Write'],
    ['https://api.powerplatform.com/PowerAutomate.Flow.Read'],
  ];
  const probeState =
    globalWindow.__paMcpPageProbeState ||
    (globalWindow.__paMcpPageProbeState = {
      fetchPatched: false,
      initialized: false,
      seenMsalTokens: new Set<string>(),
      seenPayloads: new Set<string>(),
      xhrPatched: false,
    });
  const seenPayloads = probeState.seenPayloads;
  const seenMsalTokens = probeState.seenMsalTokens;

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

  const getCurrentContext = () => {
    const context = extractBestFlowLocation(getFrameUrlCandidates());

    return {
      ...context,
      currentUrl: window.location.href,
      isTopFrame: window.top === window,
      referrer: document.referrer || null,
    };
  };

  const postDiagnostic = (
    stage: string,
    status: 'error' | 'ok' | 'warning',
    message?: string,
    details?: Record<string, unknown>,
  ) => {
    const context = getCurrentContext();

    window.postMessage(
      {
        payload: {
          capturedAt: new Date().toISOString(),
          details,
          envId: context.envId || undefined,
          flowId: context.flowId || undefined,
          message,
          portalUrl: context.portalUrl || window.location.href,
          source: 'page-probe',
          stage,
          status,
        },
        source: BRIDGE_SIGNAL,
        type: 'capture-diagnostics',
      } satisfies RuntimeMessage,
      '*',
    );
  };

  interface MsalResult {
    accessToken?: string;
    scopes?: string[];
  }

  interface MsalClient {
    acquireTokenSilent(input: { account: unknown; forceRefresh: boolean; scopes: string[] }): Promise<MsalResult>;
    getAllAccounts(): unknown[];
  }

  const postSnapshot = (payload: {
    displayName?: string;
    flow: { connectionReferences: Record<string, unknown>; definition: Record<string, unknown> };
    source: string;
  }) => {
    const context = getCurrentContext();
    if (!payload?.flow?.definition || !payload?.flow?.connectionReferences || !context.envId || !context.flowId) return;

    const signature = JSON.stringify({
      actions: Object.keys(payload.flow.definition.actions || {}),
      displayName: payload.displayName || '',
      envId: context.envId,
      flowId: context.flowId,
      source: payload.source,
      triggers: Object.keys(payload.flow.definition.triggers || {}),
    });

    if (seenPayloads.has(signature)) return;
    seenPayloads.add(signature);
    postDiagnostic('snapshot-capture', 'ok', 'Flow snapshot candidate found in page data.', {
      actionCount: Object.keys(payload.flow.definition.actions || {}).length,
      source: payload.source,
      triggerCount: Object.keys(payload.flow.definition.triggers || {}).length,
    });

    window.postMessage(
      {
        payload: {
          ...payload,
          envId: context.envId,
          flowId: context.flowId,
          capturedAt: new Date().toISOString(),
        },
        source: BRIDGE_SIGNAL,
        type: 'flow-snapshot',
      } satisfies RuntimeMessage,
      '*',
    );
  };

  const normalizeCandidate = (candidate: unknown, source: string) => {
    if (!candidate || typeof candidate !== 'object') return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyCandidate = candidate as Record<string, any>;

    if (anyCandidate.definition && anyCandidate.connectionReferences) {
      return {
        displayName: anyCandidate.displayName || anyCandidate.name || '',
        flow: {
          connectionReferences: anyCandidate.connectionReferences,
          definition: anyCandidate.definition,
        },
        source,
      };
    }

    if (anyCandidate.properties?.definition && anyCandidate.properties?.connectionReferences) {
      return {
        displayName: anyCandidate.properties.displayName || anyCandidate.displayName || anyCandidate.name || '',
        flow: {
          connectionReferences: anyCandidate.properties.connectionReferences,
          definition: anyCandidate.properties.definition,
        },
        source,
      };
    }

    return null;
  };

  const searchObjectGraph = (root: unknown, source: string) => {
    const queue: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: root }];
    const seen = new WeakSet<object>();
    const maxDepth = 8;
    const maxNodes = 4000;
    let visited = 0;

    while (queue.length > 0 && visited < maxNodes) {
      const current = queue.shift();
      if (!current) continue;

      const { depth, value } = current;

      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;

      seen.add(value);
      visited += 1;

      const normalized = normalizeCandidate(value, source);
      if (normalized) {
        postSnapshot(normalized);
      }

      if (depth >= maxDepth) continue;

      for (const nestedValue of Object.values(value)) {
        if (nestedValue && typeof nestedValue === 'object') {
          queue.push({ depth: depth + 1, value: nestedValue });
        }
      }
    }
  };

  const inspectBootstrapState = () => {
    const candidateRoots: unknown[] = [];
    const candidateNames = /store|state|data|bootstrap|config|flow/i;

    for (const key of Object.getOwnPropertyNames(window)) {
      if (!candidateNames.test(key)) continue;

      try {
        candidateRoots.push((window as unknown as Record<string, unknown>)[key]);
      } catch {
        // Ignore inaccessible globals.
      }
    }

    candidateRoots.push((window as unknown as Record<string, unknown>).__INITIAL_STATE__);
    candidateRoots.push((window as unknown as Record<string, unknown>).__PRELOADED_STATE__);

    for (const candidate of candidateRoots.filter(Boolean)) {
      searchObjectGraph(candidate, 'page-state');
    }
  };

  const inspectResponsePayload = (payload: unknown, source: string, url: string | undefined) => {
    if (!payload) return;

    searchObjectGraph(
      {
        payload,
        url,
      },
      source,
    );
  };

  const findMsalCandidates = () => {
    const candidates: MsalClient[] = [];
    const seen = new WeakSet<object>();
    const queue: Array<{ depth: number; value: unknown }> = [];
    const maxDepth = 5;
    const maxNodes = 3000;
    let visited = 0;

    const maybeAdd = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      visited += 1;

      const candidate = value as Partial<MsalClient>;

      if (typeof candidate.acquireTokenSilent === 'function' && typeof candidate.getAllAccounts === 'function') {
        candidates.push(candidate as MsalClient);
      }

      queue.push({ depth: 0, value });
    };

    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        maybeAdd((window as unknown as Record<string, unknown>)[key]);
      } catch {
        // Ignore inaccessible globals.
      }
    }

    while (queue.length > 0 && visited < maxNodes) {
      const current = queue.shift();
      if (!current || current.depth >= maxDepth) continue;
      if (!current.value || typeof current.value !== 'object') continue;

      let keys: string[];
      try {
        keys = Object.getOwnPropertyNames(current.value);
      } catch {
        continue;
      }

      for (const key of keys) {
        if (visited >= maxNodes) break;

        try {
          const nested = (current.value as Record<string, unknown>)[key];
          if (!nested || typeof nested !== 'object' || seen.has(nested)) continue;

          const candidate = nested as Partial<MsalClient>;
          if (typeof candidate.acquireTokenSilent === 'function' && typeof candidate.getAllAccounts === 'function') {
            candidates.push(candidate as MsalClient);
          }

          seen.add(nested);
          visited += 1;
          queue.push({ depth: current.depth + 1, value: nested });
        } catch {
          // Ignore throwing getters.
        }
      }
    }

    return candidates;
  };

  const tryAcquireMsalToken = async () => {
    const candidates = findMsalCandidates();
    let accountCount = 0;
    const failures: Array<{ error: string; scope: string }> = [];
    const successes: Array<{ scope: string }> = [];

    for (const client of candidates) {
      try {
        const accounts = client.getAllAccounts() || [];
        accountCount += accounts.length;

        for (const account of accounts) {
          for (const scopes of TARGET_SCOPES) {
            try {
              const result = await client.acquireTokenSilent({
                account,
                forceRefresh: true,
                scopes,
              });

              if (!result?.accessToken || seenMsalTokens.has(result.accessToken)) continue;

              seenMsalTokens.add(result.accessToken);
              successes.push({ scope: scopes.join(' ') });

              window.postMessage(
                {
                  score: scopes.some((scope) => scope.endsWith('Flow.Write')) ? 500 : 450,
                  scope: Array.isArray(result.scopes) ? result.scopes.join(' ') : scopes.join(' '),
              source: BRIDGE_SIGNAL,
              token: `Bearer ${result.accessToken}`,
              tokenSource: 'msal-silent',
              type: 'token-from-msal',
            } satisfies RuntimeMessage,
                '*',
              );
            } catch (error) {
              failures.push({
                error: error instanceof Error ? error.message : String(error),
                scope: scopes.join(' '),
              });
            }
          }
        }
      } catch {
        continue;
      }
    }

    postDiagnostic(
      'msal-scan',
      successes.length > 0 ? 'ok' : candidates.length > 0 ? 'warning' : 'warning',
      successes.length > 0
        ? 'MSAL silent token acquisition returned token candidates.'
        : candidates.length > 0
          ? 'MSAL clients were found, but silent token acquisition did not return usable tokens.'
          : 'No MSAL client was found in page globals.',
      {
        accountCount,
        clientCount: candidates.length,
        failedScopes: failures.slice(0, 12),
        successCount: successes.length,
        successfulScopes: successes.slice(0, 12),
      },
    );
  };

  const patchFetch = () => {
    if (probeState.fetchPatched) return;
    probeState.fetchPatched = true;

    const originalFetch = window.fetch;

    const resolveFetchUrl = (input: RequestInfo | URL) => {
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.toString();
      return input.url;
    };

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      try {
        const cloned = response.clone();
        const contentType = cloned.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await cloned.json();
          inspectResponsePayload(data, 'fetch-response', resolveFetchUrl(args[0]));
        }
      } catch {
        // Ignore response parsing failures.
      }

      return response;
    };
  };

  const patchXhr = () => {
    if (probeState.xhrPatched) return;
    probeState.xhrPatched = true;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    const patchedOpen: XMLHttpRequest['open'] = function patchedOpen(
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      (this as XMLHttpRequest & { __paMcpUrl?: string }).__paMcpUrl = typeof url === 'string' ? url : url.toString();
      return originalOpen.call(this, method, url, async ?? true, username, password);
    };

    XMLHttpRequest.prototype.open = patchedOpen;

    XMLHttpRequest.prototype.send = function patchedSend(...args: Parameters<XMLHttpRequest['send']>) {
      this.addEventListener('load', () => {
        try {
          const contentType = this.getResponseHeader('content-type') || '';
          if (!contentType.includes('application/json')) return;
          if (typeof this.responseText !== 'string' || !this.responseText) return;

          const data = JSON.parse(this.responseText);
          inspectResponsePayload(data, 'xhr-response', (this as XMLHttpRequest & { __paMcpUrl?: string }).__paMcpUrl);
        } catch {
          // Ignore response parsing failures.
        }
      });

      return originalSend.apply(this, args);
    };
  };

  const { envId, flowId } = getCurrentContext();
  if (!envId || !flowId) return;

  postDiagnostic('page-probe-start', 'ok', 'Page probe started.', {
    href: window.location.href,
    isTopFrame: window.top === window,
    matchedPortalUrl: getCurrentContext().portalUrl,
    referrer: document.referrer || null,
  });

  if (!probeState.initialized) {
    probeState.initialized = true;
    patchFetch();
    patchXhr();

    setTimeout(inspectBootstrapState, 1500);
    setTimeout(inspectBootstrapState, 4000);
    setTimeout(() => {
      void tryAcquireMsalToken();
    }, 1500);
    setTimeout(() => {
      void tryAcquireMsalToken();
    }, 4000);
  }

  inspectBootstrapState();
  void tryAcquireMsalToken();
})();
