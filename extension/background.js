const BRIDGE_URL = 'http://127.0.0.1:17373';
const STORAGE_KEYS = {
  activeFlow: 'mcpPowerAutomate.activeFlow',
  flowCatalog: 'mcpPowerAutomate.flowCatalog',
  lastError: 'mcpPowerAutomate.lastError',
  lastHealth: 'mcpPowerAutomate.lastHealth',
  lastRun: 'mcpPowerAutomate.lastRun',
  lastUpdate: 'mcpPowerAutomate.lastUpdate',
  lastSentAt: 'mcpPowerAutomate.lastSentAt',
  lastSession: 'mcpPowerAutomate.lastSession',
  lastSnapshot: 'mcpPowerAutomate.lastSnapshot',
  tokenAudit: 'mcpPowerAutomate.tokenAudit',
  tokenMeta: 'mcpPowerAutomate.tokenMeta',
};

const state = {
  lastSentSignature: null,
  tabs: {},
};

const decodeJwtPayload = (bearerToken) => {
  try {
    const token = bearerToken.replace(/^Bearer\s+/i, '');
    const [, payloadPart] = token.split('.');
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const scoreToken = (bearerToken) => {
  const payload = decodeJwtPayload(bearerToken);
  const scopeText = (payload?.scp || payload?.roles?.join(' ') || '').toLowerCase();
  let score = 0;

  if (payload?.aud === 'https://api.powerplatform.com') score += 50;
  if (scopeText.includes('powerautomate.flow.read')) score += 400;
  if (scopeText.includes('powerautomate.flow.write')) score += 450;
  if (scopeText.includes('cloudflows')) score += 200;
  if (scopeText.includes('cloudflows.read')) score += 160;
  if (scopeText.includes('cloudflows.write')) score += 180;
  if (scopeText.includes('flows.read')) score += 120;
  if (scopeText.includes('flows.write')) score += 140;
  if (scopeText.includes('powerautomate')) score += 40;

  return {
    payload,
    scopeText,
    score,
  };
};

const maybePromoteApiToken = async (tabState, nextToken, source) => {
  if (!nextToken) return;

  const current = scoreToken(tabState.apiToken || '');
  const candidate = scoreToken(nextToken);

  if (!tabState.apiToken || candidate.score >= current.score) {
    tabState.apiToken = nextToken;
    tabState.apiTokenMeta = {
      score: candidate.score,
      scope: candidate.scopeText,
      source,
    };
    await setStorage({
      [STORAGE_KEYS.tokenMeta]: tabState.apiTokenMeta,
    });
  }
};

const getTabState = (tabId) => {
  if (!state.tabs[tabId]) {
    state.tabs[tabId] = {};
  }

  return state.tabs[tabId];
};

const getStorage = (keys) =>
  new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });

const setStorage = (payload) =>
  new Promise((resolve) => {
    chrome.storage.local.set(payload, resolve);
  });

const removeStorage = (keys) =>
  new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });

const getTab = (tabId) =>
  new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => resolve(tab || null));
  });

const queryTabs = (queryInfo) =>
  new Promise((resolve) => {
    chrome.tabs.query(queryInfo, resolve);
  });

const extractAuthorization = (headers = []) => {
  const header = headers.find((item) => item.name.toLowerCase() === 'authorization');
  return header?.value || null;
};

const extractFromApiUrl = (requestUrl) => {
  const modernMatch = requestUrl.match(
    /\.api\.powerplatform\.com\/powerautomate\/flows\/([0-9a-f-]{36})/i,
  );

  if (modernMatch) {
    return { envId: null, flowId: modernMatch[1] };
  }

  const legacyMatch = requestUrl.match(
    /\/providers\/Microsoft\.ProcessSimple\/environments\/([^/]+)\/flows\/([0-9a-f-]{36})/i,
  );

  if (legacyMatch) {
    return { envId: legacyMatch[1], flowId: legacyMatch[2] };
  }

  return null;
};

const extractFromPortalUrl = (portalUrl) => {
  if (!portalUrl) return null;

  const envMatch = portalUrl.match(/environments\/([a-zA-Z0-9-]+)/i);
  const flowMatch = portalUrl.match(/flows\/([0-9a-f-]{36})/i);

  if (!envMatch && !flowMatch) return null;

  return {
    envId: envMatch?.[1] || null,
    flowId: flowMatch?.[1] || null,
  };
};

const buildBaseUrl = (rawUrl) => {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.hostname}/`;
};

const buildSessionSignature = (session) =>
  JSON.stringify({
    apiToken: session.apiToken,
    apiUrl: session.apiUrl,
    envId: session.envId,
    flowId: session.flowId,
    legacyApiUrl: session.legacyApiUrl || null,
    legacyToken: session.legacyToken || null,
  });

const checkBridgeHealth = async () => {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`);
    const body = await response.json();
    await setStorage({ [STORAGE_KEYS.lastHealth]: body });
    return body;
  } catch (error) {
    const fallback = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    await setStorage({ [STORAGE_KEYS.lastHealth]: fallback });
    return fallback;
  }
};

