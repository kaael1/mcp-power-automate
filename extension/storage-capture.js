const BRIDGE_SIGNAL = 'pa-mcp-bridge';

const jwtLike = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;

const decodeJwtPayload = (token) => {
  try {
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const scoreScopes = (scopeText = '') => {
  const scope = scopeText.toLowerCase();
  let score = 0;

  if (scope.includes('powerautomate.flow.read')) score += 400;
  if (scope.includes('powerautomate.flow.write')) score += 450;
  if (scope.includes('cloudflows')) score += 200;
  if (scope.includes('flows.read')) score += 120;
  if (scope.includes('flows.write')) score += 140;
  if (scope.includes('cloudflows.read')) score += 160;
  if (scope.includes('cloudflows.write')) score += 180;
  if (scope.includes('powerautomate')) score += 40;

  return score;
};

const extractTokenCandidates = (value) => {
  const candidates = new Set();

  const visit = (input) => {
    if (!input) return;

    if (typeof input === 'string') {
      const trimmed = input.trim();

      if (trimmed.startsWith('Bearer ')) {
        const token = trimmed.slice(7).trim();
        if (jwtLike.test(token)) candidates.add(token);
      }

      if (jwtLike.test(trimmed)) {
        candidates.add(trimmed);
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          visit(JSON.parse(trimmed));
        } catch {
          return;
        }
      }

      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) visit(item);
      return;
    }

    if (typeof input === 'object') {
      for (const [key, nestedValue] of Object.entries(input)) {
        if (typeof nestedValue === 'string') {
          if (/token|secret|credential/i.test(key) || jwtLike.test(nestedValue.trim())) {
            visit(nestedValue);
            continue;
          }
        }

        visit(nestedValue);
      }
    }
  };

  visit(value);

  return [...candidates];
};

const inspectStorage = (storage, storageName) => {
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

      findings.push({
        aud: payload.aud,
        exp: payload.exp || null,
        hasFlowRead: scope.toLowerCase().includes('powerautomate.flow.read'),
        hasFlowWrite: scope.toLowerCase().includes('powerautomate.flow.write'),
        score,
        scope,
        source: `${storageName}:${key}`,
        token: `Bearer ${candidate}`,
      });
    }
  }

  return findings;
};

const collectAllFromStore = (db, storeName) =>
  new Promise((resolve, reject) => {
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

const openDb = (name, version) =>
  new Promise((resolve, reject) => {
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

              findings.push({
                aud: payload.aud,
                exp: payload.exp || null,
                hasFlowRead: scope.toLowerCase().includes('powerautomate.flow.read'),
                hasFlowWrite: scope.toLowerCase().includes('powerautomate.flow.write'),
                score,
                scope,
                source: `indexedDB:${dbInfo.name}:${storeName}`,
                token: `Bearer ${candidate}`,
              });
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

const dedupeFindings = (findings) => {
  const byToken = new Map();

  for (const finding of findings) {
    const current = byToken.get(finding.token);
    if (!current || (finding.score || 0) >= (current.score || 0)) {
      byToken.set(finding.token, finding);
    }
  }

  return [...byToken.values()];
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

    await chrome.runtime.sendMessage({
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
    });

    await chrome.runtime.sendMessage({
      scope: best.scope,
      score: best.score || 0,
      source: best.source,
      token: best.token,
      type: 'token-from-storage',
    });
  } catch {
    // Ignore storage capture failures; request interception is still the primary path.
  }
};

const injectProbe = () => {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-probe.js');
  script.async = false;
  script.onload = () => {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);
};

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== BRIDGE_SIGNAL) return;

  chrome.runtime.sendMessage(event.data);
});

reportBestToken();
injectProbe();
window.addEventListener('focus', () => {
  reportBestToken();
  injectProbe();
});
window.addEventListener('storage', () => {
  reportBestToken();
  injectProbe();
});
setInterval(() => {
  reportBestToken();
  injectProbe();
}, 5000);
