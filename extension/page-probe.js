(() => {
  const BRIDGE_SIGNAL = 'pa-mcp-bridge';
  const TARGET_SCOPES = [
    ['https://api.powerplatform.com/PowerAutomate.Flow.Read', 'https://api.powerplatform.com/PowerAutomate.Flow.Write'],
    ['https://api.powerplatform.com/PowerAutomate.Flow.Write'],
    ['https://api.powerplatform.com/PowerAutomate.Flow.Read'],
  ];
  const flowIdMatch = window.location.href.match(/flows\/(?:shared\/)?([0-9a-f-]{36})/i);
  const envIdMatch = window.location.href.match(/environments\/([a-zA-Z0-9-]+)/i);
  const currentFlowId = flowIdMatch?.[1] || null;
  const currentEnvId = envIdMatch?.[1] || null;
  const seenPayloads = new Set();
  const seenMsalTokens = new Set();

  const postSnapshot = (payload) => {
    if (!payload?.flow?.definition || !payload?.flow?.connectionReferences) return;

    const signature = JSON.stringify({
      displayName: payload.displayName || '',
      envId: payload.envId,
      flowId: payload.flowId,
      source: payload.source,
      actions: Object.keys(payload.flow.definition.actions || {}),
      triggers: Object.keys(payload.flow.definition.triggers || {}),
    });

    if (seenPayloads.has(signature)) return;
    seenPayloads.add(signature);

    window.postMessage(
      {
        payload: {
          ...payload,
          capturedAt: new Date().toISOString(),
        },
        source: BRIDGE_SIGNAL,
        type: 'flow-snapshot',
      },
      '*',
    );
  };

  const normalizeCandidate = (candidate, source) => {
    if (!candidate || typeof candidate !== 'object') return null;

    if (candidate.definition && candidate.connectionReferences) {
      return {
        displayName: candidate.displayName || candidate.name || '',
        envId: currentEnvId,
        flow: {
          connectionReferences: candidate.connectionReferences,
          definition: candidate.definition,
        },
        flowId: currentFlowId,
        source,
      };
    }

    if (candidate.properties?.definition && candidate.properties?.connectionReferences) {
      return {
        displayName: candidate.properties.displayName || candidate.displayName || candidate.name || '',
        envId: currentEnvId,
        flow: {
          connectionReferences: candidate.properties.connectionReferences,
          definition: candidate.properties.definition,
        },
        flowId: currentFlowId,
        source,
      };
    }

    return null;
  };

  const searchObjectGraph = (root, source) => {
    const queue = [{ depth: 0, value: root }];
    const seen = new WeakSet();
    const maxDepth = 8;
    const maxNodes = 4000;
    let visited = 0;

    while (queue.length > 0 && visited < maxNodes) {
      const { depth, value } = queue.shift();

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
    const candidateRoots = [];
    const candidateNames = /store|state|data|bootstrap|config|flow/i;

    for (const key of Object.getOwnPropertyNames(window)) {
      if (!candidateNames.test(key)) continue;

      try {
        candidateRoots.push(window[key]);
      } catch {
        // Ignore inaccessible globals.
      }
    }

    candidateRoots.push(window.__INITIAL_STATE__);
    candidateRoots.push(window.__PRELOADED_STATE__);

    for (const candidate of candidateRoots.filter(Boolean)) {
      searchObjectGraph(candidate, 'page-state');
    }
  };

  const inspectResponsePayload = (payload, source, url) => {
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
    const candidates = [];
    const seen = new WeakSet();

    const maybeAdd = (value) => {
      if (!value || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);

      if (
        typeof value.acquireTokenSilent === 'function' &&
        typeof value.getAllAccounts === 'function'
      ) {
        candidates.push(value);
      }
    };

    for (const key of Object.getOwnPropertyNames(window)) {
      try {
        const value = window[key];
        maybeAdd(value);

        if (value && typeof value === 'object') {
          for (const nested of Object.values(value)) {
            maybeAdd(nested);
          }
        }
      } catch {
        // Ignore inaccessible globals.
      }
    }

    return candidates;
  };

  const tryAcquireMsalToken = async () => {
    const candidates = findMsalCandidates();

    for (const client of candidates) {
      let accounts = [];

      try {
        accounts = client.getAllAccounts() || [];
      } catch {
        continue;
      }

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

            window.postMessage(
              {
                score: scopes.some((scope) => scope.endsWith('Flow.Write')) ? 500 : 450,
                scope: Array.isArray(result.scopes) ? result.scopes.join(' ') : scopes.join(' '),
                source: BRIDGE_SIGNAL,
                token: `Bearer ${result.accessToken}`,
                type: 'token-from-msal',
              },
              '*',
            );
          } catch {
            // Ignore silent auth failures and keep trying other clients/scopes.
          }
        }
      }
    }
  };

  const patchFetch = () => {
    const originalFetch = window.fetch;

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      try {
        const cloned = response.clone();
        const contentType = cloned.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await cloned.json();
          inspectResponsePayload(data, 'fetch-response', typeof args[0] === 'string' ? args[0] : args[0]?.url);
        }
      } catch {
        // Ignore response parsing failures.
      }

      return response;
    };
  };

  const patchXhr = () => {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__paMcpUrl = url;
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      this.addEventListener('load', () => {
        try {
          const contentType = this.getResponseHeader('content-type') || '';
          if (!contentType.includes('application/json')) return;
          if (typeof this.responseText !== 'string' || !this.responseText) return;

          const data = JSON.parse(this.responseText);
          inspectResponsePayload(data, 'xhr-response', this.__paMcpUrl);
        } catch {
          // Ignore response parsing failures.
        }
      });

      return originalSend.apply(this, args);
    };
  };

  if (currentEnvId && currentFlowId) {
    inspectBootstrapState();
    patchFetch();
    patchXhr();
    tryAcquireMsalToken();
    setTimeout(inspectBootstrapState, 1500);
    setTimeout(inspectBootstrapState, 4000);
    setTimeout(tryAcquireMsalToken, 1500);
    setTimeout(tryAcquireMsalToken, 4000);
  }
})();