const postSessionToBridge = async (session) => {
  const response = await fetch(`${BRIDGE_URL}/session`, {
    body: JSON.stringify(session),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Bridge request failed with ${response.status}`);
  }

  return body;
};

const postSnapshotToBridge = async (snapshot) => {
  const response = await fetch(`${BRIDGE_URL}/snapshot`, {
    body: JSON.stringify(snapshot),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Snapshot bridge request failed with ${response.status}`);
  }

  return body;
};

const postTokenAuditToBridge = async (audit) => {
  const response = await fetch(`${BRIDGE_URL}/token-audit`, {
    body: JSON.stringify(audit),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Token audit bridge request failed with ${response.status}`);
  }

  return body;
};

const getLastUpdateFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/last-update`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Last update bridge request failed with ${response.status}`);
  }

  return body.lastUpdate || null;
};

const getLastRunFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/last-run`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Last run bridge request failed with ${response.status}`);
  }

  return body.lastRun || null;
};

const getActiveFlowFromBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/active-flow`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Active flow bridge request failed with ${response.status}`);
  }

  return body.activeFlow || null;
};

const postSetActiveFlowFromTabToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/active-flow/from-tab`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Set active flow bridge request failed with ${response.status}`);
  }

  return body.activeFlow || null;
};

const postRevertLastUpdateToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/revert-last-update`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Revert bridge request failed with ${response.status}`);
  }

  return body;
};

const postRefreshLastRunToBridge = async () => {
  const response = await fetch(`${BRIDGE_URL}/refresh-last-run`, {
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(body.error || `Refresh run bridge request failed with ${response.status}`);
  }

  return body.lastRun || null;
};

const persistSessionStatus = async ({ error, health, sentAt, session }) => {
  const payload = {};

  if (error !== undefined && error !== null) payload[STORAGE_KEYS.lastError] = error;
  if (health !== undefined && health !== null) payload[STORAGE_KEYS.lastHealth] = health;
  if (sentAt !== undefined && sentAt !== null) payload[STORAGE_KEYS.lastSentAt] = sentAt;
  if (session !== undefined && session !== null) payload[STORAGE_KEYS.lastSession] = session;

  if (Object.keys(payload).length > 0) {
    await setStorage(payload);
  }

  if (error === null) {
    await removeStorage([STORAGE_KEYS.lastError]);
  }
};

const maybeSendSession = async (session) => {
  const signature = buildSessionSignature(session);

  if (signature === state.lastSentSignature) {
    return false;
  }

  try {
    const bridgeResult = await postSessionToBridge(session);
    state.lastSentSignature = signature;
    await persistSessionStatus({
      error: null,
      health: { ok: true, ...bridgeResult },
      sentAt: new Date().toISOString(),
      session,
    });
    return true;
  } catch (error) {
    await persistSessionStatus({
      error: error instanceof Error ? error.message : String(error),
      health: { ok: false },
      session,
    });
    return false;
  }
};

const getPopupStatus = async () => {
  const storage = await getStorage(Object.values(STORAGE_KEYS));
  const health = await checkBridgeHealth();
  let activeFlow = storage[STORAGE_KEYS.activeFlow] || null;
  let lastError = storage[STORAGE_KEYS.lastError] || null;
  let lastRun = storage[STORAGE_KEYS.lastRun] || null;
  let lastUpdate = storage[STORAGE_KEYS.lastUpdate] || null;

  if (health?.ok && lastError) {
    await removeStorage([STORAGE_KEYS.lastError]);
    lastError = null;
  }

  try {
    lastRun = await getLastRunFromBridge();
    await setStorage({
      [STORAGE_KEYS.lastRun]: lastRun,
    });
  } catch {
    // Keep cached run info if the bridge cannot answer.
  }

  try {
    lastUpdate = await getLastUpdateFromBridge();
    await setStorage({
      [STORAGE_KEYS.lastUpdate]: lastUpdate,
    });
  } catch {
    // Keep cached update info if the bridge cannot answer.
  }

  try {
    activeFlow = await getActiveFlowFromBridge();
    await setStorage({
      [STORAGE_KEYS.activeFlow]: activeFlow,
    });
  } catch {
    // Keep cached active flow info if the bridge cannot answer.
  }

  return {
    activeFlow,
    bridge: health,
    lastError,
    lastRun,
    lastUpdate,
    lastSentAt: storage[STORAGE_KEYS.lastSentAt] || null,
    session: storage[STORAGE_KEYS.lastSession] || null,
    snapshot: storage[STORAGE_KEYS.lastSnapshot] || null,
    tokenAudit: storage[STORAGE_KEYS.tokenAudit] || null,
    tokenMeta: storage[STORAGE_KEYS.tokenMeta] || null,
  };
};

const resendLastSession = async () => {
  const storage = await getStorage([STORAGE_KEYS.lastSession]);
  const session = storage[STORAGE_KEYS.lastSession];

  if (!session) {
    throw new Error('No captured session is stored yet.');
  }

  state.lastSentSignature = null;
  await maybeSendSession(session);
  return getPopupStatus();
};

const refreshCurrentTab = async () => {
  const [tab] = await queryTabs({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active browser tab was found.');
  }

  if (!/make\.powerautomate\.com|flow\.microsoft\.com/i.test(tab.url || '')) {
    throw new Error('The active tab is not a Power Automate page.');
  }

  await chrome.tabs.reload(tab.id);
  return { ok: true };
};

const hydrateTabFromPortalUrl = async (tabId, tabState) => {
  const tab = await getTab(tabId);
  const portalUrl = tab?.url || '';
  const portalData = extractFromPortalUrl(portalUrl);

  tabState.portalUrl = portalUrl || tabState.portalUrl;

  if (portalData?.envId) tabState.envId = portalData.envId;
  if (portalData?.flowId) tabState.flowId = portalData.flowId;
};

const buildSessionFromTabState = (tabState) => {
  if (!tabState.apiUrl || !tabState.apiToken || !tabState.envId || !tabState.flowId) {
    return null;
  }

  return {
    apiToken: tabState.apiToken,
    apiUrl: tabState.apiUrl,
    capturedAt: new Date().toISOString(),
    envId: tabState.envId,
    flowId: tabState.flowId,
    legacyApiUrl: tabState.legacyApiUrl,
    legacyToken: tabState.legacyToken,
    portalUrl: tabState.portalUrl,
  };
};

const handleApiRequest = async (details) => {
  if (details.tabId < 0) return;

  const tabState = getTabState(details.tabId);
  const matched = extractFromApiUrl(details.url);
  const token = extractAuthorization(details.requestHeaders);

  if (matched?.flowId) tabState.flowId = matched.flowId;
  if (matched?.envId) tabState.envId = matched.envId;

  if (token) {
    if (details.url.includes('.api.powerplatform.com/')) {
      tabState.apiUrl = buildBaseUrl(details.url);
      await maybePromoteApiToken(tabState, token, 'request-header');
    }

    if (details.url.includes('.api.flow.microsoft.com/')) {
      tabState.legacyToken = token;
      tabState.legacyApiUrl = buildBaseUrl(details.url);

      if (!tabState.apiUrl) {
        tabState.apiUrl = tabState.legacyApiUrl;
        tabState.apiToken = token;
      }
    }
  }

  await hydrateTabFromPortalUrl(details.tabId, tabState);

  const session = buildSessionFromTabState(tabState);

  if (session) {
    await maybeSendSession(session);
  }
};

chrome.tabs.onRemoved.addListener((tabId) => {
  delete state.tabs[tabId];
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    handleApiRequest(details).catch(async (error) => {
      await persistSessionStatus({
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },
  {
    urls: ['https://*.api.flow.microsoft.com/*', 'https://*.api.powerplatform.com/*'],
  },
  ['requestHeaders', 'extraHeaders'],
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'flow-snapshot') {
    postSnapshotToBridge(message.payload)
      .then(async (result) => {
        await setStorage({
          [STORAGE_KEYS.lastSnapshot]: message.payload,
        });
        sendResponse(result);
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'token-audit') {
    postTokenAuditToBridge(message.payload)
      .then(async () => {
        await setStorage({
          [STORAGE_KEYS.tokenAudit]: message.payload,
        });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'token-from-storage') {
    const targetTabId = sender?.tab?.id;

    if (typeof targetTabId === 'number') {
      const tabState = getTabState(targetTabId);
      maybePromoteApiToken(tabState, message.token, message.source).then(() => {
        if (tabState.apiUrl && tabState.envId && tabState.flowId) {
          const session = buildSessionFromTabState(tabState);
          if (session) {
            return maybeSendSession(session);
          }
        }

        return undefined;
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'token-from-msal') {
    const targetTabId = sender?.tab?.id;

    if (typeof targetTabId === 'number') {
      const tabState = getTabState(targetTabId);
      maybePromoteApiToken(tabState, message.token, message.source || 'msal-silent').then(() => {
        if (tabState.apiUrl && tabState.envId && tabState.flowId) {
          const session = buildSessionFromTabState(tabState);
          if (session) {
            return maybeSendSession(session);
          }
        }

        return undefined;
      });
    }

    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'get-status') {
    getPopupStatus()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'refresh-current-tab') {
    refreshCurrentTab()
      .then(async () => sendResponse(await getPopupStatus()))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'set-active-flow-from-tab') {
    postSetActiveFlowFromTabToBridge()
      .then(async () => sendResponse(await getPopupStatus()))
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'revert-last-update') {
    postRevertLastUpdateToBridge()
      .then(async () => {
        await refreshCurrentTab();
        sendResponse(await getPopupStatus());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'refresh-last-run') {
    postRefreshLastRunToBridge()
      .then(async (lastRun) => {
        await setStorage({
          [STORAGE_KEYS.lastRun]: lastRun,
        });
        sendResponse(await getPopupStatus());
      })
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === 'resend-session') {
    resendLastSession()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return undefined;
});
